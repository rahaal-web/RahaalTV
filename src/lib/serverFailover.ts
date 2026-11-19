export const LOAD_TIMEOUT_DIRECT_MS = 12_000;
export const LOAD_TIMEOUT_IFRAME_MS = 14_000;

export type AutoplayErrorKind = 'autoplay_blocked' | 'aborted' | 'playback_error';

export function classifyAutoplayPlayError(err: unknown): AutoplayErrorKind {
  const errObj = (err && typeof err === 'object' ? err : {}) as {
    name?: unknown;
    message?: unknown;
  };
  const name = typeof errObj.name === 'string' ? errObj.name : '';
  const message =
    typeof errObj.message === 'string'
      ? errObj.message
      : typeof err === 'string'
        ? err
        : '';

  if (
    name === 'NotAllowedError' ||
    /not\s*allowed|autoplay|user\s*(didn'?t\s*interact|gesture|activation)/i.test(message)
  ) {
    return 'autoplay_blocked';
  }
  if (name === 'AbortError' || /\baborted\b/i.test(message)) {
    return 'aborted';
  }
  return 'playback_error';
}

export interface FindNextServerParams {
  currentIndex: number;
  totalServers: number;
  triedIndices: ReadonlySet<number>;
  filterMap?: Record<number, { ok: boolean }>;
}

/**
 * Finds the next untried, non-faulty server strictly in existing cyclic list order:
 * currentIndex + 1 .. totalServers - 1, then 0 .. currentIndex - 1.
 * Never returns currentIndex or any already-tried index, preventing repeats and infinite loops.
 */
export function findNextAvailableServerIndex({
  currentIndex,
  totalServers,
  triedIndices,
  filterMap,
}: FindNextServerParams): number {
  if (totalServers <= 0) return -1;
  const safeCurrent = currentIndex >= 0 && currentIndex < totalServers ? currentIndex : 0;

  for (let offset = 1; offset < totalServers; offset += 1) {
    const idx = (safeCurrent + offset) % totalServers;
    if (triedIndices.has(idx)) continue;
    if (filterMap && filterMap[idx]?.ok === false) continue;
    return idx;
  }

  return -1;
}

export interface ProactiveFilterDecisionParams {
  currentIndex: number;
  totalServers: number;
  triedIndices: ReadonlySet<number>;
  filterMap: Record<number, { ok: boolean }>;
  playbackConfirmed: boolean;
  manuallyBypassedCurrent: boolean;
  hasEpisodeOverrideUrl: boolean;
  episodeUrlOk: boolean;
}

export type ProactiveFilterDecision =
  | { action: 'none' }
  | {
      action: 'switch';
      nextIndex: number;
      bypassEpisodeUrl: boolean;
      nextTriedIndices: number[];
    }
  | {
      action: 'all_failed';
      nextTriedIndices: number[];
    };

export function resolveProactiveFilterDecision({
  currentIndex,
  totalServers,
  triedIndices,
  filterMap,
  playbackConfirmed,
  manuallyBypassedCurrent,
  hasEpisodeOverrideUrl,
  episodeUrlOk,
}: ProactiveFilterDecisionParams): ProactiveFilterDecision {
  // Never disrupt a server whose playback or verified embed load has already succeeded
  if (playbackConfirmed || totalServers <= 0) {
    return { action: 'none' };
  }

  const safeCurrent = currentIndex >= 0 && currentIndex < totalServers ? currentIndex : 0;
  const nextTried = new Set<number>(triedIndices);

  for (let i = 0; i < totalServers; i += 1) {
    if (filterMap[i]?.ok === false) {
      nextTried.add(i);
    }
  }

  // If an episode-level embed/watchUrl was active and failed, switch cleanly to the first healthy server
  if (hasEpisodeOverrideUrl && !episodeUrlOk) {
    if (filterMap[safeCurrent]?.ok === true) {
      return {
        action: 'switch',
        nextIndex: safeCurrent,
        bypassEpisodeUrl: true,
        nextTriedIndices: Array.from(nextTried),
      };
    }
    nextTried.add(safeCurrent);
    const nextIdx = findNextAvailableServerIndex({
      currentIndex: safeCurrent,
      totalServers,
      triedIndices: nextTried,
      filterMap,
    });
    if (nextIdx !== -1) {
      return {
        action: 'switch',
        nextIndex: nextIdx,
        bypassEpisodeUrl: true,
        nextTriedIndices: Array.from(nextTried),
      };
    }
    return {
      action: 'all_failed',
      nextTriedIndices: Array.from(nextTried),
    };
  }

  const currentEntry = filterMap[safeCurrent];
  if (currentEntry && !currentEntry.ok && !manuallyBypassedCurrent) {
    nextTried.add(safeCurrent);
    const nextIdx = findNextAvailableServerIndex({
      currentIndex: safeCurrent,
      totalServers,
      triedIndices: nextTried,
      filterMap,
    });
    if (nextIdx !== -1) {
      return {
        action: 'switch',
        nextIndex: nextIdx,
        bypassEpisodeUrl: false,
        nextTriedIndices: Array.from(nextTried),
      };
    }
    return {
      action: 'all_failed',
      nextTriedIndices: Array.from(nextTried),
    };
  }

  return { action: 'none' };
}

export type FaultFailoverTransition =
  | { action: 'switch'; nextIndex: number; nextTriedIndices: number[] }
  | { action: 'all_failed'; nextTriedIndices: number[] };

/**
 * Computes the next server transition synchronously without side effects inside React state updaters.
 */
export function computeFaultFailoverTransition({
  faultIndex,
  totalServers,
  triedIndices,
  filterMap,
}: {
  faultIndex: number;
  totalServers: number;
  triedIndices: ReadonlySet<number>;
  filterMap: Record<number, { ok: boolean }>;
}): FaultFailoverTransition {
  const nextTried = new Set<number>(triedIndices);
  if (faultIndex >= 0 && faultIndex < totalServers) {
    nextTried.add(faultIndex);
  }
  const nextIdx = findNextAvailableServerIndex({
    currentIndex: faultIndex,
    totalServers,
    triedIndices: nextTried,
    filterMap,
  });
  if (nextIdx !== -1) {
    nextTried.add(nextIdx);
    return {
      action: 'switch',
      nextIndex: nextIdx,
      nextTriedIndices: Array.from(nextTried),
    };
  }
  return {
    action: 'all_failed',
    nextTriedIndices: Array.from(nextTried),
  };
}

