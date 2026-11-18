import { getCustomApiBaseUrl } from './clientScraper';
import { appendLocalClientErrorLog } from './adminPreferences';

export type ClientLogLevel = 'warn' | 'error' | 'fatal';

export interface ClientErrorReport {
  source: string;
  message: string;
  error?: unknown;
  level?: ClientLogLevel;
  context?: Record<string, string | number | boolean | null | undefined>;
}

const MAX_LOGS_PER_SESSION = 20;
const DEDUP_WINDOW_MS = 15_000;

let sentCountThisSession = 0;
let installed = false;
const recentSignatures = new Map<string, number>();

function resolveClientLogsEndpoint(): string | null {
  if (typeof window === 'undefined') return null;

  const customBase = getCustomApiBaseUrl();
  if (customBase) {
    return `${customBase.replace(/\/+$/, '')}/api/client-logs`;
  }

  const host = window.location.hostname.toLowerCase();
  // On static GitHub Pages without a configured Worker/API base, avoid 404 console spam
  if (host.endsWith('.github.io')) {
    return null;
  }

  return '/api/client-logs';
}

function extractErrorDetails(err: unknown): { message: string; stack: string } {
  if (err instanceof Error) {
    return {
      message: err.message || err.name || 'Error',
      stack: (err.stack || '').slice(0, 1500),
    };
  }
  if (typeof err === 'string') {
    return { message: err, stack: '' };
  }
  try {
    return { message: JSON.stringify(err), stack: '' };
  } catch {
    return { message: String(err || 'Unknown error'), stack: '' };
  }
}

function sanitizeContext(
  ctx?: Record<string, string | number | boolean | null | undefined>
): Record<string, string | number | boolean> | undefined {
  if (!ctx) return undefined;
  const clean: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (v === undefined || v === null) continue;
    clean[k.slice(0, 40)] = typeof v === 'string' ? v.slice(0, 240) : v;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export function reportClientError(report: ClientErrorReport): void {
  if (typeof window === 'undefined') return;
  if (sentCountThisSession >= MAX_LOGS_PER_SESSION) return;

  const extracted = report.error ? extractErrorDetails(report.error) : null;
  const finalMessage = (report.message || extracted?.message || 'Unknown client error').slice(0, 600);
  const signature = `${report.source}::${finalMessage}`;
  const now = Date.now();
  const prevTs = recentSignatures.get(signature);
  if (prevTs && now - prevTs < DEDUP_WINDOW_MS) {
    return;
  }
  recentSignatures.set(signature, now);
  sentCountThisSession += 1;

  // Persist locally so the Admin Log Center always shows recent client runtime errors
  appendLocalClientErrorLog(report.source, report.error || finalMessage);

  const endpoint = resolveClientLogsEndpoint();
  if (!endpoint) return;

  const payload = JSON.stringify({
    level: report.level || 'error',
    source: report.source.slice(0, 80),
    message: finalMessage,
    stack: extracted?.stack || '',
    route: `${window.location.pathname}${window.location.hash || ''}`.slice(0, 250),
    host: window.location.hostname.slice(0, 120),
    release: import.meta.env.DEV ? 'dev' : 'prod',
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    context: sanitizeContext(report.context),
  });

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([payload], { type: 'application/json' });
      const queued = navigator.sendBeacon(endpoint, blob);
      if (queued) return;
    }
  } catch {
    // Fallback to fetch keepalive below
  }

  try {
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Never allow telemetry errors to propagate
  }
}

export function installGlobalErrorLogging(): void {
  if (typeof window === 'undefined' || installed) return;
  installed = true;

  // 1. Uncaught runtime errors & critical asset/script load errors (capture phase)
  window.addEventListener(
    'error',
    (event: Event) => {
      if (event instanceof ErrorEvent) {
        const msg = event.message || 'Uncaught window error';
        // Ignore benign browser ResizeObserver loop warnings or HMR websocket messages
        if (
          msg.includes('ResizeObserver loop') ||
          msg.includes('WebSocket') ||
          msg.includes('vite-hmr')
        ) {
          return;
        }
        reportClientError({
          source: 'window.onerror',
          level: 'error',
          message: msg,
          error: event.error,
          context: {
            filename: event.filename || '',
            lineno: event.lineno || 0,
            colno: event.colno || 0,
          },
        });
        return;
      }

      // Resource load error on critical hosting assets (script/link stylesheets — skip poster img fallbacks)
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
        const srcUrl =
          (target as HTMLScriptElement).src || (target as HTMLLinkElement).href || 'unknown-asset';
        reportClientError({
          source: 'asset.load_error',
          level: 'fatal',
          message: `Failed to load critical ${target.tagName.toLowerCase()} asset: ${srcUrl}`,
          context: { tagName: target.tagName, srcUrl },
        });
      }
    },
    true
  );

  // 2. Unhandled Promise Rejections
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const details = extractErrorDetails(event.reason);
    if (details.message.includes('WebSocket') || details.message.includes('ResizeObserver')) {
      return;
    }
    reportClientError({
      source: 'window.unhandledrejection',
      level: 'error',
      message: details.message,
      error: event.reason,
    });
  });

  // 3. Vite Dynamic Chunk / Hosting Preload Failures
  window.addEventListener('vite:preloadError', (event: Event) => {
    const detail = (event as CustomEvent)?.detail;
    reportClientError({
      source: 'vite.preloadError',
      level: 'fatal',
      message: 'Dynamic module chunk failed to load on host',
      error: detail,
    });
  });
}
