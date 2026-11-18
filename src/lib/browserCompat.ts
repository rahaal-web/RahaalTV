// Browser, Android WebView & TV device compatibility utilities.
// Provides safe fallbacks for older Android WebView (Chrome 90+), iOS Safari 15+,
// Samsung Internet, and Smart TV / Android TV environments.

export interface DisplayDevicePrefs {
  tvMode: boolean;
  tvScale: 'normal' | 'large' | 'xlarge';
  lowSpecMode: boolean;
  highContrastFocus: boolean;
  updatedAt: number;
}

export interface ClientCapabilities {
  userAgent: string;
  platform: 'android-tv' | 'android-webview' | 'android-browser' | 'ios' | 'desktop' | 'unknown';
  browserName: string;
  browserVersion: string;
  supportsAbortSignalTimeout: boolean;
  supportsClipboardApi: boolean;
  supportsDvh: boolean;
  supportsBackdropFilter: boolean;
  supportsNativeHls: boolean;
  supportsMse: boolean;
  supportsPictureInPicture: boolean;
  supportsIntersectionObserver: boolean;
  supportsServiceWorker: boolean;
  prefersReducedMotion: boolean;
  isTouchDevice: boolean;
  deviceMemoryGb: number | null;
  hardwareConcurrency: number | null;
  viewportWidth: number;
  viewportHeight: number;
  baselineSupported: boolean;
  baselineNotes: string[];
}

const DISPLAY_PREFS_STORAGE_KEY = 'rahal_display_device_prefs_v1';

export const DEFAULT_DISPLAY_DEVICE_PREFS: DisplayDevicePrefs = {
  tvMode: false,
  tvScale: 'large',
  lowSpecMode: false,
  highContrastFocus: true,
  updatedAt: 0,
};

/**
 * Polyfill/replacement for `AbortSignal.timeout(ms)` which crashes on
 * Chrome / Android WebView < 103, Samsung Internet < 19, and Safari < 16.4.
 */
export function createTimeoutSignal(ms: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 8000;
  const timerId = setTimeout(() => {
    try {
      controller.abort(new Error(`Request timed out after ${safeMs}ms`));
    } catch {
      controller.abort();
    }
  }, safeMs);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timerId),
  };
}

/**
 * Safe UUID/ID generator compatible with HTTP localhost, older WebViews,
 * and environments without `crypto.randomUUID`.
 */
export function safeRandomId(prefix = 'id'): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}_${crypto.randomUUID()}`;
    }
  } catch {
    // Fallback below
  }
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rand}`;
}

/**
 * Clipboard copy with automatic fallback to `document.execCommand('copy')`
 * for Android WebViews and non-secure contexts where `navigator.clipboard` fails.
 */
export async function safeCopyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to textarea fallback
  }

  if (typeof document === 'undefined') return false;
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

/**
 * Cross-browser fullscreen helpers supporting standard, WebKit (iOS/Safari), and Android TV.
 */
export function getFullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null;
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
    mozFullScreenElement?: Element | null;
    msFullscreenElement?: Element | null;
  };
  return (
    doc.fullscreenElement ||
    doc.webkitFullscreenElement ||
    doc.mozFullScreenElement ||
    doc.msFullscreenElement ||
    null
  );
}

export async function requestElementFullscreen(el: HTMLElement | null): Promise<boolean> {
  if (!el) return false;
  const target = el as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
    webkitEnterFullscreen?: () => void;
    mozRequestFullScreen?: () => Promise<void> | void;
    msRequestFullscreen?: () => Promise<void> | void;
  };
  try {
    if (typeof target.requestFullscreen === 'function') {
      await target.requestFullscreen();
      return true;
    }
    if (typeof target.webkitRequestFullscreen === 'function') {
      await target.webkitRequestFullscreen();
      return true;
    }
    if (typeof target.webkitEnterFullscreen === 'function') {
      target.webkitEnterFullscreen();
      return true;
    }
    if (typeof target.mozRequestFullScreen === 'function') {
      await target.mozRequestFullScreen();
      return true;
    }
    if (typeof target.msRequestFullscreen === 'function') {
      await target.msRequestFullscreen();
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export async function exitAnyFullscreen(): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  const doc = document as Document & {
    webkitExitFullscreen?: () => Promise<void> | void;
    mozCancelFullScreen?: () => Promise<void> | void;
    msExitFullscreen?: () => Promise<void> | void;
  };
  try {
    if (typeof doc.exitFullscreen === 'function') {
      await doc.exitFullscreen();
      return true;
    }
    if (typeof doc.webkitExitFullscreen === 'function') {
      await doc.webkitExitFullscreen();
      return true;
    }
    if (typeof doc.mozCancelFullScreen === 'function') {
      await doc.mozCancelFullScreen();
      return true;
    }
    if (typeof doc.msExitFullscreen === 'function') {
      await doc.msExitFullscreen();
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function isLikelyTvUserAgent(ua: string): boolean {
  return /\b(Android\sTV|GoogleTV|AFT[A-Z0-9]+|BRAVIA|SMART-TV|SmartTV|Tizen|Web0S|WebOS|NetCast|MIBOX|Shield|Chromecast|FireTV|CrKey|TV)\b/i.test(
    ua
  );
}

export function loadDisplayDevicePrefs(): DisplayDevicePrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_DISPLAY_DEVICE_PREFS };
  try {
    const raw = window.localStorage.getItem(DISPLAY_PREFS_STORAGE_KEY);
    if (!raw) {
      // Auto-suggest TV mode if user-agent clearly identifies a TV device
      const autoTv = isLikelyTvUserAgent(window.navigator?.userAgent || '');
      return {
        ...DEFAULT_DISPLAY_DEVICE_PREFS,
        tvMode: autoTv,
      };
    }
    const parsed = JSON.parse(raw) as Partial<DisplayDevicePrefs>;
    return {
      tvMode: typeof parsed.tvMode === 'boolean' ? parsed.tvMode : false,
      tvScale:
        parsed.tvScale === 'normal' || parsed.tvScale === 'large' || parsed.tvScale === 'xlarge'
          ? parsed.tvScale
          : 'large',
      lowSpecMode: typeof parsed.lowSpecMode === 'boolean' ? parsed.lowSpecMode : false,
      highContrastFocus:
        typeof parsed.highContrastFocus === 'boolean' ? parsed.highContrastFocus : true,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return { ...DEFAULT_DISPLAY_DEVICE_PREFS };
  }
}

export function saveDisplayDevicePrefs(prefs: DisplayDevicePrefs): DisplayDevicePrefs {
  const next: DisplayDevicePrefs = {
    ...prefs,
    updatedAt: Date.now(),
  };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(DISPLAY_PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  }
  applyDisplayDevicePrefs(next);
  return next;
}

export function applyDisplayDevicePrefs(prefs: DisplayDevicePrefs): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (prefs.tvMode) {
    root.setAttribute('data-rtv-tv-mode', 'true');
    root.setAttribute('data-rtv-tv-scale', prefs.tvScale);
  } else {
    root.removeAttribute('data-rtv-tv-mode');
    root.removeAttribute('data-rtv-tv-scale');
  }

  if (prefs.lowSpecMode) {
    root.setAttribute('data-rtv-low-spec', 'true');
  } else {
    root.removeAttribute('data-rtv-low-spec');
  }

  if (prefs.highContrastFocus) {
    root.setAttribute('data-rtv-high-focus', 'true');
  } else {
    root.removeAttribute('data-rtv-high-focus');
  }
}

export function detectClientCapabilities(): ClientCapabilities {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      userAgent: 'server',
      platform: 'unknown',
      browserName: 'Node',
      browserVersion: '',
      supportsAbortSignalTimeout: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal,
      supportsClipboardApi: false,
      supportsDvh: false,
      supportsBackdropFilter: false,
      supportsNativeHls: false,
      supportsMse: false,
      supportsPictureInPicture: false,
      supportsIntersectionObserver: false,
      supportsServiceWorker: false,
      prefersReducedMotion: false,
      isTouchDevice: false,
      deviceMemoryGb: null,
      hardwareConcurrency: null,
      viewportWidth: 0,
      viewportHeight: 0,
      baselineSupported: true,
      baselineNotes: [],
    };
  }

  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIos = /iPhone|iPad|iPod/i.test(ua);
  const isWebView =
    (isAndroid && /; wv\)/i.test(ua)) ||
    /\bVersion\/\d+\.\d+\s+Chrome\/\d+/i.test(ua);
  const isTv = isLikelyTvUserAgent(ua);

  let platform: ClientCapabilities['platform'] = 'desktop';
  if (isTv) platform = 'android-tv';
  else if (isWebView) platform = 'android-webview';
  else if (isAndroid) platform = 'android-browser';
  else if (isIos) platform = 'ios';

  let browserName = 'Unknown';
  let browserVersion = '';
  const samsungMatch = ua.match(/SamsungBrowser\/(\d+(\.\d+)?)/i);
  const edgeMatch = ua.match(/EdgA?\/(\d+(\.\d+)?)/i);
  const firefoxMatch = ua.match(/Firefox\/(\d+(\.\d+)?)/i);
  const chromeMatch = ua.match(/Chrome\/(\d+(\.\d+)?)/i);
  const safariMatch = ua.match(/Version\/(\d+(\.\d+)?).*Safari/i);

  if (samsungMatch) {
    browserName = 'Samsung Internet';
    browserVersion = samsungMatch[1];
  } else if (edgeMatch) {
    browserName = 'Microsoft Edge';
    browserVersion = edgeMatch[1];
  } else if (firefoxMatch) {
    browserName = 'Firefox';
    browserVersion = firefoxMatch[1];
  } else if (chromeMatch) {
    browserName = isWebView ? 'Android WebView (Chromium)' : 'Chrome';
    browserVersion = chromeMatch[1];
  } else if (safariMatch) {
    browserName = 'Safari';
    browserVersion = safariMatch[1];
  }

  const supportsAbortSignalTimeout =
    typeof AbortSignal !== 'undefined' &&
    typeof (AbortSignal as unknown as { timeout?: unknown }).timeout === 'function';

  const supportsClipboardApi =
    Boolean(navigator.clipboard && typeof navigator.clipboard.writeText === 'function');

  const supportsDvh =
    typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
      ? CSS.supports('height', '100dvh')
      : false;

  const supportsBackdropFilter =
    typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
      ? CSS.supports('backdrop-filter', 'blur(8px)') ||
        CSS.supports('-webkit-backdrop-filter', 'blur(8px)')
      : false;

  let supportsNativeHls = false;
  if (typeof document !== 'undefined') {
    const video = document.createElement('video');
    if (typeof video.canPlayType === 'function') {
      supportsNativeHls =
        video.canPlayType('application/vnd.apple.mpegurl') !== '' ||
        video.canPlayType('application/x-mpegURL') !== '';
    }
  }

  const supportsMse =
    typeof window.MediaSource !== 'undefined' ||
    typeof (window as unknown as { ManagedMediaSource?: unknown }).ManagedMediaSource !== 'undefined';

  const supportsPictureInPicture =
    typeof document !== 'undefined' &&
    Boolean((document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled);

  const supportsIntersectionObserver = typeof IntersectionObserver !== 'undefined';

  const supportsServiceWorker = 'serviceWorker' in navigator;

  const prefersReducedMotion =
    typeof window.matchMedia === 'function'
      ? Boolean(window.matchMedia('(prefers-reduced-motion: reduce)')?.matches)
      : false;

  const isTouchDevice =
    'ontouchstart' in window || (typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0);

  const navExtra = navigator as Navigator & { deviceMemory?: number };
  const deviceMemoryGb = typeof navExtra.deviceMemory === 'number' ? navExtra.deviceMemory : null;
  const hardwareConcurrency =
    typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null;

  const baselineNotes: string[] = [];
  let baselineSupported = true;
  const majorVer = parseInt(browserVersion.split('.')[0] || '0', 10);

  if ((browserName.includes('Chrome') || browserName.includes('Edge')) && majorVer > 0 && majorVer < 90) {
    baselineSupported = false;
    baselineNotes.push(`إصدار Chromium (${majorVer}) أقدم من الحد الأدنى المدعوم (90+).`);
  }
  if (browserName === 'Firefox' && majorVer > 0 && majorVer < 90) {
    baselineSupported = false;
    baselineNotes.push(`إصدار Firefox (${majorVer}) أقدم من الحد الأدنى المدعوم (90+).`);
  }
  if (browserName === 'Samsung Internet' && majorVer > 0 && majorVer < 15) {
    baselineSupported = false;
    baselineNotes.push(`إصدار Samsung Internet (${majorVer}) أقدم من الحد الأدنى المدعوم (15+).`);
  }
  if (browserName === 'Safari' && majorVer > 0 && majorVer < 15) {
    baselineSupported = false;
    baselineNotes.push(`إصدار Safari (${majorVer}) أقدم من الحد الأدنى المدعوم (15+).`);
  }
  if (!supportsDvh) {
    baselineNotes.push('المتصفح لا يدعم 100dvh — تم تفعيل بديل 100vh تلقائياً.');
  }
  if (!supportsAbortSignalTimeout) {
    baselineNotes.push('المتصفح لا يدعم AbortSignal.timeout — تم تفعيل بديل AbortController الآمن.');
  }
  if (!supportsBackdropFilter || (deviceMemoryGb !== null && deviceMemoryGb <= 2)) {
    baselineNotes.push('جهاز بموارد محدودة — يُنصح بتفعيل وضع تخفيف المؤثرات البصرية.');
  }

  return {
    userAgent: ua,
    platform,
    browserName,
    browserVersion,
    supportsAbortSignalTimeout,
    supportsClipboardApi,
    supportsDvh,
    supportsBackdropFilter,
    supportsNativeHls,
    supportsMse,
    supportsPictureInPicture,
    supportsIntersectionObserver,
    supportsServiceWorker,
    prefersReducedMotion,
    isTouchDevice,
    deviceMemoryGb,
    hardwareConcurrency,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    baselineSupported,
    baselineNotes,
  };
}
