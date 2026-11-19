import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildIframeSandboxAttr,
  DEFAULT_POPUP_SHIELD_CONFIG,
  evaluateWindowOpenAttempt,
  inspectHtmlForShieldSignals,
  normalizePopupShieldConfig,
  resolveEffectiveShieldDecision,
} from '../src/lib/popupShield';

test('buildIframeSandboxAttr enforces strict isolation without breaking fullscreen or mobile orientation', () => {
  const strict = buildIframeSandboxAttr('strict_sandbox', true);
  assert.ok(strict);
  assert.ok(strict.includes('allow-scripts'));
  assert.ok(strict.includes('allow-same-origin'));
  assert.ok(strict.includes('allow-presentation'));
  assert.ok(strict.includes('allow-orientation-lock'));
  assert.equal(strict.includes('allow-popups'), false);
  assert.equal(strict.includes('allow-top-navigation'), false);

  const redirectGuard = buildIframeSandboxAttr('redirect_guard', true);
  assert.ok(redirectGuard);
  assert.ok(redirectGuard.includes('allow-popups'));
  assert.equal(redirectGuard.includes('allow-top-navigation'), false);

  assert.equal(buildIframeSandboxAttr('direct_unrestricted', true), undefined);
  assert.equal(buildIframeSandboxAttr('direct_media', true), undefined);
  assert.equal(buildIframeSandboxAttr('strict_sandbox', false), undefined);
});

test('resolveEffectiveShieldDecision defaults to direct_unrestricted and switches across all 3 configured watch modes', () => {
  assert.equal(DEFAULT_POPUP_SHIELD_CONFIG.defaultWatchMode, 'direct_unrestricted');

  const ytDefaultDecision = resolveEffectiveShieldDecision(
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    DEFAULT_POPUP_SHIELD_CONFIG
  );
  assert.equal(ytDefaultDecision.mode, 'direct_unrestricted');
  assert.equal(ytDefaultDecision.sandboxAttr, undefined);

  const redirectGuardCfg = normalizePopupShieldConfig({
    ...DEFAULT_POPUP_SHIELD_CONFIG,
    defaultWatchMode: 'redirect_guard',
  });
  const redirectDecision = resolveEffectiveShieldDecision(
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    redirectGuardCfg
  );
  assert.equal(redirectDecision.mode, 'redirect_guard');
  assert.ok(redirectDecision.sandboxAttr?.includes('allow-popups'));
  assert.equal(redirectDecision.sandboxAttr?.includes('allow-top-navigation'), false);

  const strictSandboxCfg = normalizePopupShieldConfig({
    ...DEFAULT_POPUP_SHIELD_CONFIG,
    defaultWatchMode: 'strict_sandbox',
  });
  const strictDecision = resolveEffectiveShieldDecision(
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    strictSandboxCfg
  );
  assert.equal(strictDecision.mode, 'strict_sandbox');
  assert.ok(strictDecision.sandboxAttr?.includes('allow-scripts'));
  assert.equal(strictDecision.sandboxAttr?.includes('allow-popups'), false);

  const directMp4Decision = resolveEffectiveShieldDecision(
    'https://cdn.example.com/movies/sample-1080p.mp4',
    DEFAULT_POPUP_SHIELD_CONFIG
  );
  assert.equal(directMp4Decision.mode, 'direct_media');
  assert.equal(directMp4Decision.sandboxAttr, undefined);
});

test('resolveEffectiveShieldDecision respects saved per-host rule overrides', () => {
  const customCfg = normalizePopupShieldConfig({
    ...DEFAULT_POPUP_SHIELD_CONFIG,
    hostRules: {
      'customplayer.net': {
        hostname: 'customplayer.net',
        mode: 'redirect_guard',
        compatibility: 'partial',
        note: 'يحتاج منع تحويل فقط',
      },
    },
  });

  const dec = resolveEffectiveShieldDecision('https://customplayer.net/e/xyz', customCfg);
  assert.equal(dec.mode, 'redirect_guard');
  assert.equal(dec.compatibility, 'partial');
  assert.ok(dec.sandboxAttr?.includes('allow-popups'));
  assert.equal(dec.sandboxAttr?.includes('allow-top-navigation'), false);
});

test('inspectHtmlForShieldSignals distinguishes compatible ad embeds from sandbox-rejecting embeds', () => {
  const compatibleWithAds = inspectHtmlForShieldSignals(
    'https://clean-player.example/e/123',
    '<html><script src="https://c1.popads.net/pop.js"></script><video></video></html>'
  );
  assert.equal(compatibleWithAds.adScriptDetected, true);
  assert.ok(compatibleWithAds.adSignals.includes('popads'));
  assert.equal(compatibleWithAds.antiSandboxDetected, false);
  assert.equal(compatibleWithAds.recommendedMode, 'strict_sandbox');

  const antiSandbox = inspectHtmlForShieldSignals(
    'https://strict-check.example/e/456',
    '<html><body>Sandboxed embed is not allowed. Please disable sandbox.</body></html>'
  );
  assert.equal(antiSandbox.antiSandboxDetected, true);
  assert.equal(antiSandbox.compatibility, 'incompatible');
  assert.equal(antiSandbox.recommendedMode, 'direct_unrestricted');

  const withDirectMp4 = inspectHtmlForShieldSignals(
    'https://wrapper.example/e/789',
    '<video><source src="https://edge.wrapper.example/stream.mp4" /></video>'
  );
  assert.equal(withDirectMp4.recommendedMode, 'direct_media');
  assert.equal(withDirectMp4.directStreamUrl, 'https://edge.wrapper.example/stream.mp4');
});

test('evaluateWindowOpenAttempt blocks ad/playback popups while allowing OAuth and internal links', () => {
  const playbackCtx = {
    serverHost: 'vidmoly.to',
    serverName: 'سيرفر 1',
    mediaTitle: 'Test Film',
    mode: 'direct_unrestricted' as const,
  };

  const adBlocked = evaluateWindowOpenAttempt(
    'https://cdn.popads.net/click?id=1',
    DEFAULT_POPUP_SHIELD_CONFIG,
    null
  );
  assert.equal(adBlocked.allow, false);

  const blankDuringPlaybackBlocked = evaluateWindowOpenAttempt(
    'https://random-redirect.xyz/ad',
    DEFAULT_POPUP_SHIELD_CONFIG,
    playbackCtx
  );
  assert.equal(blankDuringPlaybackBlocked.allow, false);

  // Google Auth popup should NEVER be blocked even if context were somehow set
  const authAllowed = evaluateWindowOpenAttempt(
    'https://accounts.google.com/o/oauth2/auth',
    DEFAULT_POPUP_SHIELD_CONFIG,
    playbackCtx
  );
  assert.equal(authAllowed.allow, true);
});
