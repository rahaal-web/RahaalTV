import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_POPUP_SHIELD_CONFIG,
  normalizePopupShieldConfig,
  resolveEffectiveShieldDecision,
} from '../src/lib/popupShield';
import {
  classifyAutoplayPlayError,
  computeFaultFailoverTransition,
  findNextAvailableServerIndex,
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
  // Server 0 is a dead cross-origin embed whose iframe.onLoad fired (canceling hang timer)
  // while playbackConfirmed remains false until probe confirms ok: true.
  // Probe reveals Server 0 is broken (404), Server 1 appears ok, Server 2 is ok -> switches 0 -> 1.
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

  // Now Server 1 fails at runtime (e.g., timeout / postMessage 403 / media error):
  // computeFaultFailoverTransition cleanly moves 1 -> 2 without repeating 0 or 1.
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

  // If Server 2 also fails, failover terminates cleanly with all_failed (no infinite loop).
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
  // User manually clicks server index 2 out of 4 servers: order must be 2 -> 3 -> 0 -> 1 -> stop (-1)
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

  // Default watch mode must be direct_unrestricted (no sandbox attribute)
  assert.equal(DEFAULT_POPUP_SHIELD_CONFIG.defaultWatchMode, 'direct_unrestricted');
  const defaultDecision = resolveEffectiveShieldDecision(
    embedUrl,
    normalizePopupShieldConfig({})
  );
  assert.equal(defaultDecision.mode, 'direct_unrestricted');
  assert.equal(defaultDecision.sandboxAttr, undefined);

  // Admin switches defaultWatchMode -> redirect_guard
  const redirectCfg = normalizePopupShieldConfig({ defaultWatchMode: 'redirect_guard' });
  const redirectDecision = resolveEffectiveShieldDecision(embedUrl, redirectCfg);
  assert.equal(redirectDecision.mode, 'redirect_guard');
  assert.match(redirectDecision.sandboxAttr || '', /allow-popups-to-escape-sandbox/);

  // Admin switches defaultWatchMode -> strict_sandbox
  const strictCfg = normalizePopupShieldConfig({ defaultWatchMode: 'strict_sandbox' });
  const strictDecision = resolveEffectiveShieldDecision(embedUrl, strictCfg);
  assert.equal(strictDecision.mode, 'strict_sandbox');
  assert.ok(strictDecision.sandboxAttr);
  assert.doesNotMatch(strictDecision.sandboxAttr || '', /allow-popups/);

  // Direct MP4/HLS streams always resolve to direct_media regardless of iframe mode
  const directDecision = resolveEffectiveShieldDecision(
    'https://cdn.example.com/movie/master.m3u8',
    strictCfg
  );
  assert.equal(directDecision.mode, 'direct_media');
  assert.equal(directDecision.sandboxAttr, undefined);
});

