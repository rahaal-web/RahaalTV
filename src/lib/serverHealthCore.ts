import type { PopupShieldProfileMode } from '../types/media';

export type ServerHealthStatus =
  | 'confirmed_playing'
  | 'page_available'
  | 'needs_manual_check'
  | 'broken'
  | 'iframe_blocked'
  | 'unknown_error';

export type LegacyServerStatus = 'working' | 'warning' | 'broken';

export type ConnectivityStageStatus =
  | 'reachable'
  | 'cors_restricted'
  | 'http_error'
  | 'timeout'
  | 'network_error'
  | 'invalid_url'
  | 'not_checked';

export type PageLoadStageStatus =
  | 'loaded'
  | 'iframe_blocked'
  | 'sandbox_rejected'
  | 'not_video_page'
  | 'http_failed'
  | 'failed'
  | 'not_checked';

export type PlayerStageStatus =
  | 'playing_verified'
  | 'direct_stream_ready'
  | 'player_detected'
  | 'player_error'
  | 'no_player_found'
  | 'unverified_cross_origin'
  | 'not_checked';

export type HealthReasonCode =
  | 'OK_PLAYING'
  | 'DIRECT_STREAM_READY'
  | 'PAGE_LOADED_UNVERIFIED'
  | 'HTTP_404'
  | 'HTTP_403'
  | 'HTTP_5XX'
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'IFRAME_BLOCKED'
  | 'SANDBOX_REJECTED'
  | 'PLAYER_ERROR'
  | 'PLAYBACK_UNVERIFIED'
  | 'NOT_VIDEO_PAGE'
  | 'CORS_RESTRICTED'
  | 'NETWORK_ERROR'
  | 'INVALID_URL'
  | 'UNKNOWN';

export type CheckMethodKind =
  | 'backend'
  | 'worker'
  | 'cors_relay'
  | 'browser_cors'
  | 'browser_iframe'
  | 'browser_video'
  | 'static';

export interface ServerHealthReport {
  url: string;
  finalUrl?: string;
  serverName?: string;
  status: ServerHealthStatus;
  legacyStatus: LegacyServerStatus;
  statusLabel: string;
  statusEmoji: '🟢' | '🟡' | '🟠' | '🔴' | '⚫';
  httpStatus: number;
  connectivity: {
    status: ConnectivityStageStatus;
    label: string;
    detail: string;
    httpStatus: number;
  };
  pageLoad: {
    status: PageLoadStageStatus;
    label: string;
    detail: string;
    frameBlocked: boolean;
    sandboxRejected: boolean;
  };
  playerCheck: {
    status: PlayerStageStatus;
    label: string;
    detail: string;
    directStreamUrl: string | null;
    playbackConfirmed: boolean;
    autoplayBlocked?: boolean;
  };
  reasonCode: HealthReasonCode;
  reasonText: string;
  checkedAt: string;
  latencyMs: number;
  checkMethod: CheckMethodKind;
  canEmbedInIframe: boolean;
  recommendedModes: PopupShieldProfileMode[];
}

export const SERVER_HEALTH_META: Record<
  ServerHealthStatus,
  {
    status: ServerHealthStatus;
    legacyStatus: LegacyServerStatus;
    label: string;
    shortLabel: string;
    emoji: '🟢' | '🟡' | '🟠' | '🔴' | '⚫';
    description: string;
  }
> = {
  confirmed_playing: {
    status: 'confirmed_playing',
    legacyStatus: 'working',
    label: 'يعمل وتم تأكيد التشغيل',
    shortLabel: 'يعمل ومؤكد',
    emoji: '🟢',
    description: 'تم التحقق فعلياً من جاهزية المشغل وبدء تشغيل الفيديو.',
  },
  page_available: {
    status: 'page_available',
    legacyStatus: 'warning',
    label: 'الصفحة متاحة',
    shortLabel: 'الصفحة متاحة',
    emoji: '🟡',
    description: 'صفحة السيرفر استجابت وتحملت، لكن لم يُؤكد تشغيل الفيديو فعلياً بعد.',
  },
  needs_manual_check: {
    status: 'needs_manual_check',
    legacyStatus: 'warning',
    label: 'يحتاج إلى فحص يدوي',
    shortLabel: 'فحص يدوي',
    emoji: '🟠',
    description: 'تعذر تأكيد التشغيل آلياً بسبب قيود Cross-Origin أو حماية المصدر.',
  },
  broken: {
    status: 'broken',
    legacyStatus: 'broken',
    label: 'لا يعمل',
    shortLabel: 'لا يعمل',
    emoji: '🔴',
    description: 'يوجد خطأ مؤكد مثل 404 أو 403 أو فشل اتصال أو تلف المشغل.',
  },
  iframe_blocked: {
    status: 'iframe_blocked',
    legacyStatus: 'broken',
    label: 'محظور داخل iframe',
    shortLabel: 'محظور بالتضمين',
    emoji: '🔴',
    description: 'المصدر يمنع التضمين عبر X-Frame-Options أو Content-Security-Policy.',
  },
  unknown_error: {
    status: 'unknown_error',
    legacyStatus: 'warning',
    label: 'خطأ غير معروف',
    shortLabel: 'غير معروف',
    emoji: '⚫',
    description: 'لم تتوفر معلومات كافية لتحديد حالة السيرفر بدقة.',
  },
};

export function toLegacyStatus(status: ServerHealthStatus): LegacyServerStatus {
  return SERVER_HEALTH_META[status].legacyStatus;
}

export function isDirectMediaExtensionUrl(rawUrl: string): boolean {
  return /\.(mp4|webm|ogg|m3u8)(\?|$|#)/i.test(String(rawUrl || '').trim());
}

export function isDashManifestUrl(rawUrl: string): boolean {
  return /\.mpd(\?|$|#)/i.test(String(rawUrl || '').trim());
}

export function detectNonVideoWebsiteUrl(rawUrl: string): boolean {
  const cleaned = String(rawUrl || '').trim();
  if (!cleaned) return true;
  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    return true;
  }

  const pathname = parsed.pathname.toLowerCase();
  const full = parsed.toString().toLowerCase();

  if (/\.(mp4|m3u8|webm|ogg|mpd)(\?|$)/i.test(full)) {
    return false;
  }

  if (
    /\/(embed|e|v|f|d|player|play|watch|video|stream|iframe|hls|cdn)\b/i.test(pathname) ||
    /[?&](id|v|url|src|file|stream|embed|video)=/i.test(parsed.search) ||
    /youtube\.com\/watch|youtu\.be\/|vimeo\.com\/\d+|ok\.ru\/video|dailymotion\.com\/video|vk\.com\/video|drive\.google\.com\/file/i.test(
      full
    )
  ) {
    return false;
  }

  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  if (
    normalizedPath === '/' ||
    /^\/(?:home|index(?:\.[a-z0-9]+)?|main|portal|movies|series|anime|tv|categories?|category|genre|genres|tag|tags|search|login|register|account|user|profile|privacy|terms|contact|about|dmca|faq|news|blog)(?:\/\d+)?$/i.test(
      normalizedPath
    ) ||
    /^\/home\.\d+$/i.test(normalizedPath) ||
    /[?&](page|paged|s|q|sort|filter|category|genre)=/i.test(parsed.search)
  ) {
    return true;
  }

  return false;
}

export function hasRealVideoPlayerMarkupCore(snippet: string): boolean {
  if (!snippet) return false;
  return (
    /<video\b|<source\b[^>]+src=|\.mp4\b|\.m3u8\b|\.mpd\b|jwplayer\s*\(|videojs\s*\(|new\s+Plyr\b|Hls\.isSupported|Clappr\.Player|Artplayer|DPlayer|FluidPlayer|flowplayer|sources\s*:\s*\[|file\s*:\s*["']https?:\/\/|eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k/i.test(
      snippet
    ) ||
    /<iframe[^>]+src=["'][^"']*(?:embed|player|vid|stream|mp4|m3u8|dood|uqload|filemoon|streamtape|vidmoly|ok\.ru|vk\.com|mail\.ru|youtube|vimeo)[^"']*["']/i.test(
      snippet
    )
  );
}

export function isWebsitePortalHtmlCore(finalUrl: string, snippet: string): boolean {
  if (finalUrl && detectNonVideoWebsiteUrl(finalUrl)) return true;
  if (!snippet) return false;
  if (hasRealVideoPlayerMarkupCore(snippet)) return false;

  const hasPortalNavOrHomeTitle =
    /<title>[^<]*(?:الصفحة\s*الرئيسية|الرئيسية\s*[-|–]|لاروزا|Larooza|موقع\s*فيديو|ماي\s*سيما|اكوام|أكوام|أفلام\s*و?مسلسلات|قائمة\s*الأفلام|قائمة\s*المسلسلات)[^<]*<\/title>/i.test(
      snippet
    ) ||
    /الصفحة\s*الرئيسية/i.test(snippet) ||
    (/<nav\b/i.test(snippet) &&
      /(?:أضيف\s*حديث[اًا]|اضيف\s*حديث[اًا]|مسلسلات\s*رمضان|برامج\s*تلفزيونية|جميع\s*الأفلام|جميع\s*المسلسلات)/i.test(
        snippet
      )) ||
    (/placeholder=["'][^"']*(?:ابحث|بحث|search)[^"']*["']/i.test(snippet) &&
      /(?:مسلسلات|أفلام|افلام)/i.test(snippet));

  if (hasPortalNavOrHomeTitle) return true;

  const hasFullSiteChrome =
    /<(header|nav|footer)\b/i.test(snippet) &&
    (snippet.match(/<a\b[^>]+href=/gi)?.length || 0) >= 12;

  return hasFullSiteChrome;
}

export function detectFrameBlockHeaders(
  xFrameOptions: string,
  csp: string,
  embedderOrigin?: string
): { blocked: boolean; policyDetail: string } {
  const xFrame = String(xFrameOptions || '').toLowerCase().trim();
  const cspLower = String(csp || '').toLowerCase().trim();

  if (xFrame.includes('deny')) {
    return { blocked: true, policyDetail: 'X-Frame-Options: DENY' };
  }
  if (xFrame.includes('sameorigin')) {
    return { blocked: true, policyDetail: 'X-Frame-Options: SAMEORIGIN' };
  }

  const faMatch = cspLower.match(/frame-ancestors\s+([^;]+)/i);
  if (faMatch?.[1]) {
    const directive = faMatch[1].trim();
    if (directive.includes("'none'")) {
      return { blocked: true, policyDetail: "CSP frame-ancestors 'none'" };
    }
    if (directive === "'self'") {
      return { blocked: true, policyDetail: "CSP frame-ancestors 'self'" };
    }
    if (!directive.includes('*')) {
      const originHost = (() => {
        try {
          return embedderOrigin ? new URL(embedderOrigin).hostname.toLowerCase() : '';
        } catch {
          return '';
        }
      })();
      if (!originHost || !directive.includes(originHost)) {
        return { blocked: true, policyDetail: `CSP frame-ancestors ${directive}` };
      }
    }
  }

  return { blocked: false, policyDetail: '' };
}

export function detectSandboxedEmbedSignals(snippet: string): boolean {
  if (!snippet) return false;
  return /sandboxed\s+embed(?:\s+is\s+not\s+allowed)?|please\s+disable\s+sandbox|embedding\s+in\s+sandbox\s+is\s+not\s+allowed|no[-_\s]?sandbox/i.test(
    snippet
  );
}

export function extractDirectMediaCandidate(snippet: string): string | null {
  if (!snippet) return null;
  const normalized = snippet.replace(/\\\//g, '/');
  const matched =
    normalized.match(/<(?:video|source)[^>]+src=["'](https?:\/\/[^"']+\.(?:mp4|m3u8|webm)(?:\?[^"']*)?)["']/i)?.[1] ||
    normalized.match(/(?:file|src|video_url|mp4_url|hls_url)\s*:\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8|webm)(?:\?[^"']*)?)["']/i)?.[1] ||
    normalized.match(/["'](https?:\/\/[^"'\s<>]+\.(?:mp4|m3u8)(?:\?[^"'\s<>]*)?)["']/i)?.[1] ||
    null;
  return matched || null;
}

export interface HttpProbeEvaluationInput {
  rawUrl: string;
  finalUrl?: string;
  httpStatus: number;
  contentType?: string;
  xFrameOptions?: string;
  csp?: string;
  cfMitigated?: string;
  snippet?: string;
  latencyMs: number;
  checkedAt?: string;
  method?: CheckMethodKind;
  embedderOrigin?: string;
  serverName?: string;
}

export function evaluateHttpProbeResult(input: HttpProbeEvaluationInput): ServerHealthReport {
  const checkedAt = input.checkedAt || new Date().toISOString();
  const latencyMs = Math.max(0, Math.round(input.latencyMs || 0));
  const method: CheckMethodKind = input.method || 'backend';
  const rawUrl = String(input.rawUrl || '').trim();
  const finalUrl = String(input.finalUrl || rawUrl).trim();
  const httpStatus = Number(input.httpStatus || 0);
  const contentType = String(input.contentType || '').toLowerCase();
  const snippet = String(input.snippet || '');
  const cfMitigated = String(input.cfMitigated || '').toLowerCase();

  const buildReport = (
    patch: Omit<
      ServerHealthReport,
      'url' | 'finalUrl' | 'serverName' | 'legacyStatus' | 'statusLabel' | 'statusEmoji' | 'httpStatus' | 'checkedAt' | 'latencyMs' | 'checkMethod'
    > & { httpStatusOverride?: number }
  ): ServerHealthReport => {
    const meta = SERVER_HEALTH_META[patch.status];
    const resolvedHttpStatus = patch.httpStatusOverride ?? httpStatus;
    return {
      url: rawUrl,
      finalUrl,
      ...(input.serverName ? { serverName: input.serverName } : {}),
      status: patch.status,
      legacyStatus: meta.legacyStatus,
      statusLabel: meta.label,
      statusEmoji: meta.emoji,
      httpStatus: resolvedHttpStatus,
      connectivity: patch.connectivity,
      pageLoad: patch.pageLoad,
      playerCheck: patch.playerCheck,
      reasonCode: patch.reasonCode,
      reasonText: patch.reasonText,
      checkedAt,
      latencyMs,
      checkMethod: method,
      canEmbedInIframe: patch.canEmbedInIframe,
      recommendedModes: patch.recommendedModes,
    };
  };

  // 1. Validate URL
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return buildReport({
        status: 'broken',
        httpStatusOverride: 0,
        connectivity: {
          status: 'invalid_url',
          label: 'رابط غير صالح',
          detail: 'البروتوكول غير مدعوم',
          httpStatus: 0,
        },
        pageLoad: {
          status: 'failed',
          label: 'لم يتم التحميل',
          detail: 'رابط غير مدعوم',
          frameBlocked: false,
          sandboxRejected: false,
        },
        playerCheck: {
          status: 'not_checked',
          label: 'لم يتم الفحص',
          detail: 'رابط غير صالح',
          directStreamUrl: null,
          playbackConfirmed: false,
        },
        reasonCode: 'INVALID_URL',
        reasonText: 'Invalid URL: بروتوكول الرابط غير مدعوم',
        canEmbedInIframe: false,
        recommendedModes: [],
      });
    }
  } catch {
    return buildReport({
      status: 'broken',
      httpStatusOverride: 0,
      connectivity: {
        status: 'invalid_url',
        label: 'رابط غير صالح',
        detail: 'صيغة الرابط غير صحيحة',
        httpStatus: 0,
      },
      pageLoad: {
        status: 'failed',
        label: 'لم يتم التحميل',
        detail: 'صيغة الرابط غير صالحة',
        frameBlocked: false,
        sandboxRejected: false,
      },
      playerCheck: {
        status: 'not_checked',
        label: 'لم يتم الفحص',
        detail: 'صيغة الرابط غير صالحة',
        directStreamUrl: null,
        playbackConfirmed: false,
      },
      reasonCode: 'INVALID_URL',
      reasonText: 'Invalid URL: صيغة الرابط غير صحيحة',
      canEmbedInIframe: false,
      recommendedModes: [],
    });
  }

  // 2. Explicit HTTP 404 / 410
  if (httpStatus === 404 || httpStatus === 410) {
    return buildReport({
      status: 'broken',
      connectivity: {
        status: 'http_error',
        label: `HTTP ${httpStatus}`,
        detail: 'السيرفر أعاد الصفحة غير موجودة',
        httpStatus,
      },
      pageLoad: {
        status: 'http_failed',
        label: 'صفحة خطأ 404',
        detail: 'لم يتم العثور على محتوى التشغيل',
        frameBlocked: false,
        sandboxRejected: false,
      },
      playerCheck: {
        status: 'player_error',
        label: 'غير متوفر',
        detail: 'الرابط مكسور (404)',
        directStreamUrl: null,
        playbackConfirmed: false,
      },
      reasonCode: 'HTTP_404',
      reasonText: `HTTP ${httpStatus}: الصفحة غير موجودة`,
      canEmbedInIframe: false,
      recommendedModes: [],
    });
  }

  // 3. Explicit HTTP 403 / 401 or Cloudflare challenge
  const is403Title =
    snippet &&
    /<title>\s*(?:403\s+Forbidden|Access\s+Denied|Just\s+a\s+moment|Attention\s+Required)/i.test(snippet);
  if (httpStatus === 403 || httpStatus === 401 || cfMitigated === 'challenge' || is403Title) {
    const resolvedCode = httpStatus === 401 ? 401 : 403;
    return buildReport({
      status: 'broken',
      httpStatusOverride: resolvedCode,
      connectivity: {
        status: 'http_error',
        label: `HTTP ${resolvedCode}`,
        detail: cfMitigated === 'challenge' ? 'جدار حماية Cloudflare حظر الفحص' : 'الخادم رفض الوصول إلى الرابط',
        httpStatus: resolvedCode,
      },
      pageLoad: {
        status: 'http_failed',
        label: 'تم رفض الوصول',
        detail: 'الصفحة تعيد خطأ صلاحية / حماية (403)',
        frameBlocked: false,
        sandboxRejected: false,
      },
      playerCheck: {
        status: 'player_error',
        label: 'تعذر الوصول للمشغل',
        detail: 'حجب الوصول منع تهيئة المشغل',
        directStreamUrl: null,
        playbackConfirmed: false,
      },
      reasonCode: 'HTTP_403',
      reasonText: `HTTP ${resolvedCode}: الوصول مرفوض`,
      canEmbedInIframe: false,
      recommendedModes: [],
    });
  }

  // 4. Server 5xx errors
  if (httpStatus >= 500) {
    return buildReport({
      status: 'broken',
      connectivity: {
        status: 'http_error',
        label: `HTTP ${httpStatus}`,
        detail: 'خطأ داخلي في الخادم المستضيف',
        httpStatus,
      },
      pageLoad: {
        status: 'http_failed',
        label: 'فشل الخادم المستضيف',
        detail: `الخادم أعاد رمز الحالة ${httpStatus}`,
        frameBlocked: false,
        sandboxRejected: false,
      },
      playerCheck: {
        status: 'player_error',
        label: 'غير متاح',
        detail: 'السيرفر يعاني من عطل مؤقت',
        directStreamUrl: null,
        playbackConfirmed: false,
      },
      reasonCode: 'HTTP_5XX',
      reasonText: `HTTP ${httpStatus}: خطأ من الخادم المستضيف`,
      canEmbedInIframe: false,
      recommendedModes: [],
    });
  }

  // 5. Other failed HTTP codes
  if (httpStatus > 0 && (httpStatus < 200 || (httpStatus >= 300 && httpStatus !== 304))) {
    return buildReport({
      status: 'broken',
      connectivity: {
        status: 'http_error',
        label: `HTTP ${httpStatus}`,
        detail: `استجابة HTTP غير صالحة (${httpStatus})`,
        httpStatus,
      },
      pageLoad: {
        status: 'http_failed',
        label: 'فشل تحميل الصفحة',
        detail: `رمز الحالة ${httpStatus}`,
        frameBlocked: false,
        sandboxRejected: false,
      },
      playerCheck: {
        status: 'player_error',
        label: 'لم يتهيأ المشغل',
        detail: `HTTP ${httpStatus}`,
        directStreamUrl: null,
        playbackConfirmed: false,
      },
      reasonCode: 'HTTP_ERROR',
      reasonText: `HTTP ${httpStatus}: تعذر تحميل الصفحة بنجاح`,
      canEmbedInIframe: false,
      recommendedModes: [],
    });
  }

  // 6. Direct media response (Content-Type video/* or HLS playlist or direct stream URL)
  const isDirectVideoMime =
    contentType.includes('video/') ||
    contentType.includes('application/vnd.apple.mpegurl') ||
    contentType.includes('application/x-mpegurl');
  const isDirectUrl = isDirectMediaExtensionUrl(finalUrl) || isDirectMediaExtensionUrl(rawUrl);

  if (isDirectVideoMime || (isDirectUrl && !contentType.includes('text/html'))) {
    const streamUrl = finalUrl || rawUrl;
    return buildReport({
      status: 'page_available',
      httpStatusOverride: httpStatus || 200,
      connectivity: {
        status: 'reachable',
        label: `متصل (${httpStatus || 200})`,
        detail: 'استجابة البث المباشر ناجحة',
        httpStatus: httpStatus || 200,
      },
      pageLoad: {
        status: 'loaded',
        label: 'رابط بث مباشر',
        detail: contentType ? `نوع المحتوى: ${contentType.split(';')[0]}` : 'ملف فيديو مباشر',
        frameBlocked: false,
        sandboxRejected: false,
      },
      playerCheck: {
        status: 'direct_stream_ready',
        label: 'رابط مباشر قابل للتشغيل',
        detail: 'تم التحقق من استجابة ملف البث — يلزم فحص فك التشفير في المشغل لتأكيد التشغيل.',
        directStreamUrl: streamUrl,
        playbackConfirmed: false,
      },
      reasonCode: 'DIRECT_STREAM_READY',
      reasonText: 'Playback Unverified: البث المباشر مستجيب، بانتظار تأكيد التشغيل الفعلي في المشغل',
      canEmbedInIframe: true,
      recommendedModes: ['direct_media'],
    });
  }

  // 7. Non-video website URL or homepage chrome
  if (detectNonVideoWebsiteUrl(finalUrl) || isWebsitePortalHtmlCore(finalUrl, snippet)) {
    return buildReport({
      status: 'broken',
      httpStatusOverride: httpStatus || 200,
      connectivity: {
        status: 'reachable',
        label: `متصل (${httpStatus || 200})`,
        detail: 'تم الوصول للموقع لكنه لا يشير لمشغل فيديو',
        httpStatus: httpStatus || 200,
      },
      pageLoad: {
        status: 'not_video_page',
        label: 'صفحة موقع وليست مشغل',
        detail: 'الرابط يفتح صفحة رئيسية أو صفحة أقسام وليس صفحة فيديو',
        frameBlocked: false,
        sandboxRejected: false,
      },
      playerCheck: {
        status: 'no_player_found',
        label: 'لا يوجد مشغل فيديو',
        detail: 'لم يتم العثور على عنصر فيديو أو مشغل مدمج',
        directStreamUrl: null,
        playbackConfirmed: false,
      },
      reasonCode: 'NOT_VIDEO_PAGE',
      reasonText: 'Not Video Page: الصفحة لا تحتوي على مشغل فيديو صالح',
      canEmbedInIframe: false,
      recommendedModes: [],
    });
  }

  // 8. Soft-404 inside 200 HTML
  const isSoft404 =
    snippet &&
    (/<title>\s*404\s*Not\s*Found\s*<\/title>/i.test(snippet) ||
      /file\s*(?:was|has been)?\s*(?:deleted|removed)|video\s*(?:was|has been|is)?\s*(?:deleted|removed|not found|unavailable|blocked)|file\s*(?:not\s*found|does\s*not\s*exist)|404\s*not\s*found|no\s*longer\s*available|no\s*video\s*found|this\s*video\s*does\s*not\s*exist|embed\s*(?:is\s*)?(?:disabled|unavailable)|account\s*(?:has been\s*)?suspended|تم\s*حذف\s*(?:الملف|الفيديو)|الفيديو\s*غير\s*موجود|الملف\s*غير\s*موجود|الصفحة\s*غير\s*موجودة/i.test(
        snippet
      ));

  if (isSoft404) {
    return buildReport({
      status: 'broken',
      httpStatusOverride: 404,
      connectivity: {
        status: 'reachable',
        label: `استجاب (${httpStatus || 200}) ثم أظهر 404`,
        detail: 'الصفحة تحملت لكن محتواها يشير إلى حذف الفيديو',
        httpStatus: 404,
      },
      pageLoad: {
        status: 'http_failed',
        label: 'صفحة حذف / 404 ناعمة',
        detail: 'محتوى الصفحة يعلن أن الفيديو محذوف أو غير موجود',
        frameBlocked: false,
        sandboxRejected: false,
      },
      playerCheck: {
        status: 'player_error',
        label: 'الفيديو محذوف',
        detail: 'لا يمكن تشغيل فيديو محذوف أو معطل',
        directStreamUrl: null,
        playbackConfirmed: false,
      },
      reasonCode: 'HTTP_404',
      reasonText: 'HTTP 404: الفيديو محذوف أو الصفحة غير موجودة',
      canEmbedInIframe: false,
      recommendedModes: [],
    });
  }

  // 9. Extract potential direct stream URL & detect sandbox / iframe blocking
  const extractedDirectUrl = extractDirectMediaCandidate(snippet);
  const frameBlock = detectFrameBlockHeaders(
    input.xFrameOptions || '',
    input.csp || '',
    input.embedderOrigin
  );
  const sandboxRejected = detectSandboxedEmbedSignals(snippet);
  const hasPlayerMarkup = hasRealVideoPlayerMarkupCore(snippet);

  if (frameBlock.blocked) {
    return buildReport({
      status: 'iframe_blocked',
      httpStatusOverride: httpStatus || 200,
      connectivity: {
        status: 'reachable',
        label: `متصل (${httpStatus || 200})`,
        detail: 'الخادم استجاب بنجاح ولكن فرض قيود منع التضمين',
        httpStatus: httpStatus || 200,
      },
      pageLoad: {
        status: 'iframe_blocked',
        label: 'محظور داخل iframe',
        detail: frameBlock.policyDetail,
        frameBlocked: true,
        sandboxRejected: false,
      },
      playerCheck: {
        status: extractedDirectUrl ? 'direct_stream_ready' : 'unverified_cross_origin',
        label: extractedDirectUrl ? 'يحتوي رابط بث مستخرج' : 'مقيد بسياسة التضمين',
        detail: extractedDirectUrl
          ? 'الإطار محظور لكن أمكن استخراج رابط فيديو مباشر كبديل'
          : `يمنع المصدر العرض داخل إطار (${frameBlock.policyDetail})`,
        directStreamUrl: extractedDirectUrl,
        playbackConfirmed: false,
      },
      reasonCode: 'IFRAME_BLOCKED',
      reasonText: `Iframe Blocked: الموقع يمنع التضمين (${frameBlock.policyDetail})`,
      canEmbedInIframe: false,
      recommendedModes: extractedDirectUrl ? ['direct_media'] : [],
    });
  }

  // 10. Detect explicit broken player message or completely empty HTML body
  const trimmedSnippet = snippet.trim();
  const isExplicitPlayerFailure =
    trimmedSnippet.length > 0 &&
    (/video\s*playback\s*error|unable\s*to\s*play|media\s*could\s*not\s*be\s*loaded|broken\s*video|player\s*error|حدث\s*خطأ\s*في\s*مشغل\s*الفيديو|تعذر\s*تشغيل\s*الفيديو/i.test(
      trimmedSnippet
    ) &&
      !extractedDirectUrl);

  const isEmptyOrBrokenShell =
    trimmedSnippet.length > 0 &&
    trimmedSnippet.length < 60 &&
    !hasPlayerMarkup &&
    !/<script|<iframe|<video|<object|<embed/i.test(trimmedSnippet);

  if (isExplicitPlayerFailure || isEmptyOrBrokenShell) {
    return buildReport({
      status: 'broken',
      httpStatusOverride: httpStatus || 200,
      connectivity: {
        status: 'reachable',
        label: `متصل (${httpStatus || 200})`,
        detail: 'الخادم استجاب لكن محتوى الصفحة مكسور',
        httpStatus: httpStatus || 200,
      },
      pageLoad: {
        status: 'loaded',
        label: 'صفحة بدون فيديو عامل',
        detail: isEmptyOrBrokenShell ? 'الصفحة فارغة أو غير مكتملة' : 'الصفحة تعرض رسالة خطأ في المشغل',
        frameBlocked: false,
        sandboxRejected: false,
      },
      playerCheck: {
        status: 'player_error',
        label: 'خطأ في المشغل',
        detail: 'المشغل لم يتمكن من التهيئة أو لا يوجد بث صالح',
        directStreamUrl: null,
        playbackConfirmed: false,
      },
      reasonCode: 'PLAYER_ERROR',
      reasonText: 'Player Error: حدث خطأ في مشغل الفيديو أو الصفحة فارغة',
      canEmbedInIframe: true,
      recommendedModes: [],
    });
  }

  // 11. Sandbox rejection hint detected in HTML
  if (sandboxRejected) {
    return buildReport({
      status: 'page_available',
      httpStatusOverride: httpStatus || 200,
      connectivity: {
        status: 'reachable',
        label: `متصل (${httpStatus || 200})`,
        detail: 'الصفحة استجابت بنجاح',
        httpStatus: httpStatus || 200,
      },
      pageLoad: {
        status: 'sandbox_rejected',
        label: 'يرفض Sandbox الصارم',
        detail: 'الصفحة ترفض sandbox وتحتاج وضع التوافق المباشر',
        frameBlocked: false,
        sandboxRejected: true,
      },
      playerCheck: {
        status: extractedDirectUrl
          ? 'direct_stream_ready'
          : hasPlayerMarkup
            ? 'player_detected'
            : 'unverified_cross_origin',
        label: extractedDirectUrl
          ? 'تم العثور على رابط مباشر'
          : 'مشغل يتطلب وضع التوافق المباشر',
        detail: 'لن يعمل داخل strict_sandbox — يجب استخدام وضع التوافق المباشر أو البث المباشر',
        directStreamUrl: extractedDirectUrl,
        playbackConfirmed: false,
      },
      reasonCode: 'SANDBOX_REJECTED',
      reasonText: 'Sandbox Rejected: السيرفر يرفض sandbox — يُنصح بوضع التوافق المباشر',
      canEmbedInIframe: true,
      recommendedModes: extractedDirectUrl
        ? ['direct_media', 'direct_unrestricted', 'redirect_guard']
        : ['direct_unrestricted', 'redirect_guard'],
    });
  }

  // 12. Valid 200 HTML with clear player/video markup (never claim confirmed_playing without actual playback!)
  if (hasPlayerMarkup || extractedDirectUrl) {
    return buildReport({
      status: 'page_available',
      httpStatusOverride: httpStatus || 200,
      connectivity: {
        status: 'reachable',
        label: `متصل (${httpStatus || 200})`,
        detail: 'استجابة HTTP سليمة',
        httpStatus: httpStatus || 200,
      },
      pageLoad: {
        status: 'loaded',
        label: 'تم تحميل الصفحة',
        detail: 'الصفحة تحتوي على بنية مشغل أو مصدر فيديو',
        frameBlocked: false,
        sandboxRejected: false,
      },
      playerCheck: {
        status: extractedDirectUrl ? 'direct_stream_ready' : 'player_detected',
        label: extractedDirectUrl ? 'مصدر فيديو مكتشف (غير مؤكد بعد)' : 'تم رصد مشغل مدمج',
        detail: 'الصفحة متاحة لكن يلزم بدء التشغيل داخل المتصفح لتأكيد عمل الفيديو فعلياً',
        directStreamUrl: extractedDirectUrl,
        playbackConfirmed: false,
      },
      reasonCode: 'PAGE_LOADED_UNVERIFIED',
      reasonText: 'Playback Unverified: الصفحة متاحة ومشغلها موجود لكن لم يتأكد التشغيل الفعلي بعد',
      canEmbedInIframe: true,
      recommendedModes: extractedDirectUrl
        ? ['direct_media', 'strict_sandbox', 'redirect_guard', 'direct_unrestricted']
        : ['strict_sandbox', 'redirect_guard', 'direct_unrestricted'],
    });
  }

  // 13. HTTP 200 HTML without clear video signature (e.g. dynamic JS loader / opaque wrapper)
  return buildReport({
    status: 'needs_manual_check',
    httpStatusOverride: httpStatus || 200,
    connectivity: {
      status: 'reachable',
      label: `متصل (${httpStatus || 200})`,
      detail: 'الصفحة استجابت لكن محتواها ديناميكي أو مشفر',
      httpStatus: httpStatus || 200,
    },
    pageLoad: {
      status: 'loaded',
      label: 'تحمّلت صفحة عامة / ديناميكية',
      detail: 'لم يظهر وسم فيديو صريح في المصدر الثابت',
      frameBlocked: false,
      sandboxRejected: false,
    },
    playerCheck: {
      status: 'unverified_cross_origin',
      label: 'غير مؤكد آلياً',
      detail: 'قد يعتمد المشغل على JavaScript ديناميكي — يحتاج التحقق داخل المشغل',
      directStreamUrl: null,
      playbackConfirmed: false,
    },
    reasonCode: 'PLAYBACK_UNVERIFIED',
    reasonText: 'Playback Unverified: تعذر التأكد من وجود مشغل فعال في المصدر الثابت',
    canEmbedInIframe: true,
    recommendedModes: ['strict_sandbox', 'redirect_guard', 'direct_unrestricted'],
  });
}

export function createCorsRestrictedReport(params: {
  url: string;
  latencyMs: number;
  checkedAt?: string;
  iframeLoaded?: boolean;
  serverName?: string;
}): ServerHealthReport {
  const checkedAt = params.checkedAt || new Date().toISOString();
  const status: ServerHealthStatus = 'needs_manual_check';
  const meta = SERVER_HEALTH_META[status];
  return {
    url: params.url,
    finalUrl: params.url,
    ...(params.serverName ? { serverName: params.serverName } : {}),
    status,
    legacyStatus: meta.legacyStatus,
    statusLabel: meta.label,
    statusEmoji: meta.emoji,
    httpStatus: 0,
    connectivity: {
      status: 'cors_restricted',
      label: 'مقيد بـ CORS',
      detail: 'المتصفح يمنع قراءة الترويسات مباشرة من هذا النطاق (لا يعني بالضرورة تعطل السيرفر)',
      httpStatus: 0,
    },
    pageLoad: {
      status: params.iframeLoaded ? 'loaded' : 'not_checked',
      label: params.iframeLoaded ? 'تحمّل داخل iframe (Cross-Origin)' : 'غير مفحوص لقيود CORS',
      detail: params.iframeLoaded
        ? 'تم تحميل الإطار بنجاح لكن لا يمكن قراءة محتواه برمجياً لقيود Cross-Origin'
        : 'تعذر قراءة استجابة HTTP من المتصفح بسبب سياسة CORS',
      frameBlocked: false,
      sandboxRejected: false,
    },
    playerCheck: {
      status: 'unverified_cross_origin',
      label: 'غير مؤكد (Cross-Origin)',
      detail: 'لا يمكن التأكد برمجياً من تشغيل الفيديو داخل إطار خارجي محمي بـ Cross-Origin',
      directStreamUrl: null,
      playbackConfirmed: false,
    },
    reasonCode: params.iframeLoaded ? 'PLAYBACK_UNVERIFIED' : 'CORS_RESTRICTED',
    reasonText: params.iframeLoaded
      ? 'Playback Unverified: الإطار تحمّل لكن تعذر تأكيد التشغيل لقيود Cross-Origin'
      : 'CORS Restricted: المتصفح يمنع فحص الرابط مباشرة، يحتاج فحصاً يدوياً أو عبر الخادم',
    checkedAt,
    latencyMs: Math.max(0, Math.round(params.latencyMs)),
    checkMethod: params.iframeLoaded ? 'browser_iframe' : 'browser_cors',
    canEmbedInIframe: true,
    recommendedModes: ['strict_sandbox', 'redirect_guard', 'direct_unrestricted'],
  };
}

export function createTimeoutReport(params: {
  url: string;
  latencyMs: number;
  checkedAt?: string;
  serverName?: string;
  stage?: 'connectivity' | 'iframe' | 'player';
}): ServerHealthReport {
  const checkedAt = params.checkedAt || new Date().toISOString();
  const status: ServerHealthStatus = 'broken';
  const meta = SERVER_HEALTH_META[status];
  return {
    url: params.url,
    finalUrl: params.url,
    ...(params.serverName ? { serverName: params.serverName } : {}),
    status,
    legacyStatus: meta.legacyStatus,
    statusLabel: meta.label,
    statusEmoji: meta.emoji,
    httpStatus: 0,
    connectivity: {
      status: 'timeout',
      label: 'انتهت المهلة',
      detail: 'لم يستجب السيرفر خلال المهلة الزمنية المحددة',
      httpStatus: 0,
    },
    pageLoad: {
      status: params.stage === 'iframe' ? 'failed' : 'not_checked',
      label: params.stage === 'iframe' ? 'انتهت مهلة تحميل الإطار' : 'فشل قبل اكتمال التحميل',
      detail: 'تجاوز التحميل الحد الزمني المسموح',
      frameBlocked: false,
      sandboxRejected: false,
    },
    playerCheck: {
      status: 'player_error',
      label: 'تعذر التهيئة',
      detail: 'انتهت المهلة قبل بدء المشغل',
      directStreamUrl: null,
      playbackConfirmed: false,
    },
    reasonCode: 'TIMEOUT',
    reasonText: 'Timeout: انتهت مهلة الاتصال بالسيرفر',
    checkedAt,
    latencyMs: Math.max(0, Math.round(params.latencyMs)),
    checkMethod: params.stage === 'iframe' ? 'browser_iframe' : params.stage === 'player' ? 'browser_video' : 'backend',
    canEmbedInIframe: false,
    recommendedModes: [],
  };
}

export function createNetworkErrorReport(params: {
  url: string;
  latencyMs: number;
  checkedAt?: string;
  serverName?: string;
  detail?: string;
}): ServerHealthReport {
  const checkedAt = params.checkedAt || new Date().toISOString();
  const status: ServerHealthStatus = 'broken';
  const meta = SERVER_HEALTH_META[status];
  return {
    url: params.url,
    finalUrl: params.url,
    ...(params.serverName ? { serverName: params.serverName } : {}),
    status,
    legacyStatus: meta.legacyStatus,
    statusLabel: meta.label,
    statusEmoji: meta.emoji,
    httpStatus: 0,
    connectivity: {
      status: 'network_error',
      label: 'فشل الاتصال',
      detail: params.detail || 'تعذر الوصول إلى النطاق أو تم قطع الاتصال',
      httpStatus: 0,
    },
    pageLoad: {
      status: 'failed',
      label: 'فشل التحميل',
      detail: 'تعذر الوصول لصفحة السيرفر',
      frameBlocked: false,
      sandboxRejected: false,
    },
    playerCheck: {
      status: 'not_checked',
      label: 'لم يعمل',
      detail: 'تعذر الاتصال بمصدر الفيديو',
      directStreamUrl: null,
      playbackConfirmed: false,
    },
    reasonCode: 'NETWORK_ERROR',
    reasonText: `Network Error: ${params.detail || 'تعذر الاتصال بالسيرفر'}`,
    checkedAt,
    latencyMs: Math.max(0, Math.round(params.latencyMs)),
    checkMethod: 'backend',
    canEmbedInIframe: false,
    recommendedModes: [],
  };
}

export function createUnknownErrorReport(params: {
  url: string;
  latencyMs: number;
  checkedAt?: string;
  serverName?: string;
  detail?: string;
}): ServerHealthReport {
  const checkedAt = params.checkedAt || new Date().toISOString();
  const status: ServerHealthStatus = 'unknown_error';
  const meta = SERVER_HEALTH_META[status];
  return {
    url: params.url,
    finalUrl: params.url,
    ...(params.serverName ? { serverName: params.serverName } : {}),
    status,
    legacyStatus: meta.legacyStatus,
    statusLabel: meta.label,
    statusEmoji: meta.emoji,
    httpStatus: 0,
    connectivity: {
      status: 'not_checked',
      label: 'غير محدد',
      detail: params.detail || 'لم تتوفر معطيات كافية حول حالة السيرفر',
      httpStatus: 0,
    },
    pageLoad: {
      status: 'not_checked',
      label: 'غير محدد',
      detail: 'لم تكتمل بيانات فحص الصفحة',
      frameBlocked: false,
      sandboxRejected: false,
    },
    playerCheck: {
      status: 'not_checked',
      label: 'غير محدد',
      detail: 'تعذر تحديد حالة المشغل',
      directStreamUrl: null,
      playbackConfirmed: false,
    },
    reasonCode: 'UNKNOWN',
    reasonText: params.detail || 'Unknown Error: لم تتوفر معلومات كافية لتحديد السبب',
    checkedAt,
    latencyMs: Math.max(0, Math.round(params.latencyMs)),
    checkMethod: 'static',
    canEmbedInIframe: true,
    recommendedModes: ['strict_sandbox', 'redirect_guard', 'direct_unrestricted'],
  };
}
