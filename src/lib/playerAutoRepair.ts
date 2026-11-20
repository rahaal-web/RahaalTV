import type { WatchMode } from './serverFailover';
import { buildCompatibleModeChain } from './serverFailover';
import type { ServerHealthReport, ServerHealthStatus } from './serverHealthCore';
import type { PopupShieldConfig } from '../types/media';
import { resolveEffectiveShieldDecision } from './popupShield';

export type PipelineStageKey =
  | 'url_validation'
  | 'connectivity_check'
  | 'http_redirect_check'
  | 'player_mount'
  | 'player_init'
  | 'mode_fallback'
  | 'final_verify';

export const STAGE_PROGRESS_RANGES: Record<PipelineStageKey, { min: number; max: number }> = {
  url_validation: { min: 0, max: 10 },
  connectivity_check: { min: 10, max: 25 },
  http_redirect_check: { min: 25, max: 40 },
  player_mount: { min: 40, max: 55 },
  player_init: { min: 55, max: 70 },
  mode_fallback: { min: 70, max: 90 },
  final_verify: { min: 90, max: 100 },
};

export interface PipelineProgressOptions {
  stage: PipelineStageKey;
  subFraction?: number;
  previousPercent?: number;
  allowFinal100?: boolean;
}

/**
 * Computes genuine monotonic circular progress percentage bound strictly to pipeline stages:
 * 0-10 URL validation, 10-25 connectivity, 25-40 HTTP/redirect,
 * 40-55 player mount, 55-70 player init, 70-90 mode fallback, 90-100 final check.
 * Never claims 100% until `allowFinal100` is explicitly true in `final_verify`.
 */
export function computeStageProgressPercent({
  stage,
  subFraction = 1,
  previousPercent = 0,
  allowFinal100 = false,
}: PipelineProgressOptions): number {
  const range = STAGE_PROGRESS_RANGES[stage];
  const clampedFraction = Math.max(0, Math.min(1, Number.isFinite(subFraction) ? subFraction : 1));
  const raw = Math.round(range.min + (range.max - range.min) * clampedFraction);
  const capped = allowFinal100 && stage === 'final_verify' ? Math.min(100, raw) : Math.min(99, raw);
  const floorPrev = Math.max(0, Math.min(99, Math.round(previousPercent)));
  return Math.max(floorPrev, capped);
}

export type StreamMediaKind = 'hls' | 'dash' | 'mp4' | 'iframe' | 'invalid';

export interface SanitizedStreamResult {
  valid: boolean;
  url: string | null;
  rawInput: string;
  host: string;
  mediaKind: StreamMediaKind;
  repairsApplied: string[];
  invalidReason?: string;
}

const TRACKING_QUERY_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
]);

function decodeCommonHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&#x26;/gi, '&')
    .replace(/&#38;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'");
}

function classifyMediaKindFromUrl(urlStr: string): StreamMediaKind {
  const lower = urlStr.toLowerCase();
  if (/\.m3u8(\?|$|#)/i.test(lower)) return 'hls';
  if (/\.mpd(\?|$|#)/i.test(lower)) return 'dash';
  if (/\.(mp4|webm|ogg|m4v|mov)(\?|$|#)/i.test(lower)) return 'mp4';
  return 'iframe';
}

/**
 * Safely repairs and normalizes runtime stream URLs or embed markup without mutating DB catalog items.
 */
export function sanitizeAndRepairStreamUrl(
  embedCode?: string | null,
  rawUrl?: string | null
): SanitizedStreamResult {
  const rawEmbed = String(embedCode || '').trim();
  const rawDirect = String(rawUrl || '').trim();
  const repairsApplied: string[] = [];

  let candidate = '';
  if (rawEmbed) {
    const srcMatch =
      rawEmbed.match(/src\s*=\s*["']([^"']+)["']/i) ||
      rawEmbed.match(/src\s*=\s*([^\s>]+)/i);
    if (srcMatch?.[1]) {
      candidate = srcMatch[1].trim();
      repairsApplied.push('extracted_iframe_src');
    } else if (!rawEmbed.startsWith('<')) {
      candidate = rawEmbed;
    }
  }
  if (!candidate && rawDirect) {
    candidate = rawDirect;
  }

  const rawInput = candidate;
  if (!candidate) {
    return {
      valid: false,
      url: null,
      rawInput: '',
      host: '',
      mediaKind: 'invalid',
      repairsApplied,
      invalidReason: 'empty_url',
    };
  }

  // Strip surrounding quotes and invisible control characters
  const cleanedControl = candidate.replace(/^['"]+|['"]+$/g, '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (cleanedControl !== candidate) {
    repairsApplied.push('trimmed_whitespace_or_quotes');
    candidate = cleanedControl;
  }

  // Reject dangerous or non-web schemes immediately
  if (/^(?:javascript|data|vbscript|file|blob):/i.test(candidate)) {
    return {
      valid: false,
      url: null,
      rawInput,
      host: '',
      mediaKind: 'invalid',
      repairsApplied,
      invalidReason: 'unsafe_protocol',
    };
  }

  // Unescape JSON slashes (e.g. https:\/\/host\/embed)
  if (candidate.includes('\\/')) {
    candidate = candidate.replace(/\\\//g, '/');
    repairsApplied.push('unescaped_json_slashes');
  }

  // Decode HTML entities inside URL (&amp; -> &)
  if (/&(?:amp|#x26|#38);/i.test(candidate)) {
    candidate = decodeCommonHtmlEntities(candidate);
    repairsApplied.push('decoded_html_entities');
  }

  // Normalize protocol-relative URLs (//cdn.example/...)
  if (candidate.startsWith('//')) {
    candidate = `https:${candidate}`;
    repairsApplied.push('added_https_scheme_to_protocol_relative');
  } else if (!/^https?:\/\//i.test(candidate) && /^[a-z0-9.-]+\.[a-z]{2,}(?:\/|:|\?|$)/i.test(candidate)) {
    candidate = `https://${candidate}`;
    repairsApplied.push('added_https_scheme');
  }

  // Encode bare spaces safely
  if (/\s/.test(candidate)) {
    candidate = candidate.replace(/\s+/g, '%20');
    repairsApplied.push('encoded_spaces');
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      valid: false,
      url: null,
      rawInput,
      host: '',
      mediaKind: 'invalid',
      repairsApplied,
      invalidReason: 'malformed_url',
    };
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || !parsed.hostname.includes('.')) {
    // Allow localhost/127.0.0.1 ONLY during local dev/test harnesses if explicitly http/https with valid hostname
    const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (!isLoopback || !['http:', 'https:'].includes(parsed.protocol)) {
      return {
        valid: false,
        url: null,
        rawInput,
        host: parsed.hostname || '',
        mediaKind: 'invalid',
        repairsApplied,
        invalidReason: 'invalid_host_or_protocol',
      };
    }
  }

  // Strip known analytics tracking params without mutating media/auth query params
  let strippedTracking = false;
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (TRACKING_QUERY_PARAMS.has(key.toLowerCase())) {
      parsed.searchParams.delete(key);
      strippedTracking = true;
    }
  }
  if (strippedTracking) {
    repairsApplied.push('removed_tracking_params');
  }

  const normalizedUrl = parsed.toString();
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const mediaKind = classifyMediaKindFromUrl(normalizedUrl);

  return {
    valid: true,
    url: normalizedUrl,
    rawInput,
    host,
    mediaKind,
    repairsApplied,
  };
}

export interface SafeIframePresentation {
  mode: WatchMode;
  sandboxAttr: string | undefined;
  referrerPolicy: 'no-referrer' | 'strict-origin-when-cross-origin' | 'origin';
  allowAttr: string;
}

const ORIGIN_REFERER_HOSTS = ['ok.ru', 'vk.com', 'vkvideo.ru', 'rutube.ru', 'dailymotion.com'];

/**
 * Selects safe iframe sandbox + referrerPolicy attributes based on mode & host requirements
 * without ever stripping security headers or circumventing X-Frame-Options/CSP blocks.
 */
export function resolveSafeIframePresentation(
  url: string,
  shieldConfig: PopupShieldConfig,
  overrideMode: Exclude<WatchMode, 'direct_media'> | null
): SafeIframePresentation {
  const decision = resolveEffectiveShieldDecision(url, shieldConfig, overrideMode);
  const host = decision.hostname || '';
  const needsOriginReferer = ORIGIN_REFERER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

  return {
    mode: decision.mode,
    sandboxAttr: decision.sandboxAttr,
    referrerPolicy: needsOriginReferer ? 'strict-origin-when-cross-origin' : 'no-referrer',
    allowAttr: 'autoplay; fullscreen; encrypted-media; picture-in-picture; accelerometer; gyroscope',
  };
}

// ---------- Remembered Working Mode Per Host / Server ----------

const WORKING_MODES_STORAGE_KEY = 'rahaltv_working_modes_v1';
const DIAGNOSTICS_MAP_STORAGE_KEY = 'rahaltv_server_diagnostics_map_v1';
const ATTEMPT_HISTORY_STORAGE_KEY = 'rahaltv_server_attempt_history_v1';
const MAX_DIAGNOSTIC_MAP_ENTRIES = 300;
const MAX_ATTEMPT_HISTORY_ENTRIES = 150;

let memoryWorkingModes: Record<string, { mode: WatchMode; updatedAt: string }> = {};

function extractHostKey(serverUrlOrHost: string): string {
  const raw = String(serverUrlOrHost || '').trim();
  if (!raw) return '';
  if (!raw.includes('://') && !raw.includes('/')) {
    return raw.replace(/^www\./, '').toLowerCase();
  }
  try {
    return new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function loadAllRememberedWorkingModes(): Record<string, { mode: WatchMode; updatedAt: string }> {
  if (typeof window === 'undefined') {
    return { ...memoryWorkingModes };
  }
  try {
    const raw = window.localStorage.getItem(WORKING_MODES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function loadRememberedWorkingMode(serverUrlOrHost: string): WatchMode | null {
  const hostKey = extractHostKey(serverUrlOrHost);
  if (!hostKey) return null;
  const map = loadAllRememberedWorkingModes();
  const entry = map[hostKey];
  if (!entry?.mode) return null;
  if (
    entry.mode === 'direct_media' ||
    entry.mode === 'strict_sandbox' ||
    entry.mode === 'redirect_guard' ||
    entry.mode === 'direct_unrestricted'
  ) {
    return entry.mode;
  }
  return null;
}

export function saveRememberedWorkingMode(serverUrlOrHost: string, mode: WatchMode): void {
  const hostKey = extractHostKey(serverUrlOrHost);
  if (!hostKey) return;
  const map = loadAllRememberedWorkingModes();
  map[hostKey] = {
    mode,
    updatedAt: new Date().toISOString(),
  };

  // Cap stored hosts to 250
  const entries = Object.entries(map);
  if (entries.length > 250) {
    entries.sort((a, b) => (b[1].updatedAt || '').localeCompare(a[1].updatedAt || ''));
    const trimmed = Object.fromEntries(entries.slice(0, 250));
    memoryWorkingModes = trimmed;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(WORKING_MODES_STORAGE_KEY, JSON.stringify(trimmed));
      } catch {
        // Ignore storage quota errors
      }
    }
    return;
  }

  memoryWorkingModes = map;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(WORKING_MODES_STORAGE_KEY, JSON.stringify(map));
    } catch {
      // Ignore storage quota errors
    }
  }
}

export function clearRememberedWorkingMode(serverUrlOrHost: string): void {
  const hostKey = extractHostKey(serverUrlOrHost);
  if (!hostKey) return;
  const map = loadAllRememberedWorkingModes();
  if (!(hostKey in map)) return;
  delete map[hostKey];
  memoryWorkingModes = map;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(WORKING_MODES_STORAGE_KEY, JSON.stringify(map));
    } catch {
      // Ignore
    }
  }
}

export function resetMemoryWorkingModesForTests(): void {
  memoryWorkingModes = {};
}

/**
 * Builds mode fallback sequence honoring security rules AND prioritizing
 * any previously proven working mode for this server host.
 */
export function buildSmartModeChainWithMemory({
  serverUrl,
  primaryMode,
  isDirectMedia,
  antiSandboxDetected = false,
  hasDirectStreamFallback = false,
}: {
  serverUrl: string;
  primaryMode: WatchMode;
  isDirectMedia: boolean;
  antiSandboxDetected?: boolean;
  hasDirectStreamFallback?: boolean;
}): { modeChain: WatchMode[]; rememberedMode: WatchMode | null } {
  const baseChain = buildCompatibleModeChain({
    primaryMode,
    isDirectMedia,
    antiSandboxDetected,
    hasDirectStreamFallback,
  });

  if (isDirectMedia) {
    return { modeChain: baseChain, rememberedMode: 'direct_media' };
  }

  const rememberedMode = loadRememberedWorkingMode(serverUrl);
  if (!rememberedMode) {
    return { modeChain: baseChain, rememberedMode: null };
  }

  // Respect security & capability constraints even if memory had an old mode
  if (antiSandboxDetected && rememberedMode === 'strict_sandbox') {
    return { modeChain: baseChain, rememberedMode: null };
  }
  if (rememberedMode === 'direct_media' && !hasDirectStreamFallback) {
    return { modeChain: baseChain, rememberedMode: null };
  }

  if (baseChain.includes(rememberedMode)) {
    const prioritized = [rememberedMode, ...baseChain.filter((m) => m !== rememberedMode)];
    return { modeChain: prioritized, rememberedMode };
  }

  return { modeChain: baseChain, rememberedMode: null };
}

// ---------- Persistent Admin Server Diagnostics & Attempt History ----------

export interface ServerDiagnosticRecord {
  url: string;
  finalUrl?: string;
  host: string;
  serverName: string;
  mediaTitle?: string;
  status: ServerHealthStatus;
  httpStatus: number;
  latencyMs: number;
  lastCheckedAt: string;
  connectivityStatus: string;
  connectivityDetail: string;
  embedCheckResult: string;
  playerInitResult: string;
  triedModes: WatchMode[];
  succeededMode: WatchMode | null;
  failureReason: string | null;
  playbackConfirmed: boolean;
  attemptCount: number;
  errorDetail: string | null;
  repairsApplied: string[];
  source: 'viewer_auto' | 'admin_check';
}

export interface ServerDiagnosticAttemptEntry extends ServerDiagnosticRecord {
  id: string;
  timestamp: string;
}

type DiagnosticsSubscriber = (payload: {
  map: Record<string, ServerDiagnosticRecord>;
  history: ServerDiagnosticAttemptEntry[];
}) => void;

let memoryDiagnosticsMap: Record<string, ServerDiagnosticRecord> = {};
let memoryAttemptHistory: ServerDiagnosticAttemptEntry[] = [];
const diagnosticsSubscribers = new Set<DiagnosticsSubscriber>();

export function loadServerDiagnosticsMap(): Record<string, ServerDiagnosticRecord> {
  if (typeof window === 'undefined') {
    return { ...memoryDiagnosticsMap };
  }
  try {
    const raw = window.localStorage.getItem(DIAGNOSTICS_MAP_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, ServerDiagnosticRecord>) : {};
  } catch {
    return {};
  }
}

export function loadServerAttemptHistory(): ServerDiagnosticAttemptEntry[] {
  if (typeof window === 'undefined') {
    return [...memoryAttemptHistory];
  }
  try {
    const raw = window.localStorage.getItem(ATTEMPT_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ServerDiagnosticAttemptEntry[]) : [];
  } catch {
    return [];
  }
}

function persistDiagnosticsState(
  nextMap: Record<string, ServerDiagnosticRecord>,
  nextHistory: ServerDiagnosticAttemptEntry[]
): void {
  memoryDiagnosticsMap = nextMap;
  memoryAttemptHistory = nextHistory;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(DIAGNOSTICS_MAP_STORAGE_KEY, JSON.stringify(nextMap));
      window.localStorage.setItem(ATTEMPT_HISTORY_STORAGE_KEY, JSON.stringify(nextHistory));
    } catch {
      // Ignore storage quota errors
    }
  }
  diagnosticsSubscribers.forEach((cb) => cb({ map: nextMap, history: nextHistory }));
}

export interface RecordDiagnosticInput {
  url: string;
  finalUrl?: string;
  serverName: string;
  mediaTitle?: string;
  status: ServerHealthStatus;
  httpStatus?: number;
  latencyMs?: number;
  connectivityStatus?: string;
  connectivityDetail?: string;
  embedCheckResult: string;
  playerInitResult: string;
  triedModes: WatchMode[];
  succeededMode?: WatchMode | null;
  failureReason?: string | null;
  playbackConfirmed: boolean;
  attemptCount?: number;
  errorDetail?: string | null;
  repairsApplied?: string[];
  source: 'viewer_auto' | 'admin_check';
}

export function recordServerDiagnosticAttempt(
  input: RecordDiagnosticInput
): ServerDiagnosticAttemptEntry {
  const normalizedUrl = String(input.url || '').trim();
  const timestamp = new Date().toISOString();
  const host = extractHostKey(normalizedUrl) || 'unknown';
  const currentMap = loadServerDiagnosticsMap();
  const existing = currentMap[normalizedUrl];

  const mergedModes = Array.from(
    new Set<WatchMode>([...(existing?.triedModes || []), ...(input.triedModes || [])])
  );
  const resolvedAttemptCount =
    input.attemptCount !== undefined
      ? input.attemptCount
      : (existing?.attemptCount || 0) + 1;

  const record: ServerDiagnosticRecord = {
    url: normalizedUrl,
    finalUrl: input.finalUrl || existing?.finalUrl,
    host,
    serverName: input.serverName || existing?.serverName || 'سيرفر',
    mediaTitle: input.mediaTitle || existing?.mediaTitle,
    status: input.status,
    httpStatus: input.httpStatus ?? existing?.httpStatus ?? 0,
    latencyMs: Math.max(0, Math.round(input.latencyMs ?? existing?.latencyMs ?? 0)),
    lastCheckedAt: timestamp,
    connectivityStatus: input.connectivityStatus || existing?.connectivityStatus || 'not_checked',
    connectivityDetail: input.connectivityDetail || existing?.connectivityDetail || '',
    embedCheckResult: input.embedCheckResult,
    playerInitResult: input.playerInitResult,
    triedModes: mergedModes.length > 0 ? mergedModes : input.triedModes,
    succeededMode:
      input.succeededMode !== undefined
        ? input.succeededMode
        : input.playbackConfirmed
          ? existing?.succeededMode ?? null
          : null,
    failureReason: input.failureReason ?? null,
    playbackConfirmed: input.playbackConfirmed,
    attemptCount: Math.max(1, resolvedAttemptCount),
    errorDetail: input.errorDetail ?? null,
    repairsApplied: input.repairsApplied || existing?.repairsApplied || [],
    source: input.source,
  };

  const nextMap: Record<string, ServerDiagnosticRecord> = {
    ...currentMap,
    [normalizedUrl]: record,
  };
  const mapEntries = Object.entries(nextMap);
  if (mapEntries.length > MAX_DIAGNOSTIC_MAP_ENTRIES) {
    mapEntries.sort((a, b) => (b[1].lastCheckedAt || '').localeCompare(a[1].lastCheckedAt || ''));
    const trimmedMap = Object.fromEntries(mapEntries.slice(0, MAX_DIAGNOSTIC_MAP_ENTRIES));
    Object.keys(nextMap).forEach((k) => {
      if (!(k in trimmedMap)) delete nextMap[k];
    });
  }

  const historyEntry: ServerDiagnosticAttemptEntry = {
    ...record,
    triedModes: [...(input.triedModes || [])],
    attemptCount: Math.max(1, input.attemptCount ?? 1),
    id: `diag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp,
  };

  const existingHistory = loadServerAttemptHistory();
  const nextHistory = [historyEntry, ...existingHistory].slice(0, MAX_ATTEMPT_HISTORY_ENTRIES);

  persistDiagnosticsState(nextMap, nextHistory);
  return historyEntry;
}

export function syncHealthReportToDiagnostics(
  report: ServerHealthReport,
  options: {
    source?: 'viewer_auto' | 'admin_check';
    mediaTitle?: string;
    triedModes?: WatchMode[];
    succeededMode?: WatchMode | null;
    repairsApplied?: string[];
  } = {}
): ServerDiagnosticAttemptEntry {
  return recordServerDiagnosticAttempt({
    url: report.url,
    finalUrl: report.finalUrl,
    serverName: report.serverName || 'سيرفر',
    mediaTitle: options.mediaTitle,
    status: report.status,
    httpStatus: report.httpStatus,
    latencyMs: report.latencyMs,
    connectivityStatus: report.connectivity.status,
    connectivityDetail: report.connectivity.detail,
    embedCheckResult: `${report.pageLoad.label}${report.pageLoad.frameBlocked ? ' (Frame Blocked)' : ''}${report.pageLoad.sandboxRejected ? ' (Sandbox Rejected)' : ''}`,
    playerInitResult: report.playerCheck.label,
    triedModes: options.triedModes || report.triedModes || [],
    succeededMode: options.succeededMode !== undefined ? options.succeededMode : report.succeededMode ?? null,
    failureReason:
      report.status === 'broken' || report.status === 'iframe_blocked'
        ? report.reasonText
        : null,
    playbackConfirmed: report.playerCheck.playbackConfirmed,
    attemptCount: report.attemptCount ?? 1,
    errorDetail:
      report.errorDetail ||
      (report.status === 'broken' || report.status === 'iframe_blocked'
        ? report.playerCheck.detail || report.reasonText
        : null),
    repairsApplied: options.repairsApplied || [],
    source: options.source || 'admin_check',
  });
}

export function clearServerAttemptHistory(): void {
  const currentMap = loadServerDiagnosticsMap();
  persistDiagnosticsState(currentMap, []);
}

export function resetDiagnosticsForTests(): void {
  memoryDiagnosticsMap = {};
  memoryAttemptHistory = [];
}

export function subscribeServerDiagnostics(listener: DiagnosticsSubscriber): () => void {
  diagnosticsSubscribers.add(listener);
  listener({
    map: loadServerDiagnosticsMap(),
    history: loadServerAttemptHistory(),
  });
  return () => {
    diagnosticsSubscribers.delete(listener);
  };
}
