import {
  PopupShieldCompatibility,
  PopupShieldConfig,
  PopupShieldHostRule,
  PopupShieldLogEntry,
  PopupShieldProfileMode,
  PopupShieldServerInspection,
} from '../types/media';
import {
  fetchViaBrowserOrCorsRelay,
  isLikelyNonVideoWebsiteUrl,
  resolveApiEndpoint,
  shouldSkipBackendApiCalls,
} from './clientScraper';

export const POPUP_SHIELD_STORAGE_KEY = 'rahaltv_popup_shield_v1';
export const POPUP_SHIELD_LOGS_STORAGE_KEY = 'rahaltv_popup_shield_logs_v1';
const MAX_LOG_ENTRIES = 120;

export const DEFAULT_POPUP_SHIELD_CONFIG: PopupShieldConfig = {
  enabled: true,
  defaultStrategy: 'adaptive',
  blockWindowOpen: true,
  guardBlankLinks: true,
  autoFallbackOnReject: true,
  showPlayerBadge: true,
  hostRules: {},
};

const STRICT_SANDBOX_COMPATIBLE_PATTERNS: RegExp[] = [
  /(^|\.)youtube\.com$/i,
  /(^|\.)youtube-nocookie\.com$/i,
  /(^|\.)youtu\.be$/i,
  /(^|\.)vimeo\.com$/i,
  /(^|\.)player\.vimeo\.com$/i,
  /(^|\.)dailymotion\.com$/i,
  /(^|\.)ok\.ru$/i,
  /(^|\.)vk\.com$/i,
  /(^|\.)vkvideo\.ru$/i,
  /(^|\.)drive\.google\.com$/i,
  /(^|\.)archive\.org$/i,
  /(^|\.)odysee\.com$/i,
  /(^|\.)rumble\.com$/i,
  /(^|\.)streamable\.com$/i,
  /(^|\.)uqload\.[a-z0-9.]+$/i,
  /(^|\.)mp4upload\.com$/i,
  /(^|\.)sibnet\.ru$/i,
  /(^|\.)my\.mail\.ru$/i,
  /(^|\.)vidoza\.net$/i,
  /(^|\.)yourupload\.com$/i,
  /(^|\.)mega\.nz$/i,
];

const SANDBOX_INCOMPATIBLE_HOST_PATTERNS: RegExp[] = [
  /(^|\.)vidmoly\.[a-z0-9.]+$/i,
  /(^|\.)dood[a-z0-9-]*\.[a-z0-9.]+$/i,
  /(^|\.)ds2play\.[a-z0-9.]+$/i,
  /(^|\.)do0od\.[a-z0-9.]+$/i,
  /(^|\.)streamwish[a-z0-9-]*\.[a-z0-9.]+$/i,
  /(^|\.)wishfast\.[a-z0-9.]+$/i,
  /(^|\.)filemoon\.[a-z0-9.]+$/i,
  /(^|\.)streamtape\.[a-z0-9.]+$/i,
  /(^|\.)voe\.[a-z0-9.]+$/i,
  /(^|\.)earnvids\.[a-z0-9.]+$/i,
  /(^|\.)mixdrop[a-z0-9-]*\.[a-z0-9.]+$/i,
  /(^|\.)vidhide[a-z0-9-]*\.[a-z0-9.]+$/i,
  /(^|\.)luluvdo\.[a-z0-9.]+$/i,
  /(^|\.)lulustream\.[a-z0-9.]+$/i,
  /(^|\.)filelions\.[a-z0-9.]+$/i,
  /(^|\.)rpmshare\.[a-z0-9.]+$/i,
  /(^|\.)upns\.[a-z0-9.]+$/i,
];

const REDIRECT_GUARD_HOST_PATTERNS: RegExp[] = [
  /(^|\.)vidsrc\.[a-z0-9.]+$/i,
  /(^|\.)2embed\.[a-z0-9.]+$/i,
  /(^|\.)superembed\.[a-z0-9.]+$/i,
  /(^|\.)megacloud\.[a-z0-9.]+$/i,
  /(^|\.)rabbitstream\.[a-z0-9.]+$/i,
  /(^|\.)dokicloud\.[a-z0-9.]+$/i,
  /(^|\.)fembed\.[a-z0-9.]+$/i,
  /(^|\.)sendvid\.com$/i,
];

const KNOWN_AD_URL_PATTERNS: RegExp[] = [
  /popads\.net/i,
  /popcash\.net/i,
  /adsterra/i,
  /propellerads/i,
  /clickadu/i,
  /hilltopads/i,
  /admaven/i,
  /exoclick/i,
  /juicyads/i,
  /trafficjunky/i,
  /monetag/i,
  /onclicka/i,
  /doubleclick\.net/i,
  /googlesyndication\.com/i,
  /aclib\.js/i,
  /popunder/i,
  /highcpmgate/i,
  /profitablecpmrate/i,
];

const AUTH_AND_TRUSTED_HOSTS: RegExp[] = [
  /(^|\.)accounts\.google\.com$/i,
  /(^|\.)apis\.google\.com$/i,
  /(^|\.)appleid\.apple\.com$/i,
  /(^|\.)firebaseapp\.com$/i,
  /(^|\.)web\.app$/i,
  /(^|\.)console\.firebase\.google\.com$/i,
  /(^|\.)firebase\.google\.com$/i,
  /(^|\.)dash\.cloudflare\.com$/i,
];

export interface ActiveShieldPlayerContext {
  serverHost: string;
  serverName: string;
  mediaTitle: string;
  mode: PopupShieldProfileMode;
}

let activePlayerContext: ActiveShieldPlayerContext | null = null;
let liveShieldConfigCache: PopupShieldConfig | null = null;
const logSubscribers = new Set<(logs: PopupShieldLogEntry[]) => void>();
let guardsInstalled = false;

export function extractServerHost(rawUrl?: string | null): string {
  const input = String(rawUrl || '').trim();
  if (!input) return '';
  try {
    const srcMatch = input.match(/src\s*=\s*["']([^"']+)["']/i);
    const candidate = srcMatch ? srcMatch[1].trim() : input;
    const parsed = new URL(candidate);
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function isDirectVideoStreamUrl(rawUrl?: string | null): boolean {
  const input = String(rawUrl || '').trim();
  if (!input) return false;
  return /\.(mp4|webm|ogg|m3u8)(\?|$)/i.test(input);
}

export function isSuspiciousAdUrl(rawUrl?: string | null): boolean {
  const value = String(rawUrl || '').trim();
  if (!value) return false;
  return KNOWN_AD_URL_PATTERNS.some((rx) => rx.test(value));
}

export function isTrustedAuthOrInternalUrl(rawUrl?: string | null): boolean {
  const value = String(rawUrl || '').trim();
  if (!value) return false;
  try {
    const baseOrigin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://rahaltv.local';
    const resolved = new URL(value, baseOrigin);
    if (typeof window !== 'undefined' && resolved.origin === window.location.origin) {
      return true;
    }
    if (AUTH_AND_TRUSTED_HOSTS.some((rx) => rx.test(resolved.hostname))) {
      return true;
    }
    if (resolved.pathname.includes('/__/auth/')) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function normalizePopupShieldConfig(
  raw?: Partial<PopupShieldConfig> | null
): PopupShieldConfig {
  const base = raw && typeof raw === 'object' ? raw : {};
  const strategy: PopupShieldConfig['defaultStrategy'] =
    base.defaultStrategy === 'strict_when_safe' || base.defaultStrategy === 'observe_only'
      ? base.defaultStrategy
      : 'adaptive';

  const normalizedRules: Record<string, PopupShieldHostRule> = {};
  if (base.hostRules && typeof base.hostRules === 'object') {
    Object.entries(base.hostRules)
      .slice(0, 100)
      .forEach(([key, val]) => {
        if (!val || typeof val !== 'object') return;
        const cleanHost = String(val.hostname || key || '')
          .toLowerCase()
          .replace(/^www\./, '')
          .replace(/[^a-z0-9.-]/g, '')
          .slice(0, 120);
        if (!cleanHost) return;
        const mode: PopupShieldHostRule['mode'] =
          val.mode === 'strict_sandbox' ||
          val.mode === 'redirect_guard' ||
          val.mode === 'direct_unrestricted'
            ? val.mode
            : 'direct_unrestricted';
        const compatibility: PopupShieldCompatibility =
          val.compatibility === 'compatible' ||
          val.compatibility === 'partial' ||
          val.compatibility === 'incompatible'
            ? val.compatibility
            : 'untested';
        normalizedRules[cleanHost] = {
          hostname: cleanHost,
          mode,
          compatibility,
          ...(typeof val.note === 'string' && val.note.trim()
            ? { note: val.note.trim().slice(0, 160) }
            : {}),
          ...(Array.isArray(val.adSignals) && val.adSignals.length > 0
            ? {
                adSignals: val.adSignals
                  .map((s) => String(s || '').trim().slice(0, 40))
                  .filter(Boolean)
                  .slice(0, 8),
              }
            : {}),
          ...(typeof val.lastTestedAt === 'string' && val.lastTestedAt.trim()
            ? { lastTestedAt: val.lastTestedAt.trim().slice(0, 40) }
            : {}),
        };
      });
  }

  return {
    enabled: base.enabled !== undefined ? Boolean(base.enabled) : DEFAULT_POPUP_SHIELD_CONFIG.enabled,
    defaultStrategy: strategy,
    blockWindowOpen:
      base.blockWindowOpen !== undefined
        ? Boolean(base.blockWindowOpen)
        : DEFAULT_POPUP_SHIELD_CONFIG.blockWindowOpen,
    guardBlankLinks:
      base.guardBlankLinks !== undefined
        ? Boolean(base.guardBlankLinks)
        : DEFAULT_POPUP_SHIELD_CONFIG.guardBlankLinks,
    autoFallbackOnReject:
      base.autoFallbackOnReject !== undefined
        ? Boolean(base.autoFallbackOnReject)
        : DEFAULT_POPUP_SHIELD_CONFIG.autoFallbackOnReject,
    showPlayerBadge:
      base.showPlayerBadge !== undefined
        ? Boolean(base.showPlayerBadge)
        : DEFAULT_POPUP_SHIELD_CONFIG.showPlayerBadge,
    hostRules: normalizedRules,
  };
}

export function loadStoredPopupShieldConfig(): PopupShieldConfig {
  if (liveShieldConfigCache) return liveShieldConfigCache;
  if (typeof window === 'undefined') return DEFAULT_POPUP_SHIELD_CONFIG;
  try {
    const raw = window.localStorage.getItem(POPUP_SHIELD_STORAGE_KEY);
    if (!raw) {
      liveShieldConfigCache = DEFAULT_POPUP_SHIELD_CONFIG;
      return liveShieldConfigCache;
    }
    const parsed = JSON.parse(raw) as Partial<PopupShieldConfig>;
    liveShieldConfigCache = normalizePopupShieldConfig(parsed);
    return liveShieldConfigCache;
  } catch {
    return DEFAULT_POPUP_SHIELD_CONFIG;
  }
}

export function saveStoredPopupShieldConfig(
  cfg: Partial<PopupShieldConfig> | PopupShieldConfig
): PopupShieldConfig {
  const normalized = normalizePopupShieldConfig(cfg);
  liveShieldConfigCache = normalized;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(POPUP_SHIELD_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Ignore storage quota errors
    }
  }
  return normalized;
}

export function setLiveShieldConfig(cfg?: PopupShieldConfig | null): PopupShieldConfig {
  const normalized = normalizePopupShieldConfig(cfg || DEFAULT_POPUP_SHIELD_CONFIG);
  liveShieldConfigCache = normalized;
  return normalized;
}

export function buildIframeSandboxAttr(
  mode: PopupShieldProfileMode,
  enabled = true
): string | undefined {
  if (!enabled || mode === 'direct_unrestricted' || mode === 'direct_media') {
    return undefined;
  }
  if (mode === 'strict_sandbox') {
    return 'allow-scripts allow-same-origin allow-forms allow-presentation allow-orientation-lock';
  }
  if (mode === 'redirect_guard') {
    return 'allow-scripts allow-same-origin allow-forms allow-presentation allow-orientation-lock allow-popups allow-popups-to-escape-sandbox';
  }
  return undefined;
}

export function classifyKnownHostDefaults(hostname: string): {
  mode: Exclude<PopupShieldProfileMode, 'direct_media'>;
  compatibility: PopupShieldCompatibility;
  reason: string;
} {
  const cleanHost = String(hostname || '').toLowerCase().replace(/^www\./, '');
  if (!cleanHost) {
    return {
      mode: 'direct_unrestricted',
      compatibility: 'untested',
      reason: 'تعذر تحديد نطاق السيرفر',
    };
  }
  if (STRICT_SANDBOX_COMPATIBLE_PATTERNS.some((rx) => rx.test(cleanHost))) {
    return {
      mode: 'strict_sandbox',
      compatibility: 'compatible',
      reason: 'السيرفر متوافق مع العزل الصارم دون التأثير على التشغيل أو ملء الشاشة',
    };
  }
  if (SANDBOX_INCOMPATIBLE_HOST_PATTERNS.some((rx) => rx.test(cleanHost))) {
    return {
      mode: 'direct_unrestricted',
      compatibility: 'incompatible',
      reason: 'هذا المزوّد يرفض iframe sandbox ويُشغّل في وضع التوافق المباشر لضمان عدم توقف الفيديو',
    };
  }
  if (REDIRECT_GUARD_HOST_PATTERNS.some((rx) => rx.test(cleanHost))) {
    return {
      mode: 'redirect_guard',
      compatibility: 'partial',
      reason: 'يعمل بحماية منع اختطاف الصفحة الرئيسية (Top-Navigation Guard)',
    };
  }
  return {
    mode: 'strict_sandbox',
    compatibility: 'untested',
    reason: 'غير مختبر بعد — يُختبر بوضع العزل الآمن مع التبديل التلقائي عند الرفض',
  };
}

export interface ShieldDecision {
  mode: PopupShieldProfileMode;
  sandboxAttr: string | undefined;
  compatibility: PopupShieldCompatibility;
  hostname: string;
  label: string;
  shortLabel: string;
  description: string;
  honestPreventionLevel: 'guaranteed_direct' | 'iframe_popups_blocked' | 'top_nav_blocked' | 'unrestricted_observe';
}

export function resolveEffectiveShieldDecision(
  streamUrl: string | null | undefined,
  config?: PopupShieldConfig | null,
  sessionOverrideMode?: Exclude<PopupShieldProfileMode, 'direct_media'> | null
): ShieldDecision {
  const cfg = normalizePopupShieldConfig(config || loadStoredPopupShieldConfig());
  const hostname = extractServerHost(streamUrl);

  if (isDirectVideoStreamUrl(streamUrl)) {
    return {
      mode: 'direct_media',
      sandboxAttr: undefined,
      compatibility: 'compatible',
      hostname,
      label: 'بث مباشر خالٍ من النوافذ المنبثقة',
      shortLabel: 'بث مباشر آمن',
      description: 'يتم التشغيل عبر مشغل HTML5 مباشر بدون أي iframe أو إعلانات نوافذ.',
      honestPreventionLevel: 'guaranteed_direct',
    };
  }

  if (!cfg.enabled) {
    return {
      mode: 'direct_unrestricted',
      sandboxAttr: undefined,
      compatibility: 'untested',
      hostname,
      label: 'الدرع متوقف من الإعدادات',
      shortLabel: 'بدون عزل',
      description: 'تم تعطيل حماية النوافذ المنبثقة حالياً من لوحة الإدارة.',
      honestPreventionLevel: 'unrestricted_observe',
    };
  }

  let mode: Exclude<PopupShieldProfileMode, 'direct_media'>;
  let compatibility: PopupShieldCompatibility;
  let customNote = '';

  const savedRule = hostname ? cfg.hostRules[hostname] : undefined;
  if (sessionOverrideMode) {
    mode = sessionOverrideMode;
    compatibility = savedRule?.compatibility || (mode === 'direct_unrestricted' ? 'incompatible' : 'compatible');
    customNote = 'تم التبديل المؤقت لوضع التوافق أثناء هذه الجلسة.';
  } else if (cfg.defaultStrategy === 'observe_only') {
    mode = 'direct_unrestricted';
    compatibility = savedRule?.compatibility || 'untested';
    customNote = 'وضع المراقبة فقط: يمنع نوافذ الصفحة الأم ويراقب السيرفر دون تقييد iframe.';
  } else if (savedRule) {
    mode = savedRule.mode;
    compatibility = savedRule.compatibility;
    customNote = savedRule.note || '';
  } else {
    const known = classifyKnownHostDefaults(hostname);
    if (cfg.defaultStrategy === 'strict_when_safe' && known.compatibility === 'partial') {
      mode = 'strict_sandbox';
    } else {
      mode = known.mode;
    }
    compatibility = known.compatibility;
    customNote = known.reason;
  }

  const sandboxAttr = buildIframeSandboxAttr(mode, true);

  if (mode === 'strict_sandbox') {
    return {
      mode,
      sandboxAttr,
      compatibility,
      hostname,
      label: 'محمي بـ Sandbox صارم',
      shortLabel: 'حماية كاملة للـ iframe',
      description: customNote || 'يمنع المتصفح فتح النوافذ المنبثقة وتغيير المسار من داخل السيرفر.',
      honestPreventionLevel: 'iframe_popups_blocked',
    };
  }

  if (mode === 'redirect_guard') {
    return {
      mode,
      sandboxAttr,
      compatibility,
      hostname,
      label: 'حماية منع تحويل الصفحة',
      shortLabel: 'منع تحويل الصفحة',
      description:
        customNote ||
        'يمنع السيرفر من إعادة توجيه الموقع الرئيسي، لكن السيرفر قد يفتح نافذة منبثقة لأنه يشترط allow-popups.',
      honestPreventionLevel: 'top_nav_blocked',
    };
  }

  return {
    mode: 'direct_unrestricted',
    sandboxAttr: undefined,
    compatibility,
    hostname,
    label: 'تشغيل مباشر للتوافق الكامل',
    shortLabel: 'وضع التوافق المباشر',
    description:
      customNote ||
      'السيرفر لا يقبل sandbox. حماية الصفحة الأم نشطة، وقد يفتح السيرفر الخارجي تبويباً من داخل نطاقه المحمي بـ Cross-Origin.',
    honestPreventionLevel: 'unrestricted_observe',
  };
}

export function inspectHtmlForShieldSignals(
  rawUrl: string,
  htmlSnippet: string,
  headers?: { xFrame?: string; csp?: string }
): Omit<PopupShieldServerInspection, 'testedAt'> {
  const hostname = extractServerHost(rawUrl);
  const urlStr = String(rawUrl || '').trim();

  if (isDirectVideoStreamUrl(urlStr)) {
    return {
      hostname,
      url: urlStr,
      reachable: true,
      compatibility: 'compatible',
      recommendedMode: 'direct_media',
      antiSandboxDetected: false,
      adScriptDetected: false,
      adSignals: [],
      directStreamUrl: urlStr,
      reason: 'رابط فيديو مباشر (.mp4 / .m3u8) لا يحتاج iframe ولا يفتح نوافذ إعلانية.',
    };
  }

  const html = String(htmlSnippet || '');
  const adSignals: string[] = [];

  const signalMatchers: Array<{ label: string; regex: RegExp }> = [
    { label: 'popads', regex: /popads\.net|popads/i },
    { label: 'popcash', regex: /popcash\.net|popcash/i },
    { label: 'adsterra', regex: /adsterra|highcpmgate|profitablecpmrate/i },
    { label: 'propellerads / monetag', regex: /propellerads|monetag|aclib/i },
    { label: 'clickadu / hilltopads', regex: /clickadu|hilltopads|admaven/i },
    { label: 'window.open script', regex: /window\.open\s*\(/i },
    { label: 'target=_blank handler', regex: /target\s*=\s*["']_blank["']|setAttribute\(["']target["'],\s*["']_blank["']\)/i },
    { label: 'popunder trigger', regex: /popunder|openPop|triggerPop/i },
  ];

  for (const matcher of signalMatchers) {
    if (matcher.regex.test(html)) {
      adSignals.push(matcher.label);
    }
  }

  const antiSandboxExplicit =
    /sandboxed\s+embed|please\s+disable\s+sandbox|embedding\s+in\s+sandbox\s+is\s+not\s+allowed|no[-_\s]?sandbox/i.test(
      html
    ) || /window\.frameElement|top\s*!==?\s*self|self\s*!==?\s*top|top\.location\s*!=\s*self\.location/i.test(html);

  const mp4Match =
    html.match(/<(?:video|source)[^>]+src=["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)["']/i)?.[1] ||
    html.match(/(?:file|src|video_url|mp4_url)\s*:\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)["']/i)?.[1] ||
    null;

  const xFrame = String(headers?.xFrame || '').toLowerCase();
  const csp = String(headers?.csp || '').toLowerCase();
  const frameBlocked =
    xFrame.includes('deny') ||
    xFrame.includes('sameorigin') ||
    /frame-ancestors\s+[^;]*'none'|frame-ancestors\s+'self'/i.test(csp);

  const known = classifyKnownHostDefaults(hostname);

  if (mp4Match) {
    return {
      hostname,
      url: urlStr,
      reachable: true,
      compatibility: 'compatible',
      recommendedMode: 'direct_media',
      antiSandboxDetected: antiSandboxExplicit,
      adScriptDetected: adSignals.length > 0,
      adSignals,
      directStreamUrl: mp4Match.replace(/\\\//g, '/'),
      reason: 'تم العثور على رابط بث مباشر داخل السيرفر (أفضل حماية ممكنة بدون إعلانات).',
    };
  }

  if (frameBlocked) {
    return {
      hostname,
      url: urlStr,
      reachable: true,
      compatibility: 'incompatible',
      recommendedMode: 'direct_unrestricted',
      antiSandboxDetected: true,
      adScriptDetected: adSignals.length > 0,
      adSignals,
      reason: 'السيرفر يرسل ترويسة X-Frame-Options أو CSP قد تقيد التضمين.',
    };
  }

  if (antiSandboxExplicit || known.compatibility === 'incompatible') {
    return {
      hostname,
      url: urlStr,
      reachable: true,
      compatibility: 'incompatible',
      recommendedMode: 'direct_unrestricted',
      antiSandboxDetected: true,
      adScriptDetected: adSignals.length > 0,
      adSignals,
      reason: antiSandboxExplicit
        ? 'تم رصد فحص رفض Sandbox داخل كود السيرفر — ينصح بوضع التوافق المباشر لعدم توقف الفيديو.'
        : known.reason,
    };
  }

  if (known.mode === 'redirect_guard') {
    return {
      hostname,
      url: urlStr,
      reachable: true,
      compatibility: 'partial',
      recommendedMode: 'redirect_guard',
      antiSandboxDetected: false,
      adScriptDetected: adSignals.length > 0,
      adSignals,
      reason: known.reason,
    };
  }

  return {
    hostname,
    url: urlStr,
    reachable: true,
    compatibility: 'compatible',
    recommendedMode: 'strict_sandbox',
    antiSandboxDetected: false,
    adScriptDetected: adSignals.length > 0,
    adSignals,
    reason:
      adSignals.length > 0
        ? `تم رصد إشارات نوافذ منبثقة (${adSignals.slice(0, 3).join('، ')}) ولم يظهر رفض لـ Sandbox — مناسب للحماية الصارمة.`
        : 'متوافق مع الحماية الصارمة (strict_sandbox) دون مؤشرات على كسر التشغيل.',
  };
}

export async function inspectServerPopupCompatibility(
  rawUrl: string
): Promise<PopupShieldServerInspection> {
  const urlStr = String(rawUrl || '').trim();
  const hostname = extractServerHost(urlStr);
  const testedAt = new Date().toISOString();

  if (!urlStr || !/^https?:\/\//i.test(urlStr)) {
    return {
      hostname,
      url: urlStr,
      reachable: false,
      compatibility: 'untested',
      recommendedMode: 'direct_unrestricted',
      antiSandboxDetected: false,
      adScriptDetected: false,
      adSignals: [],
      reason: 'رابط السيرفر غير صالح للفحص.',
      testedAt,
    };
  }

  if (isDirectVideoStreamUrl(urlStr)) {
    return {
      ...inspectHtmlForShieldSignals(urlStr, ''),
      testedAt,
    };
  }

  if (isLikelyNonVideoWebsiteUrl(urlStr)) {
    return {
      hostname,
      url: urlStr,
      reachable: true,
      compatibility: 'incompatible',
      recommendedMode: 'direct_unrestricted',
      antiSandboxDetected: true,
      adScriptDetected: false,
      adSignals: [],
      reason: 'الرابط يشير إلى صفحة رئيسية لموقع خارجي وليس مشغل فيديو.',
      testedAt,
    };
  }

  if (!shouldSkipBackendApiCalls()) {
    try {
      const res = await fetch(resolveApiEndpoint('/api/shield-probe'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlStr }),
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        const payload = (await res.json()) as {
          ok?: boolean;
          inspection?: PopupShieldServerInspection;
        };
        if (payload.ok && payload.inspection) {
          return payload.inspection;
        }
      }
    } catch {
      // Static build / offline backend -> fallback to browser CORS proxy probe
    }
  }

  try {
    const fetched = await fetchViaBrowserOrCorsRelay(urlStr, 7000);
    if (fetched && fetched.text) {
      return {
        ...inspectHtmlForShieldSignals(urlStr, fetched.text),
        testedAt,
      };
    }
  } catch {
    // Fall through to no-cors host reachability probe
  }

  let reachable = false;
  if (typeof fetch === 'function') {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4500);
    try {
      await fetch(urlStr, { mode: 'no-cors', signal: ctrl.signal });
      reachable = true;
    } catch {
      reachable = false;
    } finally {
      clearTimeout(timer);
    }
  }

  const known = classifyKnownHostDefaults(hostname);
  return {
    hostname,
    url: urlStr,
    reachable,
    compatibility: known.compatibility,
    recommendedMode: known.mode,
    antiSandboxDetected: known.compatibility === 'incompatible',
    adScriptDetected: known.compatibility !== 'compatible',
    adSignals: [],
    reason: reachable
      ? `${known.reason} (تعذر قراءة مصدر الصفحة مباشرة بسبب CORS، وتم تطبيق قاعدة النطاق)`
      : 'تعذر الوصول إلى السيرفر أثناء الفحص — تم الإبقاء على قاعدة التوافق الآمنة.',
    testedAt,
  };
}

export function loadPopupShieldLogs(): PopupShieldLogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(POPUP_SHIELD_LOGS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PopupShieldLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendPopupShieldLog(
  entry: Omit<PopupShieldLogEntry, 'id' | 'timestamp'>
): PopupShieldLogEntry {
  const fullEntry: PopupShieldLogEntry = {
    ...entry,
    id: `pslog-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
  };

  if (typeof window !== 'undefined') {
    const existing = loadPopupShieldLogs();
    const next = [fullEntry, ...existing].slice(0, MAX_LOG_ENTRIES);
    try {
      window.localStorage.setItem(POPUP_SHIELD_LOGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
    logSubscribers.forEach((cb) => cb(next));
  }
  return fullEntry;
}

export function clearPopupShieldLogs(): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(POPUP_SHIELD_LOGS_STORAGE_KEY);
    } catch {
      // Ignore
    }
    logSubscribers.forEach((cb) => cb([]));
  }
}

export function subscribePopupShieldLogs(
  listener: (logs: PopupShieldLogEntry[]) => void
): () => void {
  logSubscribers.add(listener);
  listener(loadPopupShieldLogs());
  return () => {
    logSubscribers.delete(listener);
  };
}

export function setActiveShieldPlayerContext(ctx: ActiveShieldPlayerContext | null): void {
  activePlayerContext = ctx;
}

export function getActiveShieldPlayerContext(): ActiveShieldPlayerContext | null {
  return activePlayerContext;
}

export function evaluateWindowOpenAttempt(
  targetUrl: string | URL | undefined,
  cfg: PopupShieldConfig,
  playerCtx: ActiveShieldPlayerContext | null,
  triggerElement?: Element | null
): { allow: boolean; reason: string; resolvedUrl: string } {
  const resolvedUrl = targetUrl ? String(targetUrl) : '';
  if (!cfg.enabled || !cfg.blockWindowOpen) {
    return { allow: true, reason: 'shield_disabled', resolvedUrl };
  }
  if (triggerElement && triggerElement.closest('[data-shield-allow="true"]')) {
    return { allow: true, reason: 'explicit_allow', resolvedUrl };
  }
  if (isTrustedAuthOrInternalUrl(resolvedUrl)) {
    return { allow: true, reason: 'trusted_auth_or_internal', resolvedUrl };
  }
  if (isSuspiciousAdUrl(resolvedUrl)) {
    return { allow: false, reason: 'known_ad_domain', resolvedUrl };
  }
  if (playerCtx !== null) {
    return { allow: false, reason: 'blocked_during_playback', resolvedUrl };
  }
  return { allow: true, reason: 'allowed_navigation', resolvedUrl };
}

export function installGlobalPopupShieldGuards(): () => void {
  if (typeof window === 'undefined' || guardsInstalled) {
    return () => {};
  }
  guardsInstalled = true;

  const nativeWindowOpen = typeof window.open === 'function' ? window.open.bind(window) : null;
  let windowOpenPatched = false;

  if (nativeWindowOpen) {
    const shieldedWindowOpen = function shieldedWindowOpen(
      url?: string | URL,
      target?: string,
      features?: string
    ): Window | null {
      const cfg = loadStoredPopupShieldConfig();
      const ctx = activePlayerContext;
      const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
      const verdict = evaluateWindowOpenAttempt(url, cfg, ctx, activeEl);

      if (!verdict.allow) {
        appendPopupShieldLog({
          kind: 'blocked_window_open',
          prevented: true,
          serverHost: ctx?.serverHost || extractServerHost(verdict.resolvedUrl) || 'الصفحة الرئيسية',
          serverName: ctx?.serverName,
          mediaTitle: ctx?.mediaTitle,
          targetUrl: verdict.resolvedUrl || '(تبويب فارغ / إعلاني)',
          detail:
            verdict.reason === 'known_ad_domain'
              ? 'تم اعتراض ومنع محاولة window.open نحو رابط إعلاني معروف.'
              : 'تم اعتراض ومنع محاولة window.open غير مصرح بها أثناء فتح المشغل.',
        });
        return null;
      }

      return nativeWindowOpen(url, target, features);
    };

    try {
      window.open = shieldedWindowOpen;
      windowOpenPatched = true;
    } catch {
      try {
        Object.defineProperty(window, 'open', {
          value: shieldedWindowOpen,
          configurable: true,
          writable: true,
        });
        windowOpenPatched = true;
      } catch {
        // Strict iframe/WebView defines window.open as non-configurable; keep click capture active
      }
    }
  }

  const onCaptureClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const anchor = target.closest('a');
    if (!anchor) return;

    const anchorTarget = (anchor.getAttribute('target') || '').toLowerCase();
    if (anchorTarget !== '_blank') return;
    if (anchor.closest('[data-shield-allow="true"]')) return;

    const href = anchor.getAttribute('href') || '';
    if (isTrustedAuthOrInternalUrl(href)) return;

    const cfg = loadStoredPopupShieldConfig();
    if (!cfg.enabled || !cfg.guardBlankLinks) return;

    const ctx = activePlayerContext;
    const suspicious = isSuspiciousAdUrl(href);

    if (suspicious || ctx !== null) {
      event.preventDefault();
      event.stopPropagation();
      appendPopupShieldLog({
        kind: 'blocked_blank_link',
        prevented: true,
        serverHost: ctx?.serverHost || extractServerHost(href) || 'الصفحة الرئيسية',
        serverName: ctx?.serverName,
        mediaTitle: ctx?.mediaTitle,
        targetUrl: href.slice(0, 220),
        detail: suspicious
          ? 'تم منع فتح رابط target="_blank" مطابق لنطاق إعلاني.'
          : 'تم منع رابط target="_blank" غير موثوق أثناء نشاط المشغل.',
      });
    }
  };

  document.addEventListener('click', onCaptureClick, true);

  return () => {
    if (windowOpenPatched && nativeWindowOpen) {
      try {
        window.open = nativeWindowOpen;
      } catch {
        // Ignore read-only window.open during cleanup
      }
    }
    document.removeEventListener('click', onCaptureClick, true);
    guardsInstalled = false;
  };
}
