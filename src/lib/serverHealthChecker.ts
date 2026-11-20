import {
  getCustomApiBaseUrl,
  isProxyWorkerUrl,
  resolveApiEndpoint,
  shouldSkipBackendApiCalls,
} from './clientScraper';
import {
  createCorsRestrictedReport,
  createNetworkErrorReport,
  createTimeoutReport,
  createUnknownErrorReport,
  detectNonVideoWebsiteUrl,
  evaluateHttpProbeResult,
  isDashManifestUrl,
  isDirectMediaExtensionUrl,
  SERVER_HEALTH_META,
  type ServerHealthReport,
} from './serverHealthCore';

export * from './serverHealthCore';

export interface MultiStageCheckOptions {
  serverName?: string;
  timeoutMs?: number;
  verifyVideoPlayback?: boolean;
  verifyIframeLoad?: boolean;
  signal?: AbortSignal;
}

const DEFAULT_STAGE_TIMEOUT_MS = 6500;

async function fetchWithAbortAndLatency(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<{ response: Response; latencyMs: number }> {
  const startedAt = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onExternalAbort = () => ctrl.abort();
  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    const response = await fetch(url, { ...init, signal: ctrl.signal });
    return { response, latencyMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

async function probeConnectivityAndHttpStage(
  rawUrl: string,
  opts: MultiStageCheckOptions
): Promise<ServerHealthReport> {
  const cleanUrl = String(rawUrl || '').trim();
  const timeoutMs = opts.timeoutMs || DEFAULT_STAGE_TIMEOUT_MS;
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();

  let parsed: URL;
  try {
    parsed = new URL(cleanUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return evaluateHttpProbeResult({
        rawUrl: cleanUrl,
        httpStatus: 0,
        latencyMs: 0,
        checkedAt,
        serverName: opts.serverName,
      });
    }
  } catch {
    return evaluateHttpProbeResult({
      rawUrl: cleanUrl,
      httpStatus: 0,
      latencyMs: 0,
      checkedAt,
      serverName: opts.serverName,
    });
  }

  if (detectNonVideoWebsiteUrl(cleanUrl)) {
    return evaluateHttpProbeResult({
      rawUrl: cleanUrl,
      finalUrl: cleanUrl,
      httpStatus: 200,
      contentType: 'text/html',
      latencyMs: Date.now() - startedAt,
      checkedAt,
      method: 'static',
      serverName: opts.serverName,
    });
  }

  // 1. Backend API /api/check-servers when Express backend is active
  if (!shouldSkipBackendApiCalls()) {
    try {
      const { response, latencyMs } = await fetchWithAbortAndLatency(
        resolveApiEndpoint('/api/check-servers'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: [cleanUrl] }),
        },
        timeoutMs + 1500,
        opts.signal
      );
      const ct = response.headers.get('content-type') || '';
      if (response.ok && ct.includes('application/json')) {
        const data = (await response.json()) as {
          ok?: boolean;
          results?: Record<string, ServerHealthReport>;
        };
        const backendReport = data.results?.[cleanUrl];
        if (data.ok && backendReport) {
          return {
            ...backendReport,
            serverName: opts.serverName || backendReport.serverName,
            latencyMs: backendReport.latencyMs || latencyMs,
          };
        }
      }
    } catch {
      // Fall through to Cloudflare Worker / Browser CORS probing
    }
  }

  // 2. Cloudflare Worker proxy when configured
  const customBase = getCustomApiBaseUrl();
  if (customBase && isProxyWorkerUrl(customBase)) {
    try {
      const isDirect = isDirectMediaExtensionUrl(cleanUrl);
      const workerUrl = `${customBase}/?url=${encodeURIComponent(cleanUrl)}`;
      const { response, latencyMs } = await fetchWithAbortAndLatency(
        workerUrl,
        { method: isDirect ? 'HEAD' : 'GET' },
        timeoutMs,
        opts.signal
      );
      const finalUrl = response.headers.get('X-Final-Url') || cleanUrl;
      const upstreamStatus = Number(response.headers.get('X-Upstream-Status') || response.status);
      const xFrame = response.headers.get('X-Upstream-X-Frame-Options') || '';
      const csp = response.headers.get('X-Upstream-CSP') || '';
      const cfMitigated = response.headers.get('X-Upstream-CF-Mitigated') || '';
      const ct = response.headers.get('Content-Type') || '';
      const bodyText = isDirect ? '' : (await response.text().catch(() => '')).slice(0, 32000);
      const isWorkerFailure =
        (response.status === 502 || response.status === 400) && bodyText.includes('"ok":false');
      if (!isWorkerFailure) {
        return evaluateHttpProbeResult({
          rawUrl: cleanUrl,
          finalUrl,
          httpStatus: upstreamStatus,
          contentType: ct,
          xFrameOptions: xFrame,
          csp,
          cfMitigated,
          snippet: bodyText,
          latencyMs,
          checkedAt,
          method: 'worker',
          embedderOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
          serverName: opts.serverName,
        });
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError' && !opts.signal?.aborted) {
        return createTimeoutReport({
          url: cleanUrl,
          latencyMs: Date.now() - startedAt,
          checkedAt,
          serverName: opts.serverName,
          stage: 'connectivity',
        });
      }
    }
  }

  // 3. Direct CORS-enabled browser fetch (same-origin or CORS-permissive endpoints)
  if (typeof fetch === 'function') {
    const isDirect = isDirectMediaExtensionUrl(cleanUrl);
    try {
      const { response, latencyMs } = await fetchWithAbortAndLatency(
        cleanUrl,
        {
          method: isDirect ? 'HEAD' : 'GET',
          mode: 'cors',
          redirect: 'follow',
        },
        Math.min(timeoutMs, 4500),
        opts.signal
      );
      const ct = (response.headers.get('content-type') || '').toLowerCase();
      const xFrame = response.headers.get('x-frame-options') || '';
      const csp = response.headers.get('content-security-policy') || '';
      const bodyText =
        !isDirect && (ct.includes('text/html') || ct.includes('text/plain') || !ct)
          ? (await response.text().catch(() => '')).slice(0, 28000)
          : '';
      return evaluateHttpProbeResult({
        rawUrl: cleanUrl,
        finalUrl: response.url || cleanUrl,
        httpStatus: response.status,
        contentType: ct,
        xFrameOptions: xFrame,
        csp,
        snippet: bodyText,
        latencyMs,
        checkedAt,
        method: 'browser_cors',
        embedderOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
        serverName: opts.serverName,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return createTimeoutReport({
          url: cleanUrl,
          latencyMs: Date.now() - startedAt,
          checkedAt,
          serverName: opts.serverName,
          stage: 'connectivity',
        });
      }
      // CORS rejection throws TypeError in browsers. DO NOT mark server broken because of CORS!
    }
  }

  // 4. Non-CORS browser reachability test (verifies TCP/TLS/DNS reachability without reading blocked body)
  if (typeof fetch === 'function') {
    const noCorsStart = Date.now();
    try {
      await fetchWithAbortAndLatency(
        cleanUrl,
        { method: 'HEAD', mode: 'no-cors', redirect: 'follow' },
        Math.min(timeoutMs, 4500),
        opts.signal
      );
      return createCorsRestrictedReport({
        url: cleanUrl,
        latencyMs: Date.now() - noCorsStart,
        checkedAt,
        iframeLoaded: false,
        serverName: opts.serverName,
      });
    } catch (err) {
      const elapsed = Date.now() - noCorsStart;
      if (err instanceof Error && err.name === 'AbortError') {
        return createTimeoutReport({
          url: cleanUrl,
          latencyMs: elapsed,
          checkedAt,
          serverName: opts.serverName,
          stage: 'connectivity',
        });
      }
      return createNetworkErrorReport({
        url: cleanUrl,
        latencyMs: elapsed,
        checkedAt,
        serverName: opts.serverName,
        detail: 'فشل الاتصال بالخادم المستضيف أو النطاق غير متاح',
      });
    }
  }

  return createUnknownErrorReport({
    url: cleanUrl,
    latencyMs: Date.now() - startedAt,
    checkedAt,
    serverName: opts.serverName,
  });
}

export async function verifyDirectVideoPlaybackInBrowser(
  streamUrl: string,
  baseReport: ServerHealthReport,
  timeoutMs = 6000,
  externalSignal?: AbortSignal
): Promise<ServerHealthReport> {
  if (typeof document === 'undefined' || isDashManifestUrl(streamUrl)) {
    return baseReport;
  }

  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const isHls = /\.m3u8(\?|$|#)/i.test(streamUrl);

  return new Promise<ServerHealthReport>((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.style.position = 'fixed';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    video.style.top = '-9999px';

    let settled = false;
    let hlsInstance: { destroy: () => void } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      externalSignal?.removeEventListener('abort', onAbort);
      if (hlsInstance) {
        try {
          hlsInstance.destroy();
        } catch {
          // Ignore HLS cleanup error
        }
        hlsInstance = null;
      }
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        // Ignore DOM cleanup error
      }
      video.remove();
    };

    const finish = (nextReport: ServerHealthReport) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(nextReport);
    };

    const onAbort = () => {
      finish(baseReport);
    };
    if (externalSignal) {
      if (externalSignal.aborted) {
        finish(baseReport);
        return;
      }
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }

    const totalLatency = () => Math.max(baseReport.latencyMs, Date.now() - startedAt);

    timer = setTimeout(() => {
      finish({
        ...baseReport,
        status: 'broken',
        legacyStatus: 'broken',
        statusLabel: SERVER_HEALTH_META.broken.label,
        statusEmoji: SERVER_HEALTH_META.broken.emoji,
        playerCheck: {
          status: 'player_error',
          label: 'انتهت مهلة تحميل الفيديو',
          detail: 'لم يصبح ملف الفيديو جاهزاً للتشغيل قبل انتهاء المهلة',
          directStreamUrl: streamUrl,
          playbackConfirmed: false,
        },
        reasonCode: 'TIMEOUT',
        reasonText: 'Timeout: انتهت مهلة تهيئة مشغل الفيديو',
        checkedAt,
        latencyMs: totalLatency(),
        checkMethod: 'browser_video',
      });
    }, timeoutMs);

    const confirmReadyAndTryPlay = async () => {
      if (settled) return;
      try {
        const playPromise = video.play();
        if (playPromise && typeof playPromise.then === 'function') {
          await playPromise;
        }
        finish({
          ...baseReport,
          status: 'confirmed_playing',
          legacyStatus: 'working',
          statusLabel: SERVER_HEALTH_META.confirmed_playing.label,
          statusEmoji: SERVER_HEALTH_META.confirmed_playing.emoji,
          connectivity:
            baseReport.connectivity.status === 'cors_restricted'
              ? {
                  status: 'reachable',
                  label: 'متصل',
                  detail: 'استجاب مصدر البث المباشر بنجاح',
                  httpStatus: 200,
                }
              : baseReport.connectivity,
          pageLoad: {
            status: 'loaded',
            label: 'بث مباشر جاهز',
            detail: 'تم تحميل بيانات الفيديو بنجاح',
            frameBlocked: false,
            sandboxRejected: false,
          },
          playerCheck: {
            status: 'playing_verified',
            label: 'تم تأكيد التشغيل',
            detail: 'تهيأ مشغل الفيديو وبدأ التشغيل الفعلي بنجاح.',
            directStreamUrl: streamUrl,
            playbackConfirmed: true,
            autoplayBlocked: false,
          },
          reasonCode: 'OK_PLAYING',
          reasonText: 'يعمل وتم تأكيد التشغيل: تم فحص البث والتأكد من جاهزيته وبدء التشغيل الفعلي',
          checkedAt,
          latencyMs: totalLatency(),
          checkMethod: 'browser_video',
        });
      } catch (err) {
        const name = (err as { name?: string } | null)?.name || '';
        if (name === 'NotAllowedError') {
          finish({
            ...baseReport,
            status: 'page_available',
            legacyStatus: 'warning',
            statusLabel: SERVER_HEALTH_META.page_available.label,
            statusEmoji: SERVER_HEALTH_META.page_available.emoji,
            playerCheck: {
              status: 'direct_stream_ready',
              label: 'جاهز — ينتظر نقرة التشغيل',
              detail: 'الملف جاهز للتشغيل لكن المتصفح منع التشغيل الآلي التلقائي بدون نقرة',
              directStreamUrl: streamUrl,
              playbackConfirmed: false,
              autoplayBlocked: true,
            },
            reasonCode: 'DIRECT_STREAM_READY',
            reasonText: 'Playback Unverified: البث جاهز للتشغيل ويحتاج تفاعل المستخدم لبدئه',
            checkedAt,
            latencyMs: totalLatency(),
            checkMethod: 'browser_video',
          });
        } else {
          finish({
            ...baseReport,
            status: 'broken',
            legacyStatus: 'broken',
            statusLabel: SERVER_HEALTH_META.broken.label,
            statusEmoji: SERVER_HEALTH_META.broken.emoji,
            playerCheck: {
              status: 'player_error',
              label: 'خطأ في تشغيل الفيديو',
              detail: err instanceof Error ? err.message : 'تعذر بدء تشغيل ملف الفيديو',
              directStreamUrl: streamUrl,
              playbackConfirmed: false,
            },
            reasonCode: 'PLAYER_ERROR',
            reasonText: 'Player Error: حدث خطأ في مشغل الفيديو أثناء التحقق',
            checkedAt,
            latencyMs: totalLatency(),
            checkMethod: 'browser_video',
          });
        }
      }
    };

    video.addEventListener('canplay', () => {
      void confirmReadyAndTryPlay();
    });

    video.addEventListener('error', () => {
      const code = video.error?.code;
      finish({
        ...baseReport,
        status: 'broken',
        legacyStatus: 'broken',
        statusLabel: SERVER_HEALTH_META.broken.label,
        statusEmoji: SERVER_HEALTH_META.broken.emoji,
        playerCheck: {
          status: 'player_error',
          label: 'فشل فك تشفير الفيديو',
          detail: code ? `MediaError code ${code}` : 'تعذر تحميل أو فك تشفير مصدر الفيديو',
          directStreamUrl: streamUrl,
          playbackConfirmed: false,
        },
        reasonCode: 'PLAYER_ERROR',
        reasonText: 'Player Error: حدث خطأ في مشغل الفيديو أو الرابط لا يقدم بثاً صالحاً',
        checkedAt,
        latencyMs: totalLatency(),
        checkMethod: 'browser_video',
      });
    });

    document.body?.appendChild(video);

    if (
      isHls &&
      video.canPlayType('application/vnd.apple.mpegurl') === '' &&
      video.canPlayType('application/x-mpegURL') === ''
    ) {
      void import('hls.js')
        .then(({ default: Hls }) => {
          if (settled) return;
          if (!Hls.isSupported()) {
            video.src = streamUrl;
            return;
          }
          const hls = new Hls({ enableWorker: true });
          hlsInstance = hls;
          hls.loadSource(streamUrl);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            void confirmReadyAndTryPlay();
          });
          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (!data.fatal || settled) return;
            finish({
              ...baseReport,
              status: 'broken',
              legacyStatus: 'broken',
              statusLabel: SERVER_HEALTH_META.broken.label,
              statusEmoji: SERVER_HEALTH_META.broken.emoji,
              playerCheck: {
                status: 'player_error',
                label: 'خطأ في بث HLS',
                detail: `HLS fatal error (${data.details || data.type})`,
                directStreamUrl: streamUrl,
                playbackConfirmed: false,
              },
              reasonCode: 'PLAYER_ERROR',
              reasonText: 'Player Error: تعذر تحميل أو تشغيل قائمة بث HLS (.m3u8)',
              checkedAt,
              latencyMs: totalLatency(),
              checkMethod: 'browser_video',
            });
          });
        })
        .catch(() => {
          if (!settled) video.src = streamUrl;
        });
    } else {
      video.src = streamUrl;
    }
  });
}

export async function verifyIframeLoadInBrowser(
  targetUrl: string,
  baseReport: ServerHealthReport,
  timeoutMs = 5500,
  externalSignal?: AbortSignal
): Promise<ServerHealthReport> {
  if (typeof document === 'undefined' || !baseReport.canEmbedInIframe) {
    return baseReport;
  }

  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();

  return new Promise<ServerHealthReport>((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.width = '320px';
    iframe.style.height = '180px';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    iframe.style.top = '-9999px';
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    // Restrict probe popups safely without triggering false errors where basic scripts run
    iframe.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-forms allow-presentation'
    );

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      window.removeEventListener('message', onMessage);
      externalSignal?.removeEventListener('abort', onAbort);
      try {
        iframe.src = 'about:blank';
      } catch {
        // Ignore cleanup
      }
      iframe.remove();
    };

    const finish = (nextReport: ServerHealthReport) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(nextReport);
    };

    const onAbort = () => finish(baseReport);
    if (externalSignal) {
      if (externalSignal.aborted) {
        finish(baseReport);
        return;
      }
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }

    const totalLatency = () => Math.max(baseReport.latencyMs, Date.now() - startedAt);

    const onMessage = (event: MessageEvent) => {
      if (settled) return;
      const payload = typeof event.data === 'string' ? event.data : JSON.stringify(event.data || '');
      if (/error\s*403|403\s*forbidden/i.test(payload)) {
        finish({
          ...baseReport,
          status: 'broken',
          legacyStatus: 'broken',
          statusLabel: SERVER_HEALTH_META.broken.label,
          statusEmoji: SERVER_HEALTH_META.broken.emoji,
          httpStatus: 403,
          pageLoad: {
            status: 'http_failed',
            label: 'خطأ 403 داخل الإطار',
            detail: 'أبلغ المشغل المدمج برفض الوصول (403)',
            frameBlocked: false,
            sandboxRejected: false,
          },
          playerCheck: {
            status: 'player_error',
            label: 'خطأ 403',
            detail: 'المشغل أرسل رسالة خطأ 403',
            directStreamUrl: null,
            playbackConfirmed: false,
          },
          reasonCode: 'HTTP_403',
          reasonText: 'HTTP 403: الوصول مرفوض داخل المشغل',
          checkedAt,
          latencyMs: totalLatency(),
          checkMethod: 'browser_iframe',
        });
      } else if (/sandboxed\s*embed|please\s*disable\s*sandbox/i.test(payload)) {
        finish({
          ...baseReport,
          status: 'page_available',
          legacyStatus: 'warning',
          statusLabel: SERVER_HEALTH_META.page_available.label,
          statusEmoji: SERVER_HEALTH_META.page_available.emoji,
          pageLoad: {
            status: 'sandbox_rejected',
            label: 'يرفض Sandbox الصارم',
            detail: 'السيرفر يعمل خارج Sandbox (وضع التوافق المباشر)',
            frameBlocked: false,
            sandboxRejected: true,
          },
          reasonCode: 'SANDBOX_REJECTED',
          reasonText: 'Sandbox Rejected: السيرفر يرفض sandbox ويتطلب وضع التوافق المباشر',
          checkedAt,
          latencyMs: totalLatency(),
          checkMethod: 'browser_iframe',
          recommendedModes: ['direct_unrestricted', 'redirect_guard'],
        });
      }
    };

    window.addEventListener('message', onMessage);

    timer = setTimeout(() => {
      finish(
        createTimeoutReport({
          url: targetUrl,
          latencyMs: totalLatency(),
          checkedAt,
          serverName: baseReport.serverName,
          stage: 'iframe',
        })
      );
    }, timeoutMs);

    iframe.addEventListener('load', () => {
      if (settled) return;

      // Only inspect DOM if strictly same-origin; NEVER treat Cross-Origin SecurityError as failure.
      let sameOriginInspected = false;
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          sameOriginInspected = true;
          const text = (doc.body?.innerText || '').trim();
          const videoEl = doc.querySelector('video');
          if (/\b404\b|not\s*found/i.test(text) && !videoEl) {
            finish({
              ...baseReport,
              status: 'broken',
              legacyStatus: 'broken',
              statusLabel: SERVER_HEALTH_META.broken.label,
              statusEmoji: SERVER_HEALTH_META.broken.emoji,
              httpStatus: 404,
              pageLoad: {
                status: 'http_failed',
                label: 'صفحة 404 داخل الإطار',
                detail: 'محتوى الصفحة يعرض خطأ 404 غير موجود',
                frameBlocked: false,
                sandboxRejected: false,
              },
              reasonCode: 'HTTP_404',
              reasonText: 'HTTP 404: الصفحة غير موجودة',
              checkedAt,
              latencyMs: totalLatency(),
              checkMethod: 'browser_iframe',
            });
            return;
          }
          if (videoEl) {
            if (!videoEl.paused && videoEl.readyState >= 2) {
              finish({
                ...baseReport,
                status: 'confirmed_playing',
                legacyStatus: 'working',
                statusLabel: SERVER_HEALTH_META.confirmed_playing.label,
                statusEmoji: SERVER_HEALTH_META.confirmed_playing.emoji,
                pageLoad: {
                  status: 'loaded',
                  label: 'تحمّلت صفحة المشغل',
                  detail: 'تم تحميل الصفحة بنجاح',
                  frameBlocked: false,
                  sandboxRejected: false,
                },
                playerCheck: {
                  status: 'playing_verified',
                  label: 'تم تأكيد التشغيل',
                  detail: 'يحتوي الإطار على عنصر فيديو نشط في وضع التشغيل',
                  directStreamUrl: videoEl.currentSrc || null,
                  playbackConfirmed: true,
                },
                reasonCode: 'OK_PLAYING',
                reasonText: 'يعمل وتم تأكيد التشغيل داخل المشغل',
                checkedAt,
                latencyMs: totalLatency(),
                checkMethod: 'browser_iframe',
              });
              return;
            }
            finish({
              ...baseReport,
              status: 'page_available',
              legacyStatus: 'warning',
              statusLabel: SERVER_HEALTH_META.page_available.label,
              statusEmoji: SERVER_HEALTH_META.page_available.emoji,
              pageLoad: {
                status: 'loaded',
                label: 'تحمّلت صفحة المشغل',
                detail: 'عنصر <video> موجود لكن لم يبدأ التشغيل بعد',
                frameBlocked: false,
                sandboxRejected: false,
              },
              playerCheck: {
                status: 'player_detected',
                label: 'تم رصد مشغل فيديو',
                detail: 'تم رصد عنصر فيديو داخل الصفحة بدون تأكيد بدء التشغيل بعد',
                directStreamUrl: videoEl.currentSrc || null,
                playbackConfirmed: false,
              },
              reasonCode: 'PAGE_LOADED_UNVERIFIED',
              reasonText: 'Playback Unverified: الصفحة تحتوي على مشغل فيديو لكن التشغيل لم يُؤكد بعد',
              checkedAt,
              latencyMs: totalLatency(),
              checkMethod: 'browser_iframe',
            });
            return;
          }
          if (!text && !doc.querySelector('iframe,canvas,object,embed')) {
            finish({
              ...baseReport,
              status: 'broken',
              legacyStatus: 'broken',
              statusLabel: SERVER_HEALTH_META.broken.label,
              statusEmoji: SERVER_HEALTH_META.broken.emoji,
              pageLoad: {
                status: 'loaded',
                label: 'صفحة فارغة داخل الإطار',
                detail: 'تحمّلت الصفحة لكنها فارغة تماماً بدون مشغل فيديو',
                frameBlocked: false,
                sandboxRejected: false,
              },
              playerCheck: {
                status: 'no_player_found',
                label: 'لا يوجد مشغل فيديو',
                detail: 'الصفحة خالية من أي مشغل',
                directStreamUrl: null,
                playbackConfirmed: false,
              },
              reasonCode: 'NOT_VIDEO_PAGE',
              reasonText: 'Player Error: صفحة فارغة لا تحتوي على مشغل فيديو',
              checkedAt,
              latencyMs: totalLatency(),
              checkMethod: 'browser_iframe',
            });
            return;
          }
        }
      } catch {
        // Cross-origin access denied by SOP — expected behavior, NOT a server error.
      }

      // Cross-Origin iframe loaded: NEVER treat onLoad alone as confirmed_playing!
      if (!sameOriginInspected) {
        if (baseReport.connectivity.status === 'cors_restricted') {
          finish(
            createCorsRestrictedReport({
              url: targetUrl,
              latencyMs: totalLatency(),
              checkedAt,
              iframeLoaded: true,
              serverName: baseReport.serverName,
            })
          );
          return;
        }
        finish({
          ...baseReport,
          status: baseReport.status === 'page_available' ? 'page_available' : 'needs_manual_check',
          legacyStatus: 'warning',
          statusLabel:
            baseReport.status === 'page_available'
              ? SERVER_HEALTH_META.page_available.label
              : SERVER_HEALTH_META.needs_manual_check.label,
          statusEmoji:
            baseReport.status === 'page_available'
              ? SERVER_HEALTH_META.page_available.emoji
              : SERVER_HEALTH_META.needs_manual_check.emoji,
          pageLoad: {
            status: 'loaded',
            label: 'تم تحميل الإطار (Cross-Origin)',
            detail: 'استجاب الإطار بدون أخطاء متصفح لكن تعذر قراءة محتواه لقيود Cross-Origin',
            frameBlocked: false,
            sandboxRejected: baseReport.pageLoad.sandboxRejected,
          },
          checkedAt,
          latencyMs: totalLatency(),
          checkMethod: 'browser_iframe',
        });
      }
    });

    iframe.addEventListener('error', () => {
      finish({
        ...baseReport,
        status: 'broken',
        legacyStatus: 'broken',
        statusLabel: SERVER_HEALTH_META.broken.label,
        statusEmoji: SERVER_HEALTH_META.broken.emoji,
        pageLoad: {
          status: 'failed',
          label: 'فشل تحميل الإطار',
          detail: 'أبلغ المتصفح عن خطأ أثناء تحميل iframe السيرفر',
          frameBlocked: false,
          sandboxRejected: false,
        },
        reasonCode: 'NETWORK_ERROR',
        reasonText: 'Iframe Error: تعذر تحميل صفحة السيرفر داخل الإطار',
        checkedAt,
        latencyMs: totalLatency(),
        checkMethod: 'browser_iframe',
      });
    });

    iframe.src = targetUrl;
    document.body?.appendChild(iframe);
  });
}

export async function runMultiStageServerCheck(
  rawUrl: string,
  options: MultiStageCheckOptions = {}
): Promise<ServerHealthReport> {
  const stage1 = await probeConnectivityAndHttpStage(rawUrl, options);

  // Stop immediately on hard connectivity / HTTP / policy failures unless an extracted direct stream exists
  if (
    stage1.status === 'broken' ||
    (stage1.status === 'iframe_blocked' && !stage1.playerCheck.directStreamUrl)
  ) {
    return stage1;
  }

  // Stage 2: Direct media (<video> + hls.js) verification if allowed and URL/extracted stream is direct video
  const directCandidate =
    isDirectMediaExtensionUrl(rawUrl)
      ? rawUrl
      : stage1.playerCheck.directStreamUrl || null;

  if (options.verifyVideoPlayback !== false && directCandidate) {
    return verifyDirectVideoPlaybackInBrowser(
      directCandidate,
      stage1,
      options.timeoutMs || 6000,
      options.signal
    );
  }

  // Stage 3: Safe iframe load check when specifically requested for deep inspection (e.g. single-server re-check)
  if (options.verifyIframeLoad && stage1.canEmbedInIframe) {
    return verifyIframeLoadInBrowser(
      rawUrl,
      stage1,
      options.timeoutMs || 5500,
      options.signal
    );
  }

  return stage1;
}

export interface BatchCheckTarget {
  url: string;
  serverName?: string;
}

export async function runBatchServerHealthCheck(
  targets: BatchCheckTarget[],
  options: MultiStageCheckOptions & {
    concurrency?: number;
    onProgress?: (url: string, report: ServerHealthReport, done: number, total: number) => void;
  } = {}
): Promise<Record<string, ServerHealthReport>> {
  const uniqueMap = new Map<string, BatchCheckTarget>();
  for (const t of targets) {
    const clean = String(t.url || '').trim();
    if (clean && !uniqueMap.has(clean)) {
      uniqueMap.set(clean, { url: clean, serverName: t.serverName });
    }
  }

  const items = Array.from(uniqueMap.values());
  const results: Record<string, ServerHealthReport> = {};
  if (items.length === 0) return results;

  const total = items.length;
  let completed = 0;

  // Use backend batch endpoint in chunks when backend is available and not doing deep per-iframe probing
  if (!shouldSkipBackendApiCalls() && !options.verifyIframeLoad) {
    const chunkSize = 30;
    for (let i = 0; i < items.length; i += chunkSize) {
      if (options.signal?.aborted) break;
      const chunk = items.slice(i, i + chunkSize);
      try {
        const { response } = await fetchWithAbortAndLatency(
          resolveApiEndpoint('/api/check-servers'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: chunk.map((c) => c.url) }),
          },
          (options.timeoutMs || DEFAULT_STAGE_TIMEOUT_MS) + 4000,
          options.signal
        );
        const ct = response.headers.get('content-type') || '';
        if (response.ok && ct.includes('application/json')) {
          const json = (await response.json()) as {
            ok?: boolean;
            results?: Record<string, ServerHealthReport>;
          };
          if (json.ok && json.results) {
            for (const item of chunk) {
              if (options.signal?.aborted) break;
              let report = json.results[item.url];
              if (report) {
                report = { ...report, serverName: item.serverName || report.serverName };
                // Run browser <video>/HLS verification ONLY for direct media candidates when enabled
                if (
                  options.verifyVideoPlayback !== false &&
                  report.status !== 'broken' &&
                  (isDirectMediaExtensionUrl(item.url) || report.playerCheck.directStreamUrl)
                ) {
                  const directUrl = isDirectMediaExtensionUrl(item.url)
                    ? item.url
                    : report.playerCheck.directStreamUrl!;
                  report = await verifyDirectVideoPlaybackInBrowser(
                    directUrl,
                    report,
                    options.timeoutMs || 5500,
                    options.signal
                  );
                }
                results[item.url] = report;
                completed += 1;
                options.onProgress?.(item.url, report, completed, total);
              }
            }
            continue;
          }
        }
      } catch {
        // Fallback below to per-item multi-stage probing
      }

      // Per-item fallback for this chunk if backend call failed
      const concurrency = Math.max(1, Math.min(6, options.concurrency || 4));
      for (let j = 0; j < chunk.length; j += concurrency) {
        if (options.signal?.aborted) break;
        const sub = chunk.slice(j, j + concurrency);
        await Promise.all(
          sub.map(async (item) => {
            const report = await runMultiStageServerCheck(item.url, {
              ...options,
              serverName: item.serverName,
            });
            results[item.url] = report;
            completed += 1;
            options.onProgress?.(item.url, report, completed, total);
          })
        );
      }
    }
    return results;
  }

  // Browser-direct / Worker concurrency loop
  const concurrency = Math.max(1, Math.min(6, options.concurrency || 4));
  for (let i = 0; i < items.length; i += concurrency) {
    if (options.signal?.aborted) break;
    const sub = items.slice(i, i + concurrency);
    await Promise.all(
      sub.map(async (item) => {
        const report = await runMultiStageServerCheck(item.url, {
          ...options,
          serverName: item.serverName,
        });
        results[item.url] = report;
        completed += 1;
        options.onProgress?.(item.url, report, completed, total);
      })
    );
  }

  return results;
}
