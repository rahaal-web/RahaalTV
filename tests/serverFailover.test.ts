import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_POPUP_SHIELD_CONFIG,
  normalizePopupShieldConfig,
  resolveEffectiveShieldDecision,
} from '../src/lib/popupShield';
import {
  buildCompatibleModeChain,
  classifyAutoplayPlayError,
  computeFaultFailoverTransition,
  findNextAvailableServerIndex,
  getSmartPlayStatusMessage,
  resolveManualModeStep,
  resolveNextModeOnFailure,
  resolveProactiveFilterDecision,
} from '../src/lib/serverFailover';

test('Scenario 1 & 4: default server starts at index 0, autoplay NotAllowedError is not a server fault, and working server stops failover', () => {
  const notAllowed = Object.assign(
    new Error('play() failed because user did not interact with the document first'),
    { name: 'NotAllowedError' }
  );
  assert.equal(classifyAutoplayPlayError(notAllowed), 'autoplay_blocked');

  const safariBlocked = new Error(
    'The request is not allowed by the user agent or the platform in the current context'
  );
  assert.equal(classifyAutoplayPlayError(safariBlocked), 'autoplay_blocked');

  const aborted = Object.assign(new Error('The play() request was interrupted by a new load request'), {
    name: 'AbortError',
  });
  assert.equal(classifyAutoplayPlayError(aborted), 'aborted');

  const unsupported = Object.assign(new Error('Failed to load because no supported source was found'), {
    name: 'NotSupportedError',
  });
  assert.equal(classifyAutoplayPlayError(unsupported), 'playback_error');

  // Once playback or verified load is confirmed on a healthy server, failover permanently stops
  const confirmedDecision = resolveProactiveFilterDecision({
    currentIndex: 0,
    totalServers: 3,
    triedIndices: new Set([0]),
    filterMap: {
      0: { ok: false },
      1: { ok: true },
      2: { ok: true },
    },
    playbackConfirmed: true,
    manuallyBypassedCurrent: false,
    hasEpisodeOverrideUrl: false,
    episodeUrlOk: true,
  });
  assert.deepEqual(confirmedDecision, { action: 'none' });
});

test('Scenario 2 & 3: cross-origin iframe onLoad does not lock out proactive 404/403 switching (S1 -> S2 -> S3 -> stop)', () => {
  const switch1 = resolveProactiveFilterDecision({
    currentIndex: 0,
    totalServers: 3,
    triedIndices: new Set([0]),
    filterMap: {
      0: { ok: false },
      1: { ok: true },
      2: { ok: true },
    },
    playbackConfirmed: false,
    manuallyBypassedCurrent: false,
    hasEpisodeOverrideUrl: false,
    episodeUrlOk: true,
  });
  assert.equal(switch1.action, 'switch');
  if (switch1.action === 'switch') {
    assert.equal(switch1.nextIndex, 1);
  }

  const triedAfter1 = new Set<number>([0, 1]);
  const switch2 = computeFaultFailoverTransition({
    faultIndex: 1,
    totalServers: 3,
    triedIndices: triedAfter1,
    filterMap: {
      0: { ok: false },
      1: { ok: false },
      2: { ok: true },
    },
  });
  assert.equal(switch2.action, 'switch');
  if (switch2.action === 'switch') {
    assert.equal(switch2.nextIndex, 2);
  }

  const triedAfter2 = new Set<number>(switch2.nextTriedIndices);
  const stopDecision = computeFaultFailoverTransition({
    faultIndex: 2,
    totalServers: 3,
    triedIndices: triedAfter2,
    filterMap: {
      0: { ok: false },
      1: { ok: false },
      2: { ok: false },
    },
  });
  assert.equal(stopDecision.action, 'all_failed');
});

test('Scenario 5: manual server selection starts fresh from chosen index and advances cyclically without repeats', () => {
  const tried = new Set<number>([2]);

  const step1 = findNextAvailableServerIndex({
    currentIndex: 2,
    totalServers: 4,
    triedIndices: tried,
  });
  assert.equal(step1, 3);
  tried.add(step1);

  const step2 = findNextAvailableServerIndex({
    currentIndex: 3,
    totalServers: 4,
    triedIndices: tried,
  });
  assert.equal(step2, 0);
  tried.add(step2);

  const step3 = findNextAvailableServerIndex({
    currentIndex: 0,
    totalServers: 4,
    triedIndices: tried,
  });
  assert.equal(step3, 1);
  tried.add(step3);

  const done = findNextAvailableServerIndex({
    currentIndex: 1,
    totalServers: 4,
    triedIndices: tried,
  });
  assert.equal(done, -1);
});

test('Scenario 6: series episode override fault falls back cleanly to episode server 0 or next healthy server', () => {
  const decision = resolveProactiveFilterDecision({
    currentIndex: 0,
    totalServers: 3,
    triedIndices: new Set([0]),
    filterMap: {
      0: { ok: false },
      1: { ok: true },
      2: { ok: true },
    },
    playbackConfirmed: false,
    manuallyBypassedCurrent: false,
    hasEpisodeOverrideUrl: true,
    episodeUrlOk: false,
  });
  assert.equal(decision.action, 'switch');
  if (decision.action === 'switch') {
    assert.equal(decision.bypassEpisodeUrl, true);
    assert.equal(decision.nextIndex, 1);
  }
});

test('Scenario 7: respects Admin-configured default watch mode across all 3 modes', () => {
  const embedUrl = 'https://unknown-embed-host.example/embed/12345';

  assert.equal(DEFAULT_POPUP_SHIELD_CONFIG.defaultWatchMode, 'direct_unrestricted');
  const defaultDecision = resolveEffectiveShieldDecision(
    embedUrl,
    normalizePopupShieldConfig({})
  );
  assert.equal(defaultDecision.mode, 'direct_unrestricted');
  assert.equal(defaultDecision.sandboxAttr, undefined);

  const redirectCfg = normalizePopupShieldConfig({ defaultWatchMode: 'redirect_guard' });
  const redirectDecision = resolveEffectiveShieldDecision(embedUrl, redirectCfg);
  assert.equal(redirectDecision.mode, 'redirect_guard');
  assert.match(redirectDecision.sandboxAttr || '', /allow-popups-to-escape-sandbox/);

  const strictCfg = normalizePopupShieldConfig({ defaultWatchMode: 'strict_sandbox' });
  const strictDecision = resolveEffectiveShieldDecision(embedUrl, strictCfg);
  assert.equal(strictDecision.mode, 'strict_sandbox');
  assert.ok(strictDecision.sandboxAttr);
  assert.doesNotMatch(strictDecision.sandboxAttr || '', /allow-popups/);

  const directDecision = resolveEffectiveShieldDecision(
    'https://cdn.example.com/movie/master.m3u8',
    strictCfg
  );
  assert.equal(directDecision.mode, 'direct_media');
  assert.equal(directDecision.sandboxAttr, undefined);
});

test('Scenario 8: Smart Player Mode Fallback exhausts same-server modes before switching server', () => {
  const chain = buildCompatibleModeChain({
    primaryMode: 'strict_sandbox',
    isDirectMedia: false,
    hasDirectStreamFallback: true,
  });
  assert.deepEqual(chain, ['direct_media', 'strict_sandbox', 'redirect_guard', 'direct_unrestricted']);

  const tried = new Set<'direct_media' | 'strict_sandbox' | 'redirect_guard' | 'direct_unrestricted'>();

  const m1 = resolveNextModeOnFailure({
    modeChain: chain,
    currentMode: 'direct_media',
    triedModes: tried,
  });
  assert.equal(m1.action, 'switch_mode');
  if (m1.action === 'switch_mode') {
    assert.equal(m1.nextMode, 'strict_sandbox');
  }

  const m2 = resolveNextModeOnFailure({
    modeChain: chain,
    currentMode: 'strict_sandbox',
    triedModes: new Set(m1.nextTriedModes),
  });
  assert.equal(m2.action, 'switch_mode');
  if (m2.action === 'switch_mode') {
    assert.equal(m2.nextMode, 'redirect_guard');
  }

  const m3 = resolveNextModeOnFailure({
    modeChain: chain,
    currentMode: 'redirect_guard',
    triedModes: new Set(m2.nextTriedModes),
  });
  assert.equal(m3.action, 'switch_mode');
  if (m3.action === 'switch_mode') {
    assert.equal(m3.nextMode, 'direct_unrestricted');
  }

  const exhausted = resolveNextModeOnFailure({
    modeChain: chain,
    currentMode: 'direct_unrestricted',
    triedModes: new Set(m3.nextTriedModes),
  });
  assert.equal(exhausted.action, 'exhausted_server');
});

test('Scenario 9: Anti-sandbox detection skips strict_sandbox cleanly without infinite loop', () => {
  const antiSandboxChain = buildCompatibleModeChain({
    primaryMode: 'strict_sandbox',
    isDirectMedia: false,
    antiSandboxDetected: true,
  });
  assert.deepEqual(antiSandboxChain, ['direct_unrestricted', 'redirect_guard']);
  assert.equal(antiSandboxChain.includes('strict_sandbox'), false);

  const directOnlyChain = buildCompatibleModeChain({
    primaryMode: 'direct_media',
    isDirectMedia: true,
  });
  assert.deepEqual(directOnlyChain, ['direct_media']);
});

test('Scenario 10: Manual mode stepper and Smart Play Overlay status messages', () => {
  const chain: ('direct_unrestricted' | 'redirect_guard' | 'strict_sandbox')[] = [
    'direct_unrestricted',
    'redirect_guard',
    'strict_sandbox',
  ];
  assert.equal(
    resolveManualModeStep({ modeChain: chain, currentMode: 'direct_unrestricted', direction: 'next' }),
    'redirect_guard'
  );
  assert.equal(
    resolveManualModeStep({ modeChain: chain, currentMode: 'direct_unrestricted', direction: 'prev' }),
    'strict_sandbox'
  );
  assert.equal(
    resolveManualModeStep({ modeChain: chain, currentMode: 'strict_sandbox', direction: 'next' }),
    'direct_unrestricted'
  );

  assert.match(getSmartPlayStatusMessage('initializing', 'strict_sandbox'), /جاري تهيئة المشغل/);
  assert.match(getSmartPlayStatusMessage('trying_mode', 'direct_unrestricted'), /التوافق المباشر/);
  assert.match(getSmartPlayStatusMessage('confirmed_playing', 'direct_media'), /تم بدء تشغيل الفيديو بنجاح/);
  assert.match(getSmartPlayStatusMessage('server_exhausted', 'redirect_guard'), /لم نتمكن من تشغيل هذا السيرفر/);
});

