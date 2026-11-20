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

export type WatchMode = 'direct_media' | 'strict_sandbox' | 'redirect_guard' | 'direct_unrestricted';
export type IframeWatchMode = Exclude<WatchMode, 'direct_media'>;

export type SmartPlayState =
  | 'idle'
  | 'initializing'
  | 'trying_mode'
  | 'mode_failed_retrying'
  | 'page_loaded_ready'
  | 'autoplay_blocked'
  | 'confirmed_playing'
  | 'server_exhausted';

export interface WatchModeDisplayInfo {
  mode: WatchMode;
  label: string;
  shortLabel: string;
  description: string;
}

export const WATCH_MODE_DISPLAY: Record<WatchMode, WatchModeDisplayInfo> = {
  direct_media: {
    mode: 'direct_media',
    label: 'مشغل البث المباشر',
    shortLabel: 'بث مباشر',
    description: 'تشغيل مباشر لملف الفيديو أو HLS بدون iframe أو نوافذ منبثقة.',
  },
  strict_sandbox: {
    mode: 'strict_sandbox',
    label: 'الوضع المحمي (Sandbox)',
    shortLabel: 'حماية كاملة',
    description: 'عزل الإطار لمنع النوافذ المنبثقة وإعادة توجيه الصفحة.',
  },
  redirect_guard: {
    mode: 'redirect_guard',
    label: 'وضع منع التحويل',
    shortLabel: 'منع تحويل الصفحة',
    description: 'يسمح بفتح المشغلات التي تتطلب popups مع منع اختطاف الصفحة الرئيسية.',
  },
  direct_unrestricted: {
    mode: 'direct_unrestricted',
    label: 'وضع التوافق المباشر',
    shortLabel: 'توافق مباشر',
    description: 'تشغيل الإطار بدون قيود Sandbox لضمان التوافق مع السيرفرات الصارمة.',
  },
};

export function getWatchModeDisplayInfo(mode: WatchMode): WatchModeDisplayInfo {
  return WATCH_MODE_DISPLAY[mode] || WATCH_MODE_DISPLAY.direct_unrestricted;
}

export function buildCompatibleModeChain({
  primaryMode,
  isDirectMedia,
  antiSandboxDetected = false,
  hasDirectStreamFallback = false,
}: {
  primaryMode: WatchMode;
  isDirectMedia: boolean;
  antiSandboxDetected?: boolean;
  hasDirectStreamFallback?: boolean;
}): WatchMode[] {
  if (isDirectMedia) {
    return ['direct_media'];
  }

  const ordered: WatchMode[] = [];
  const pushUnique = (m: WatchMode) => {
    if (!ordered.includes(m)) ordered.push(m);
  };

  if (hasDirectStreamFallback) {
    pushUnique('direct_media');
  }

  if (antiSandboxDetected) {
    // Server explicitly rejects strict sandbox -> prioritize unrestricted & redirect guard first
    if (primaryMode === 'direct_media' && hasDirectStreamFallback) {
      pushUnique('direct_unrestricted');
      pushUnique('redirect_guard');
    } else if (primaryMode === 'redirect_guard') {
      pushUnique('redirect_guard');
      pushUnique('direct_unrestricted');
    } else {
      pushUnique('direct_unrestricted');
      pushUnique('redirect_guard');
    }
    return ordered;
  }

  if (primaryMode !== 'direct_media') {
    pushUnique(primaryMode);
  }
  if (primaryMode === 'strict_sandbox') {
    pushUnique('redirect_guard');
    pushUnique('direct_unrestricted');
  } else if (primaryMode === 'redirect_guard') {
    pushUnique('direct_unrestricted');
    pushUnique('strict_sandbox');
  } else {
    pushUnique('direct_unrestricted');
    pushUnique('redirect_guard');
    pushUnique('strict_sandbox');
  }

  return ordered;
}

export type ModeFallbackTransition =
  | {
      action: 'switch_mode';
      nextMode: WatchMode;
      nextTriedModes: WatchMode[];
    }
  | {
      action: 'exhausted_server';
      nextTriedModes: WatchMode[];
    };

export function resolveNextModeOnFailure({
  modeChain,
  currentMode,
  triedModes,
}: {
  modeChain: ReadonlyArray<WatchMode>;
  currentMode: WatchMode;
  triedModes: ReadonlySet<WatchMode>;
}): ModeFallbackTransition {
  const nextTried = new Set<WatchMode>(triedModes);
  nextTried.add(currentMode);

  for (const candidate of modeChain) {
    if (!nextTried.has(candidate)) {
      return {
        action: 'switch_mode',
        nextMode: candidate,
        nextTriedModes: Array.from(nextTried),
      };
    }
  }

  return {
    action: 'exhausted_server',
    nextTriedModes: Array.from(nextTried),
  };
}

export function resolveManualModeStep({
  modeChain,
  currentMode,
  direction,
}: {
  modeChain: ReadonlyArray<WatchMode>;
  currentMode: WatchMode;
  direction: 'next' | 'prev';
}): WatchMode {
  if (modeChain.length === 0) return currentMode;
  const idx = modeChain.indexOf(currentMode);
  if (idx === -1) return modeChain[0];
  if (direction === 'next') {
    return modeChain[(idx + 1) % modeChain.length];
  }
  return modeChain[(idx - 1 + modeChain.length) % modeChain.length];
}

export function getSmartPlayStatusMessage(
  state: SmartPlayState,
  mode: WatchMode,
  customDetail?: string
): string {
  const modeInfo = getWatchModeDisplayInfo(mode);
  switch (state) {
    case 'initializing':
      return 'جاري تهيئة المشغل...';
    case 'trying_mode':
      return mode === 'direct_unrestricted'
        ? 'جاري تجربة وضع التوافق المباشر...'
        : `جاري تجربة ${modeInfo.label}...`;
    case 'mode_failed_retrying':
      return customDetail || 'تعذر التشغيل بهذا الوضع، جاري تجربة وضع آخر...';
    case 'autoplay_blocked':
      return 'المتصفح يتطلب نقرة لبدء التشغيل — اضغط تشغيل للمتابعة.';
    case 'page_loaded_ready':
      return 'صفحة المشغل متاحة — اضغط تشغيل للمشاهدة أو بدّل الوضع إذا لم يبدأ الفيديو.';
    case 'confirmed_playing':
      return 'تم بدء تشغيل الفيديو بنجاح.';
    case 'server_exhausted':
      return 'لم نتمكن من تشغيل هذا السيرفر، يمكنك تجربة سيرفر آخر.';
    default:
      return 'اضغط لبدء تشغيل الفيديو.';
  }
}


