import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyAutoplayPlayError,
  findNextAvailableServerIndex,
  resolveProactiveFilterDecision,
} from '../src/lib/serverFailover';

test('findNextAvailableServerIndex advances sequentially in order and skips tried or faulty servers without looping', () => {
  const totalServers = 4;
  const filterMap = {
    0: { ok: false },
    1: { ok: true },
    2: { ok: false },
    3: { ok: true },
  };

  // Starting from 0 (tried {0}), 1 is healthy -> selects 1
  const firstNext = findNextAvailableServerIndex({
    currentIndex: 0,
    totalServers,
    triedIndices: new Set([0]),
    filterMap,
  });
  assert.equal(firstNext, 1);

  // If 1 fails at runtime (tried {0, 1}), 2 is marked broken in filterMap -> skips 2, selects 3
  const secondNext = findNextAvailableServerIndex({
    currentIndex: 1,
    totalServers,
    triedIndices: new Set([0, 1]),
    filterMap,
  });
  assert.equal(secondNext, 3);

  // If 3 also fails (tried {0, 1, 3}), no untried healthy server remains -> returns -1 (stops failover)
  const thirdNext = findNextAvailableServerIndex({
    currentIndex: 3,
    totalServers,
    triedIndices: new Set([0, 1, 3]),
    filterMap,
  });
  assert.equal(thirdNext, -1);
});

test('findNextAvailableServerIndex wraps around in cyclic order when starting from a middle server and never repeats', () => {
  // User starts at server index 2 out of 4 servers: order must be 2 -> 3 -> 0 -> 1 -> stop (-1)
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

test('classifyAutoplayPlayError distinguishes browser autoplay policy blocks from real playback failures', () => {
  const notAllowed = Object.assign(new Error('play() failed because user did not interact with the document first'), {
    name: 'NotAllowedError',
  });
  assert.equal(classifyAutoplayPlayError(notAllowed), 'autoplay_blocked');

  const safariBlocked = new Error('The request is not allowed by the user agent or the platform in the current context');
  assert.equal(classifyAutoplayPlayError(safariBlocked), 'autoplay_blocked');

  const aborted = Object.assign(new Error('The play() request was interrupted by a new load request'), {
    name: 'AbortError',
  });
  assert.equal(classifyAutoplayPlayError(aborted), 'aborted');

  const unsupported = Object.assign(new Error('Failed to load because no supported source was found'), {
    name: 'NotSupportedError',
  });
  assert.equal(classifyAutoplayPlayError(unsupported), 'playback_error');
});

test('resolveProactiveFilterDecision never switches away once playback/load is confirmed', () => {
  const decision = resolveProactiveFilterDecision({
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
  assert.deepEqual(decision, { action: 'none' });
});

test('resolveProactiveFilterDecision switches to next working server or reports all_failed cleanly', () => {
  const switchDecision = resolveProactiveFilterDecision({
    currentIndex: 0,
    totalServers: 3,
    triedIndices: new Set([0]),
    filterMap: {
      0: { ok: false },
      1: { ok: false },
      2: { ok: true },
    },
    playbackConfirmed: false,
    manuallyBypassedCurrent: false,
    hasEpisodeOverrideUrl: false,
    episodeUrlOk: true,
  });
  assert.equal(switchDecision.action, 'switch');
  if (switchDecision.action === 'switch') {
    assert.equal(switchDecision.nextIndex, 2);
    assert.equal(switchDecision.bypassEpisodeUrl, false);
  }

  const allFailedDecision = resolveProactiveFilterDecision({
    currentIndex: 0,
    totalServers: 2,
    triedIndices: new Set([0]),
    filterMap: {
      0: { ok: false },
      1: { ok: false },
    },
    playbackConfirmed: false,
    manuallyBypassedCurrent: false,
    hasEpisodeOverrideUrl: false,
    episodeUrlOk: true,
  });
  assert.equal(allFailedDecision.action, 'all_failed');
});
