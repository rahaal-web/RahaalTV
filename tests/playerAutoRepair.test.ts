import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import {
  buildSmartModeChainWithMemory,
  clearRememberedWorkingMode,
  clearServerAttemptHistory,
  computeStageProgressPercent,
  loadRememberedWorkingMode,
  loadServerAttemptHistory,
  loadServerDiagnosticsMap,
  recordServerDiagnosticAttempt,
  resetDiagnosticsForTests,
  resetMemoryWorkingModesForTests,
  resolveSafeIframePresentation,
  sanitizeAndRepairStreamUrl,
  saveRememberedWorkingMode,
  STAGE_PROGRESS_RANGES,
  syncHealthReportToDiagnostics,
  type PipelineStageKey,
} from '../src/lib/playerAutoRepair';
import { classifyAutoplayPlayError, computeFaultFailoverTransition } from '../src/lib/serverFailover';
import {
  createCorsRestrictedReport,
  evaluateHttpProbeResult,
  validateRedirectHopUrl,
} from '../src/lib/serverHealthCore';
import { DEFAULT_POPUP_SHIELD_CONFIG } from '../src/lib/popupShield';

const PRIVATE_IP_OR_LOCAL_HOST = (hostname: string): boolean => {
  const lower = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!lower) return true;
  if (lower === 'localhost' || lower === '127.0.0.1' || lower === '::1' || lower === '0.0.0.0') {
    return true;
  }
  if (lower.endsWith('.local') || lower.endsWith('.internal')) return true;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(lower)) return true;
  return false;
};

test('Acceptance 1 & URL Auto-Repair: sanitizes malformed embed/URLs safely without DB mutation', () => {
  const dirtyIframe = `<iframe src="https:\\/\\/cdn.example.com\\/watch\\/ep1.m3u8?token=abc&amp;utm_source=fb&fbclid=xyz"></iframe>`;
  const repaired = sanitizeAndRepairStreamUrl(dirtyIframe, null);
  assert.equal(repaired.valid, true);
  assert.equal(repaired.mediaKind, 'hls');
  assert.equal(repaired.url, 'https://cdn.example.com/watch/ep1.m3u8?token=abc');
  assert.ok(repaired.repairsApplied.includes('extracted_iframe_src'));
  assert.ok(repaired.repairsApplied.includes('unescaped_json_slashes'));
  assert.ok(repaired.repairsApplied.includes('decoded_html_entities'));
  assert.ok(repaired.repairsApplied.includes('removed_tracking_params'));

  // Protocol-relative & missing scheme repair
  const protoRel = sanitizeAndRepairStreamUrl(null, '//streams.example.org/video/movie.mp4');
  assert.equal(protoRel.valid, true);
  assert.equal(protoRel.mediaKind, 'mp4');
  assert.equal(protoRel.url, 'https://streams.example.org/video/movie.mp4');
  assert.ok(protoRel.repairsApplied.includes('added_https_scheme_to_protocol_relative'));

  const dashUrl = sanitizeAndRepairStreamUrl(null, 'dash.example.net/live/manifest.mpd');
  assert.equal(dashUrl.valid, true);
  assert.equal(dashUrl.mediaKind, 'dash');
  assert.equal(dashUrl.url, 'https://dash.example.net/live/manifest.mpd');

  // Rejects dangerous schemes
  const xssAttempt = sanitizeAndRepairStreamUrl('<iframe src="javascript:alert(1)"></iframe>', null);
  assert.equal(xssAttempt.valid, false);
  assert.equal(xssAttempt.invalidReason, 'unsafe_protocol');

  const dataAttempt = sanitizeAndRepairStreamUrl(null, 'data:text/html,<script>alert(1)</script>');
  assert.equal(dataAttempt.valid, false);
  assert.equal(dataAttempt.invalidReason, 'unsafe_protocol');
});

test('Acceptance 2, 6, 7: Honest status classification for CORS, X-Frame-Options, and opaque embeds', () => {
  const xfo = evaluateHttpProbeResult({
    rawUrl: 'https://blocked.example/embed/5',
    httpStatus: 200,
    xFrameOptions: 'DENY',
    latencyMs: 90,
  });
  assert.equal(xfo.status, 'iframe_blocked');
  assert.equal(xfo.canEmbedInIframe, false);

  const corsRestricted = createCorsRestrictedReport({
    url: 'https://cors-host.example/embed/7',
    latencyMs: 140,
    iframeLoaded: true,
  });
  assert.equal(corsRestricted.status, 'needs_manual_check');
  assert.equal(corsRestricted.playerCheck.playbackConfirmed, false);
});

test('Acceptance 3 & 4: Auto-mode fallback chain respects antiSandbox security rules and server failover', () => {
  resetMemoryWorkingModesForTests();

  const restrictedChain = buildSmartModeChainWithMemory({
    serverUrl: 'https://embed.anti-sandbox.example/v/1',
    primaryMode: 'strict_sandbox',
    isDirectMedia: false,
    antiSandboxDetected: true,
    hasDirectStreamFallback: false,
  });
  // Must NOT keep strict_sandbox when anti-sandbox is explicitly detected
  assert.equal(restrictedChain.modeChain.includes('strict_sandbox'), false);
  assert.ok(restrictedChain.modeChain.includes('redirect_guard'));
  assert.ok(restrictedChain.modeChain.includes('direct_unrestricted'));

  // Fault transition triggers next-server fallback cleanly on 404/403/timeout/not_video
  const failover = computeFaultFailoverTransition({
    faultIndex: 0,
    totalServers: 2,
    triedIndices: new Set<number>(),
    filterMap: {
      0: { ok: false },
      1: { ok: true },
    },
  });
  assert.equal(failover.action, 'switch');
  if (failover.action === 'switch') {
    assert.equal(failover.nextIndex, 1);
  }

  // Safe iframe presentation picks origin-aware referrerPolicy only for hosts that require it
  const vkPres = resolveSafeIframePresentation(
    'https://vkvideo.ru/video_ext.php?oid=1&id=2',
    DEFAULT_POPUP_SHIELD_CONFIG,
    'redirect_guard'
  );
  assert.equal(vkPres.referrerPolicy, 'strict-origin-when-cross-origin');

  const standardPres = resolveSafeIframePresentation(
    'https://generic-host.example/e/99',
    DEFAULT_POPUP_SHIELD_CONFIG,
    'strict_sandbox'
  );
  assert.equal(standardPres.referrerPolicy, 'no-referrer');
});

test('Acceptance 5: Autoplay NotAllowedError classifies as autoplay_blocked (needs_interaction) rather than fatal broken', () => {
  assert.equal(classifyAutoplayPlayError({ name: 'NotAllowedError' }), 'autoplay_blocked');
  assert.equal(classifyAutoplayPlayError({ name: 'AbortError' }), 'aborted');
  assert.equal(classifyAutoplayPlayError({ name: 'NotSupportedError' }), 'playback_error');
});

test('Acceptance 8: Working mode memory prioritizes verified mode per host and clears on later failure', () => {
  resetMemoryWorkingModesForTests();
  const url = 'https://fast-cdn.example/embed/abc123';

  saveRememberedWorkingMode(url, 'redirect_guard');
  assert.equal(loadRememberedWorkingMode(url), 'redirect_guard');

  const prioritized = buildSmartModeChainWithMemory({
    serverUrl: 'https://fast-cdn.example/embed/other-episode',
    primaryMode: 'strict_sandbox',
    isDirectMedia: false,
    antiSandboxDetected: false,
  });
  assert.equal(prioritized.rememberedMode, 'redirect_guard');
  assert.equal(prioritized.modeChain[0], 'redirect_guard');

  clearRememberedWorkingMode(url);
  assert.equal(loadRememberedWorkingMode(url), null);
});

test('Acceptance 9: Circular progress strictly monotonic across real stages & never fakes 100% prematurely', () => {
  const orderedStages: PipelineStageKey[] = [
    'url_validation',
    'connectivity_check',
    'http_redirect_check',
    'player_mount',
    'player_init',
    'mode_fallback',
    'final_verify',
  ];

  // Verify configured bounds match 0-10, 10-25, 25-40, 40-55, 55-70, 70-90, 90-100
  assert.deepEqual(STAGE_PROGRESS_RANGES.url_validation, { min: 0, max: 10 });
  assert.deepEqual(STAGE_PROGRESS_RANGES.connectivity_check, { min: 10, max: 25 });
  assert.deepEqual(STAGE_PROGRESS_RANGES.http_redirect_check, { min: 25, max: 40 });
  assert.deepEqual(STAGE_PROGRESS_RANGES.player_mount, { min: 40, max: 55 });
  assert.deepEqual(STAGE_PROGRESS_RANGES.player_init, { min: 55, max: 70 });
  assert.deepEqual(STAGE_PROGRESS_RANGES.mode_fallback, { min: 70, max: 90 });
  assert.deepEqual(STAGE_PROGRESS_RANGES.final_verify, { min: 90, max: 100 });

  let prev = 0;
  for (const stage of orderedStages) {
    const mid = computeStageProgressPercent({
      stage,
      subFraction: 0.5,
      previousPercent: prev,
      allowFinal100: false,
    });
    assert.ok(mid >= prev, `Expected monotonic progress for ${stage}: ${mid} >= ${prev}`);
    assert.ok(mid <= 99, `Must not hit 100% before allowFinal100 on ${stage}`);
    prev = mid;
  }

  // Attempting to go backwards from 65% to connectivity_check (10-25) stays monotonic at 65%
  const noBackward = computeStageProgressPercent({
    stage: 'connectivity_check',
    subFraction: 0.2,
    previousPercent: 65,
    allowFinal100: false,
  });
  assert.equal(noBackward, 65);

  // Reaching 100% only succeeds when stage === 'final_verify' && allowFinal100 === true
  const preFinal = computeStageProgressPercent({
    stage: 'final_verify',
    subFraction: 1,
    previousPercent: 92,
    allowFinal100: false,
  });
  assert.equal(preFinal, 99);

  const trueFinal = computeStageProgressPercent({
    stage: 'final_verify',
    subFraction: 1,
    previousPercent: 99,
    allowFinal100: true,
  });
  assert.equal(trueFinal, 100);
});

test('Acceptance 10: Admin diagnostics & history records modes, confirmation, and repairs; Viewer hides technical jargon', () => {
  resetDiagnosticsForTests();

  const report = evaluateHttpProbeResult({
    rawUrl: 'https://player.example.org/e/movie-1',
    httpStatus: 200,
    contentType: 'text/html',
    snippet: '<video src="https://cdn.example.org/stream.m3u8"></video>',
    latencyMs: 120,
  });
  report.triedModes = ['strict_sandbox', 'redirect_guard'];
  report.succeededMode = 'redirect_guard';

  const entry = syncHealthReportToDiagnostics(report, {
    source: 'viewer_auto',
    mediaTitle: 'فيلم تجريبي',
    repairsApplied: ['decoded_html_entities'],
  });
  assert.equal(entry.serverName, 'سيرفر');
  assert.deepEqual(entry.triedModes, ['strict_sandbox', 'redirect_guard']);
  assert.equal(entry.succeededMode, 'redirect_guard');
  assert.equal(entry.playbackConfirmed, false);

  // Confirm playback in second attempt
  recordServerDiagnosticAttempt({
    url: 'https://player.example.org/e/movie-1',
    serverName: 'سيرفر 1',
    mediaTitle: 'فيلم تجريبي',
    status: 'confirmed_playing',
    httpStatus: 200,
    latencyMs: 110,
    embedCheckResult: 'تم تحميل الصفحة بنجاح',
    playerInitResult: 'تم تأكيد تشغيل الفيديو فعلياً',
    triedModes: ['strict_sandbox', 'redirect_guard'],
    succeededMode: 'redirect_guard',
    playbackConfirmed: true,
    attemptCount: 2,
    repairsApplied: ['decoded_html_entities'],
    source: 'viewer_auto',
  });

  const diagMap = loadServerDiagnosticsMap();
  const saved = diagMap['https://player.example.org/e/movie-1'];
  assert.ok(saved);
  assert.equal(saved.status, 'confirmed_playing');
  assert.equal(saved.playbackConfirmed, true);
  assert.equal(saved.attemptCount, 2);
  assert.equal(saved.succeededMode, 'redirect_guard');

  const history = loadServerAttemptHistory();
  assert.equal(history.length, 2);
  clearServerAttemptHistory();
  assert.equal(loadServerAttemptHistory().length, 0);

  // Viewer code audit: ensure CircularPlayerLoader & Modals never show technical leak strings to viewers
  const circularSource = fs.readFileSync(
    path.join(process.cwd(), 'src/components/CircularPlayerLoader.tsx'),
    'utf8'
  );
  assert.ok(!/CORS|X-Frame-Options|Content-Security-Policy|فحص السيرفر|sandbox/i.test(circularSource));
  assert.ok(circularSource.includes('جاري تجهيز المشاهدة'));
  assert.ok(circularSource.includes('تعذر تشغيل هذا السيرفر، جرّب إعادة المحاولة أو اختر سيرفر آخر.'));

  const modalsSource = fs.readFileSync(path.join(process.cwd(), 'src/components/Modals.tsx'), 'utf8');
  assert.ok(!modalsSource.includes('فحص السيرفرات...'));
  assert.ok(!modalsSource.includes('filterAlert'));
});

test('Security SSRF Redirect Validation: blocks private, loopback, and non-HTTP redirect hops', async () => {
  const blockedTargets = [
    'http://127.0.0.1/admin',
    'http://localhost:3000/api/secret',
    'http://192.168.1.10/router',
    'http://10.0.0.5/internal',
    'http://172.16.0.9/metadata',
    'file:///etc/passwd',
    'javascript:alert(1)',
    '',
  ];

  for (const target of blockedTargets) {
    const res = validateRedirectHopUrl(target, 'https://public-host.example/watch/1', PRIVATE_IP_OR_LOCAL_HOST);
    assert.equal(res.ok, false, `Should reject redirect hop to ${target}`);
  }

  const allowed = validateRedirectHopUrl(
    '/hls/master.m3u8',
    'https://public-host.example/watch/1',
    PRIVATE_IP_OR_LOCAL_HOST
  );
  assert.equal(allowed.ok, true);
  if (allowed.ok) {
    assert.equal(allowed.nextUrl, 'https://public-host.example/hls/master.m3u8');
  }

  // Live 302 redirect simulation verifying safe hop validation stops redirect to 127.0.0.1
  const server = http.createServer((req, res) => {
    if (req.url === '/evil-redirect') {
      res.writeHead(302, { Location: 'http://127.0.0.1:8080/internal' });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  try {
    const firstResp = await fetch(`http://127.0.0.1:${addr.port}/evil-redirect`, {
      redirect: 'manual',
    });
    assert.equal(firstResp.status, 302);
    const locationHeader = firstResp.headers.get('location') || '';
    const hopCheck = validateRedirectHopUrl(
      locationHeader,
      'https://external-relay.example/evil-redirect',
      PRIVATE_IP_OR_LOCAL_HOST
    );
    assert.equal(hopCheck.ok, false);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
});
