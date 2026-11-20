import {
  buildServerHealthId,
  bulkSaveServerHealthRecordsToFirestore,
  saveServerHealthRecordToFirestore,
} from './firebase';
import {
  sanitizeAndRepairStreamUrl,
  saveRememberedWorkingMode,
  syncHealthReportToDiagnostics,
} from './playerAutoRepair';
import type { WatchMode } from './serverFailover';
import {
  runMultiStageServerCheck,
  type ServerHealthReport,
} from './serverHealthChecker';
import type {
  EpisodeItem,
  MediaItem,
  ServerHealthRecord,
  ServerWatchMode,
  StreamServer,
} from '../types/media';

const LOCAL_HEALTH_STORAGE_KEY = 'rahaltv_server_health_cache_v1';
export const DEFAULT_HEALTH_TTL_HEALTHY_MS = 12 * 60 * 60 * 1000; // 12h
export const DEFAULT_HEALTH_TTL_FAILED_MS = 2 * 60 * 60 * 1000; // 2h

export interface HealthQueueTarget {
  url: string;
  serverName?: string;
  mediaId?: string;
  mediaTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  verifyIframeLoad?: boolean;
  verifyVideoPlayback?: boolean;
  forceRefresh?: boolean;
}

export interface ServerHealthQueueState {
  running: boolean;
  total: number;
  completed: number;
  inFlight: number;
  queued: number;
  lastUpdatedUrl: string | null;
}

type QueueListener = (state: ServerHealthQueueState, map: Record<string, ServerHealthRecord>) => void;

let memoryHealthMap: Record<string, ServerHealthRecord> = {};
const listeners = new Set<QueueListener>();
const pendingQueue: HealthQueueTarget[] = [];
const queuedUrlSet = new Set<string>();
const inFlightUrls = new Set<string>();
let activeUid: string | undefined;
let totalScheduled = 0;
let totalCompleted = 0;
let lastUpdatedUrl: string | null = null;
let pumpRunning = false;

export function loadLocalServerHealthCache(): Record<string, ServerHealthRecord> {
  if (typeof window === 'undefined') return { ...memoryHealthMap };
  try {
    const raw = window.localStorage.getItem(LOCAL_HEALTH_STORAGE_KEY);
    if (!raw) return { ...memoryHealthMap };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      memoryHealthMap = parsed as Record<string, ServerHealthRecord>;
    }
    return { ...memoryHealthMap };
  } catch {
    return { ...memoryHealthMap };
  }
}

function persistLocalServerHealthCache(map: Record<string, ServerHealthRecord>): void {
  const entries = Object.entries(map);
  let trimmed = map;
  if (entries.length > 500) {
    entries.sort((a, b) => (b[1].lastCheckedAtMs || 0) - (a[1].lastCheckedAtMs || 0));
    trimmed = Object.fromEntries(entries.slice(0, 500));
  }
  memoryHealthMap = trimmed;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LOCAL_HEALTH_STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // Ignore storage quota issues
    }
  }
}

export function isServerHealthExpired(record: ServerHealthRecord | undefined | null, nowMs = Date.now()): boolean {
  if (!record || !record.lastCheckedAtMs) return true;
  const ttl = record.ttlMs || (record.status === 'broken' || record.status === 'unknown_error'
    ? DEFAULT_HEALTH_TTL_FAILED_MS
    : DEFAULT_HEALTH_TTL_HEALTHY_MS);
  return nowMs - record.lastCheckedAtMs > ttl;
}

export function mergeExternalServerHealthMap(externalMap: Record<string, ServerHealthRecord>): void {
  const current = loadLocalServerHealthCache();
  let changed = false;
  for (const [url, rec] of Object.entries(externalMap)) {
    const existing = current[url];
    if (!existing || (rec.lastCheckedAtMs || 0) >= (existing.lastCheckedAtMs || 0)) {
      current[url] = rec;
      changed = true;
    }
  }
  if (changed) {
    persistLocalServerHealthCache(current);
    notifyListeners();
  }
}

export function reportToServerHealthRecord(
  report: ServerHealthReport,
  meta: {
    mediaId?: string;
    mediaTitle?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    serverName?: string;
    checkedBy?: string;
    succeededMode?: ServerWatchMode | '';
  } = {}
): ServerHealthRecord {
  const nowMs = Date.now();
  let host = 'unknown';
  try {
    host = new URL(report.url).hostname.replace(/^www\./, '').toLowerCase() || 'unknown';
  } catch {
    host = 'unknown';
  }
  const isFailure = report.status === 'broken' || report.status === 'unknown_error' || report.status === 'iframe_blocked';
  const lastSuccessfulMode: ServerWatchMode | '' =
    meta.succeededMode ||
    (report.succeededMode as ServerWatchMode | undefined) ||
    (report.recommendedModes?.[0] as ServerWatchMode | undefined) ||
    '';

  return {
    id: buildServerHealthId(report.url),
    url: report.url,
    host,
    ...(meta.mediaId ? { mediaId: meta.mediaId } : {}),
    ...(meta.mediaTitle ? { mediaTitle: meta.mediaTitle } : {}),
    ...(typeof meta.seasonNumber === 'number' ? { seasonNumber: meta.seasonNumber } : {}),
    ...(typeof meta.episodeNumber === 'number' ? { episodeNumber: meta.episodeNumber } : {}),
    serverName: meta.serverName || report.serverName || 'سيرفر',
    status: report.status,
    connectivityStatus: report.connectivity.status,
    httpStatus: report.httpStatus || 0,
    canEmbedInIframe: Boolean(report.canEmbedInIframe),
    pageLoadStatus: report.pageLoad.label || report.pageLoad.status,
    playerInitResult: report.playerCheck.label || report.playerCheck.status,
    triedModes: ((report.triedModes || report.recommendedModes || []) as ServerWatchMode[]).slice(0, 6),
    lastSuccessfulMode,
    videoPlaybackConfirmed: Boolean(report.playerCheck.playbackConfirmed),
    latencyMs: Math.max(0, Math.round(report.latencyMs || 0)),
    lastFailureReason:
      isFailure ? report.reasonText || report.playerCheck.detail || '' : '',
    lastCheckedAtMs: nowMs,
    ttlMs: isFailure ? DEFAULT_HEALTH_TTL_FAILED_MS : DEFAULT_HEALTH_TTL_HEALTHY_MS,
    ...(meta.checkedBy ? { checkedBy: meta.checkedBy } : {}),
  };
}

export function getServerHealthQueueState(): ServerHealthQueueState {
  return {
    running: pumpRunning || pendingQueue.length > 0 || inFlightUrls.size > 0,
    total: totalScheduled,
    completed: totalCompleted,
    inFlight: inFlightUrls.size,
    queued: pendingQueue.length,
    lastUpdatedUrl,
  };
}

function notifyListeners() {
  const snapshotState = getServerHealthQueueState();
  const snapshotMap = { ...memoryHealthMap };
  listeners.forEach((cb) => {
    try {
      cb(snapshotState, snapshotMap);
    } catch {
      // Ignore listener errors
    }
  });
}

export function subscribeServerHealthQueue(listener: QueueListener): () => void {
  listeners.add(listener);
  listener(getServerHealthQueueState(), loadLocalServerHealthCache());
  return () => {
    listeners.delete(listener);
  };
}

async function processTarget(target: HealthQueueTarget): Promise<ServerHealthRecord> {
  const repaired = sanitizeAndRepairStreamUrl(null, target.url);
  const checkUrl = repaired.url || target.url;
  const report = await runMultiStageServerCheck(checkUrl, {
    serverName: target.serverName,
    verifyVideoPlayback: target.verifyVideoPlayback !== false,
    verifyIframeLoad: Boolean(target.verifyIframeLoad),
    timeoutMs: 6500,
  });

  // Preserve target URL key if repaired matches or store under original target.url
  const normalizedReport: ServerHealthReport = { ...report, url: target.url };
  const record = reportToServerHealthRecord(normalizedReport, {
    mediaId: target.mediaId,
    mediaTitle: target.mediaTitle,
    seasonNumber: target.seasonNumber,
    episodeNumber: target.episodeNumber,
    serverName: target.serverName,
    checkedBy: activeUid,
  });

  if (record.lastSuccessfulMode && record.status !== 'broken' && record.status !== 'iframe_blocked') {
    saveRememberedWorkingMode(target.url, record.lastSuccessfulMode as WatchMode);
  }

  syncHealthReportToDiagnostics(normalizedReport, {
    source: 'admin_check',
    mediaTitle: target.mediaTitle,
    triedModes: record.triedModes as WatchMode[],
    succeededMode: (record.lastSuccessfulMode || null) as WatchMode | null,
    repairsApplied: repaired.repairsApplied,
  });

  const cache = loadLocalServerHealthCache();
  cache[target.url] = record;
  persistLocalServerHealthCache(cache);
  lastUpdatedUrl = target.url;

  if (activeUid) {
    void saveServerHealthRecordToFirestore(record, activeUid);
  }

  return record;
}

async function pumpQueue(concurrency = 3): Promise<void> {
  if (pumpRunning) return;
  pumpRunning = true;
  notifyListeners();

  try {
    const workers = Array.from({ length: Math.max(1, Math.min(4, concurrency)) }, async () => {
      while (pendingQueue.length > 0) {
        const next = pendingQueue.shift();
        if (!next) break;
        queuedUrlSet.delete(next.url);
        inFlightUrls.add(next.url);
        notifyListeners();
        try {
          await processTarget(next);
        } catch {
          // Swallow isolated probe failures so queue continues
        } finally {
          inFlightUrls.delete(next.url);
          totalCompleted += 1;
          notifyListeners();
        }
      }
    });
    await Promise.all(workers);
  } finally {
    pumpRunning = false;
    if (pendingQueue.length === 0 && inFlightUrls.size === 0) {
      totalScheduled = 0;
      totalCompleted = 0;
    }
    notifyListeners();
  }
}

export function enqueueServerHealthChecks(
  targets: HealthQueueTarget[],
  uid?: string
): { enqueuedCount: number } {
  if (uid) activeUid = uid;
  const cache = loadLocalServerHealthCache();
  const nowMs = Date.now();
  let enqueuedCount = 0;

  for (const t of targets) {
    const cleanUrl = String(t.url || '').trim();
    if (!cleanUrl) continue;
    if (queuedUrlSet.has(cleanUrl) || inFlightUrls.has(cleanUrl)) continue;
    if (!t.forceRefresh && cache[cleanUrl] && !isServerHealthExpired(cache[cleanUrl], nowMs)) {
      continue;
    }
    queuedUrlSet.add(cleanUrl);
    pendingQueue.push({ ...t, url: cleanUrl });
    totalScheduled += 1;
    enqueuedCount += 1;
  }

  if (enqueuedCount > 0) {
    void pumpQueue(3);
  }
  return { enqueuedCount };
}

export async function checkSingleServerImmediately(
  target: HealthQueueTarget,
  uid?: string
): Promise<ServerHealthRecord> {
  if (uid) activeUid = uid;
  return processTarget(target);
}

export function extractTargetsFromServerList(
  servers: StreamServer[] | undefined,
  meta: Omit<HealthQueueTarget, 'url' | 'serverName'>
): HealthQueueTarget[] {
  const out: HealthQueueTarget[] = [];
  for (const srv of servers || []) {
    const repaired = sanitizeAndRepairStreamUrl(srv.embedCode, srv.url);
    const url = repaired.url || String(srv.url || '').trim();
    if (!url) continue;
    out.push({
      url,
      serverName: srv.name || 'سيرفر',
      ...meta,
    });
  }
  return out;
}

export function extractTargetsFromMediaItem(
  item: MediaItem,
  options: { forceRefresh?: boolean; onlyBrokenOrExpired?: boolean; cache?: Record<string, ServerHealthRecord> } = {}
): HealthQueueTarget[] {
  const targets: HealthQueueTarget[] = [];
  const seen = new Set<string>();
  const cache = options.cache || loadLocalServerHealthCache();
  const nowMs = Date.now();

  const maybePush = (t: HealthQueueTarget) => {
    if (!t.url || seen.has(t.url)) return;
    if (options.onlyBrokenOrExpired) {
      const rec = cache[t.url];
      if (rec && rec.status !== 'broken' && rec.status !== 'unknown_error' && rec.status !== 'iframe_blocked' && !isServerHealthExpired(rec, nowMs)) {
        return;
      }
    }
    seen.add(t.url);
    targets.push({ ...t, forceRefresh: Boolean(options.forceRefresh || options.onlyBrokenOrExpired) });
  };

  extractTargetsFromServerList(item.servers, {
    mediaId: item.id,
    mediaTitle: item.title,
  }).forEach(maybePush);

  for (const season of item.seasons || []) {
    for (const ep of season.episodes || []) {
      extractEpisodeTargets(item, season.seasonNumber, ep).forEach(maybePush);
    }
  }

  return targets;
}

export function extractEpisodeTargets(
  item: MediaItem,
  seasonNumber: number,
  episode: EpisodeItem
): HealthQueueTarget[] {
  const targets = extractTargetsFromServerList(episode.servers, {
    mediaId: item.id,
    mediaTitle: item.title,
    seasonNumber,
    episodeNumber: episode.number,
  });
  const directRepaired = sanitizeAndRepairStreamUrl(episode.embedCode, episode.watchUrl);
  if (directRepaired.url && !targets.some((t) => t.url === directRepaired.url)) {
    targets.unshift({
      url: directRepaired.url,
      serverName: `الحلقة ${episode.number}`,
      mediaId: item.id,
      mediaTitle: item.title,
      seasonNumber,
      episodeNumber: episode.number,
    });
  }
  return targets;
}

export function enqueueMediaHealthChecks(
  item: MediaItem,
  uid?: string,
  forceRefresh = true
): { enqueuedCount: number } {
  const targets = extractTargetsFromMediaItem(item, { forceRefresh });
  return enqueueServerHealthChecks(targets, uid);
}

export function enqueueSeasonHealthChecks(
  item: MediaItem,
  seasonNumber: number,
  uid?: string,
  forceRefresh = true
): { enqueuedCount: number } {
  const season = (item.seasons || []).find((s) => s.seasonNumber === seasonNumber);
  if (!season) return { enqueuedCount: 0 };
  const targets: HealthQueueTarget[] = [];
  for (const ep of season.episodes || []) {
    for (const t of extractEpisodeTargets(item, seasonNumber, ep)) {
      targets.push({ ...t, forceRefresh });
    }
  }
  return enqueueServerHealthChecks(targets, uid);
}

export function sortServersByCachedHealth<T extends { url?: string; embedCode?: string }>(
  servers: T[],
  healthMap: Record<string, ServerHealthRecord>
): T[] {
  if (!servers || servers.length <= 1) return servers;
  const rankStatus = (rec?: ServerHealthRecord): number => {
    if (!rec) return 2; // unchecked -> try normally before known broken
    if (rec.status === 'confirmed_playing') return 0;
    if (rec.status === 'page_available') return 1;
    if (rec.status === 'needs_manual_check' || rec.status === 'unknown_error') return 2;
    if (rec.status === 'iframe_blocked') return 4;
    if (rec.status === 'broken') return 5;
    return 3;
  };
  return servers
    .map((srv, idx) => {
      const url = sanitizeAndRepairStreamUrl(srv.embedCode, srv.url).url || srv.url || '';
      const rec = url ? healthMap[url] : undefined;
      return { srv, idx, rank: rankStatus(rec), latency: rec?.latencyMs || 9999 };
    })
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.latency - b.latency || a.idx - b.idx))
    .map((entry) => entry.srv);
}

export function recordPassivePlayerObservation(params: {
  url: string;
  serverName?: string;
  mediaId?: string;
  mediaTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  status: ServerHealthRecord['status'];
  succeededMode?: ServerWatchMode | '';
  failureReason?: string;
  playbackConfirmed?: boolean;
  uid?: string;
}): void {
  const cleanUrl = String(params.url || '').trim();
  if (!cleanUrl) return;
  const cache = loadLocalServerHealthCache();
  const prev = cache[cleanUrl];
  let host = 'unknown';
  try {
    host = new URL(cleanUrl).hostname.replace(/^www\./, '').toLowerCase() || 'unknown';
  } catch {
    host = 'unknown';
  }
  const nowMs = Date.now();
  const next: ServerHealthRecord = {
    id: buildServerHealthId(cleanUrl),
    url: cleanUrl,
    host,
    mediaId: params.mediaId || prev?.mediaId,
    mediaTitle: params.mediaTitle || prev?.mediaTitle,
    seasonNumber: params.seasonNumber ?? prev?.seasonNumber,
    episodeNumber: params.episodeNumber ?? prev?.episodeNumber,
    serverName: params.serverName || prev?.serverName || 'سيرفر',
    status: params.status,
    connectivityStatus: prev?.connectivityStatus || 'reachable',
    httpStatus: prev?.httpStatus || 200,
    canEmbedInIframe: params.status === 'iframe_blocked' ? false : prev?.canEmbedInIframe ?? true,
    pageLoadStatus: prev?.pageLoadStatus || 'loaded',
    playerInitResult: params.playbackConfirmed ? 'تم تأكيد التشغيل' : prev?.playerInitResult || 'runtime',
    triedModes: Array.from(
      new Set<ServerWatchMode>([
        ...(prev?.triedModes || []),
        ...(params.succeededMode ? [params.succeededMode] : []),
      ])
    ).slice(0, 6),
    lastSuccessfulMode: params.succeededMode || prev?.lastSuccessfulMode || '',
    videoPlaybackConfirmed: Boolean(params.playbackConfirmed || prev?.videoPlaybackConfirmed),
    latencyMs: prev?.latencyMs || 0,
    lastFailureReason: params.failureReason ?? prev?.lastFailureReason ?? '',
    lastCheckedAtMs: nowMs,
    ttlMs: params.status === 'broken' ? DEFAULT_HEALTH_TTL_FAILED_MS : DEFAULT_HEALTH_TTL_HEALTHY_MS,
  };
  cache[cleanUrl] = next;
  persistLocalServerHealthCache(cache);
  if (params.uid) {
    void bulkSaveServerHealthRecordsToFirestore([next], params.uid);
  }
  notifyListeners();
}
