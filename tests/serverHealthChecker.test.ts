import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {
  createCorsRestrictedReport,
  createNetworkErrorReport,
  createTimeoutReport,
  createUnknownErrorReport,
  detectFrameBlockHeaders,
  detectSandboxedEmbedSignals,
  evaluateHttpProbeResult,
  extractDirectMediaCandidate,
  SERVER_HEALTH_META,
} from '../src/lib/serverHealthCore';

test('Scenario 1: HTTP 200 video stream or embed markup never fakes confirmed_playing without actual playback proof', () => {
  // Direct MP4 HTTP 200
  const mp4Report = evaluateHttpProbeResult({
    rawUrl: 'https://cdn.example.com/streams/movie.mp4',
    finalUrl: 'https://cdn.example.com/streams/movie.mp4',
    httpStatus: 200,
    contentType: 'video/mp4',
    latencyMs: 84,
  });
  assert.equal(mp4Report.status, 'page_available');
  assert.equal(mp4Report.statusEmoji, SERVER_HEALTH_META.page_available.emoji);
  assert.equal(mp4Report.playerCheck.playbackConfirmed, false);
  assert.equal(mp4Report.playerCheck.status, 'direct_stream_ready');
  assert.equal(mp4Report.reasonCode, 'DIRECT_STREAM_READY');
  assert.deepEqual(mp4Report.recommendedModes, ['direct_media']);

  // Embed HTML 200 with real video markup
  const embedHtml = `
    <html>
      <body>
        <div id="player" class="jwplayer"></div>
        <video controls src="https://media.example.com/hls/master.m3u8"></video>
      </body>
    </html>
  `;
  const embedReport = evaluateHttpProbeResult({
    rawUrl: 'https://embed.example.com/e/abc123',
    httpStatus: 200,
    contentType: 'text/html; charset=utf-8',
    snippet: embedHtml,
    latencyMs: 142,
  });
  assert.equal(embedReport.status, 'page_available');
  assert.notEqual(embedReport.status, 'confirmed_playing');
  assert.equal(embedReport.connectivity.status, 'reachable');
  assert.equal(embedReport.pageLoad.status, 'loaded');
  assert.equal(embedReport.playerCheck.directStreamUrl, 'https://media.example.com/hls/master.m3u8');
  assert.equal(embedReport.playerCheck.playbackConfirmed, false);
});

test('Scenario 2: detects HTTP 404, 410, and HTML soft-404 (deleted video) accurately', () => {
  const hard404 = evaluateHttpProbeResult({
    rawUrl: 'https://embed.example.com/e/missing',
    httpStatus: 404,
    contentType: 'text/html',
    latencyMs: 55,
  });
  assert.equal(hard404.status, 'broken');
  assert.equal(hard404.reasonCode, 'HTTP_404');
  assert.equal(hard404.connectivity.httpStatus, 404);
  assert.equal(hard404.canEmbedInIframe, false);

  const soft404 = evaluateHttpProbeResult({
    rawUrl: 'https://embed.example.com/e/deleted-123',
    httpStatus: 200,
    contentType: 'text/html',
    snippet: '<html><head><title>404 Not Found</title></head><body>Sorry, this video was deleted by owner.</body></html>',
    latencyMs: 91,
  });
  assert.equal(soft404.status, 'broken');
  assert.equal(soft404.httpStatus, 404);
  assert.equal(soft404.reasonCode, 'HTTP_404');

  const arabicSoft404 = evaluateHttpProbeResult({
    rawUrl: 'https://embed.example.com/e/ar-deleted',
    httpStatus: 200,
    contentType: 'text/html',
    snippet: '<html><body><div class="alert">عذراً، الملف غير موجود أو تم حذف الفيديو</div></body></html>',
    latencyMs: 70,
  });
  assert.equal(arabicSoft404.status, 'broken');
  assert.equal(arabicSoft404.reasonCode, 'HTTP_404');
});

test('Scenario 3: detects HTTP 403 Forbidden and Cloudflare anti-bot challenge cleanly', () => {
  const forbidden = evaluateHttpProbeResult({
    rawUrl: 'https://cdn.example.com/protected.mp4',
    httpStatus: 403,
    contentType: 'text/html',
    latencyMs: 63,
  });
  assert.equal(forbidden.status, 'broken');
  assert.equal(forbidden.reasonCode, 'HTTP_403');
  assert.equal(forbidden.httpStatus, 403);

  const cfChallenge = evaluateHttpProbeResult({
    rawUrl: 'https://embed.example.com/e/cf-locked',
    httpStatus: 200,
    cfMitigated: 'challenge',
    snippet: '<html><head><title>Just a moment...</title></head></html>',
    latencyMs: 112,
  });
  assert.equal(cfChallenge.status, 'broken');
  assert.equal(cfChallenge.reasonCode, 'HTTP_403');
  assert.match(cfChallenge.connectivity.detail, /Cloudflare/i);
});

test('Scenario 4: detects empty broken shell, explicit player errors, and non-video website portals', () => {
  const emptyShell = evaluateHttpProbeResult({
    rawUrl: 'https://embed.example.com/e/empty',
    httpStatus: 200,
    contentType: 'text/html',
    snippet: '<div>Empty</div>',
    latencyMs: 40,
  });
  assert.equal(emptyShell.status, 'broken');
  assert.equal(emptyShell.reasonCode, 'PLAYER_ERROR');

  const brokenPlayer = evaluateHttpProbeResult({
    rawUrl: 'https://embed.example.com/e/player-err',
    httpStatus: 200,
    contentType: 'text/html',
    snippet: '<div class="msg">Video playback error: media could not be loaded cleanly on this server. Wait or retry.</div>',
    latencyMs: 65,
  });
  assert.equal(brokenPlayer.status, 'broken');
  assert.equal(brokenPlayer.reasonCode, 'PLAYER_ERROR');

  const homepageUrl = evaluateHttpProbeResult({
    rawUrl: 'https://portal.example.com/',
    httpStatus: 200,
    contentType: 'text/html',
    snippet: '<title>موقع أفلام ومسلسلات - الرئيسية</title>',
    latencyMs: 90,
  });
  assert.equal(homepageUrl.status, 'broken');
  assert.equal(homepageUrl.reasonCode, 'NOT_VIDEO_PAGE');
});

test('Scenario 5: X-Frame-Options & CSP frame-ancestors classify as iframe_blocked rather than dead server', () => {
  assert.equal(detectFrameBlockHeaders('DENY', '').blocked, true);
  assert.equal(detectFrameBlockHeaders('SAMEORIGIN', '').blocked, true);
  assert.equal(detectFrameBlockHeaders('', "default-src 'self'; frame-ancestors 'none'").blocked, true);
  assert.equal(
    detectFrameBlockHeaders('', "frame-ancestors 'self' https://allowed.example", 'https://rahal.tv').blocked,
    true
  );
  assert.equal(
    detectFrameBlockHeaders('', "frame-ancestors 'self' https://rahal.tv", 'https://rahal.tv').blocked,
    false
  );

  const xfoReport = evaluateHttpProbeResult({
    rawUrl: 'https://secure-host.example/embed/999',
    httpStatus: 200,
    contentType: 'text/html',
    xFrameOptions: 'SAMEORIGIN',
    snippet: '<div id="player"><video src="https://cdn.example/video.mp4"></video></div>',
    latencyMs: 118,
  });
  assert.equal(xfoReport.status, 'iframe_blocked');
  assert.equal(xfoReport.reasonCode, 'IFRAME_BLOCKED');
  assert.equal(xfoReport.connectivity.status, 'reachable');
  assert.equal(xfoReport.pageLoad.frameBlocked, true);
  assert.equal(xfoReport.canEmbedInIframe, false);
  assert.equal(xfoReport.playerCheck.directStreamUrl, 'https://cdn.example/video.mp4');
});

test('Scenario 6: Cross-Origin & CORS restrictions produce needs_manual_check without false dead or false green', () => {
  const corsOnly = createCorsRestrictedReport({
    url: 'https://cross-origin.example/e/video1',
    latencyMs: 185,
    iframeLoaded: false,
  });
  assert.equal(corsOnly.status, 'needs_manual_check');
  assert.equal(corsOnly.statusEmoji, '🟠');
  assert.equal(corsOnly.connectivity.status, 'cors_restricted');
  assert.equal(corsOnly.reasonCode, 'CORS_RESTRICTED');
  assert.equal(corsOnly.playerCheck.playbackConfirmed, false);

  const corsIframeLoaded = createCorsRestrictedReport({
    url: 'https://cross-origin.example/e/video2',
    latencyMs: 410,
    iframeLoaded: true,
  });
  assert.equal(corsIframeLoaded.status, 'needs_manual_check');
  assert.equal(corsIframeLoaded.pageLoad.status, 'loaded');
  assert.equal(corsIframeLoaded.reasonCode, 'PLAYBACK_UNVERIFIED');
  assert.equal(corsIframeLoaded.playerCheck.playbackConfirmed, false);

  // HTTP 200 opaque JS-only embed page (no explicit video tags in static HTML)
  const dynamicJsReport = evaluateHttpProbeResult({
    rawUrl: 'https://opaque.example/e/jsloader',
    httpStatus: 200,
    contentType: 'text/html',
    snippet: '<html><head><title>Watch</title></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>',
    latencyMs: 95,
  });
  assert.equal(dynamicJsReport.status, 'needs_manual_check');
  assert.equal(dynamicJsReport.playerCheck.playbackConfirmed, false);
});

test('Scenario 7: Timeout, Network Error, Unknown Error, Sandbox hints & Direct Media Extraction', () => {
  const timeoutReport = createTimeoutReport({
    url: 'https://slow.example/e/1',
    latencyMs: 6000,
    stage: 'connectivity',
  });
  assert.equal(timeoutReport.status, 'broken');
  assert.equal(timeoutReport.reasonCode, 'TIMEOUT');
  assert.equal(timeoutReport.latencyMs, 6000);

  const netReport = createNetworkErrorReport({
    url: 'https://unreachable.example/e/1',
    latencyMs: 120,
    detail: 'ENOTFOUND',
  });
  assert.equal(netReport.status, 'broken');
  assert.equal(netReport.reasonCode, 'NETWORK_ERROR');

  const unknownReport = createUnknownErrorReport({
    url: 'https://mystery.example/e/1',
    latencyMs: 15,
  });
  assert.equal(unknownReport.status, 'unknown_error');
  assert.equal(unknownReport.statusEmoji, '⚫');

  // Sandboxed embed signal sets sandboxRejected and prefers direct_unrestricted
  const sandboxHtml = `
    <div id="player">Sandboxed embed is not allowed. Please disable sandbox to play video.</div>
    <script>var hls_url = "https:\\/\\/stream.example.com\\/live\\/master.m3u8";</script>
  `;
  assert.equal(detectSandboxedEmbedSignals(sandboxHtml), true);
  assert.equal(
    extractDirectMediaCandidate(sandboxHtml),
    'https://stream.example.com/live/master.m3u8'
  );
  const sandboxReport = evaluateHttpProbeResult({
    rawUrl: 'https://strict-host.example/e/77',
    httpStatus: 200,
    contentType: 'text/html',
    snippet: sandboxHtml,
    latencyMs: 88,
  });
  assert.equal(sandboxReport.status, 'page_available');
  assert.equal(sandboxReport.pageLoad.sandboxRejected, true);
  assert.equal(sandboxReport.reasonCode, 'SANDBOX_REJECTED');
  assert.ok(sandboxReport.recommendedModes.includes('direct_unrestricted'));
});

test('Scenario 8: Live HTTP server probe verification across 200, 404, 403, X-Frame-Options, and soft-404 routes', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/ok-video') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><video controls src="https://cdn.test/video.mp4"></video></body></html>');
      return;
    }
    if (req.url === '/missing') {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>404 Not Found</h1>');
      return;
    }
    if (req.url === '/forbidden') {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end('<h1>403 Forbidden</h1>');
      return;
    }
    if (req.url === '/xfo-deny') {
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'X-Frame-Options': 'DENY',
      });
      res.end('<div id="player"><video controls></video></div>');
      return;
    }
    if (req.url === '/soft-404') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><p>Sorry, this file was deleted due to copyright.</p></body></html>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'video/mp4' });
    res.end('fake-mp4-bytes');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const probeRoute = async (path: string) => {
      const start = Date.now();
      const resp = await fetch(`${baseUrl}${path}`);
      const snippet = await resp.text();
      return evaluateHttpProbeResult({
        rawUrl: `${baseUrl}${path}`,
        finalUrl: resp.url,
        httpStatus: resp.status,
        contentType: resp.headers.get('content-type') || '',
        xFrameOptions: resp.headers.get('x-frame-options') || '',
        csp: resp.headers.get('content-security-policy') || '',
        snippet,
        latencyMs: Date.now() - start,
      });
    };

    const rOk = await probeRoute('/ok-video');
    assert.equal(rOk.status, 'page_available');
    assert.equal(rOk.playerCheck.directStreamUrl, 'https://cdn.test/video.mp4');

    const r404 = await probeRoute('/missing');
    assert.equal(r404.status, 'broken');
    assert.equal(r404.reasonCode, 'HTTP_404');

    const r403 = await probeRoute('/forbidden');
    assert.equal(r403.status, 'broken');
    assert.equal(r403.reasonCode, 'HTTP_403');

    const rXfo = await probeRoute('/xfo-deny');
    assert.equal(rXfo.status, 'iframe_blocked');
    assert.equal(rXfo.reasonCode, 'IFRAME_BLOCKED');

    const rSoft = await probeRoute('/soft-404');
    assert.equal(rSoft.status, 'broken');
    assert.equal(rSoft.reasonCode, 'HTTP_404');

    const rDirect = await probeRoute('/stream.mp4');
    assert.equal(rDirect.status, 'page_available');
    assert.equal(rDirect.reasonCode, 'DIRECT_STREAM_READY');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
});
