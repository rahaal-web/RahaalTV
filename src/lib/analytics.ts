import { resolveApiEndpoint, shouldSkipBackendApiCalls } from './clientScraper';
import {
  fetchAnalyticsDailyRange,
  recordAnalyticsEventInFirestore,
  sanitizeRatingMediaId,
} from './firebase';
import type { AnalyticsDailyRecord } from '../types/media';

const LOCAL_ANALYTICS_KEY = 'rahaltv_analytics_daily_v1';
const sentSessionKeys = new Set<string>();

export function getDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function loadLocalAnalyticsDailyMap(): Record<string, AnalyticsDailyRecord> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_ANALYTICS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, AnalyticsDailyRecord>) : {};
  } catch {
    return {};
  }
}

function saveLocalAnalyticsDailyMap(map: Record<string, AnalyticsDailyRecord>): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = Object.fromEntries(
      Object.entries(map)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, 45)
    );
    window.localStorage.setItem(LOCAL_ANALYTICS_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore quota errors
  }
}

export function resetAnalyticsSessionDedupeForTests(): void {
  sentSessionKeys.clear();
}

export async function recordRealAnalyticsEvent(params: {
  kind: 'playback_start' | 'playback_complete' | 'watchlist_add';
  mediaId: string;
  seasonNumber?: number;
  episodeNumber?: number;
  genres?: string[];
  isSignedIn?: boolean;
  dedupeKeyOverride?: string;
}): Promise<boolean> {
  const cleanMedia = sanitizeRatingMediaId(params.mediaId);
  const episodeKey =
    typeof params.seasonNumber === 'number' && typeof params.episodeNumber === 'number'
      ? `${cleanMedia}__s${params.seasonNumber}e${params.episodeNumber}`
      : undefined;
  const dedupeKey =
    params.dedupeKeyOverride ||
    `${params.kind}::${cleanMedia}::${episodeKey || 'movie'}`;

  if (sentSessionKeys.has(dedupeKey)) {
    return false;
  }
  sentSessionKeys.add(dedupeKey);

  const dayKey = getDayKey();
  const map = loadLocalAnalyticsDailyMap();
  const existing = map[dayKey] || {
    id: dayKey,
    playbackStarts: 0,
    playbackCompletes: 0,
    watchlistAdds: 0,
    mediaCounts: {},
    episodeCounts: {},
    genreCounts: {},
    updatedAtMs: Date.now(),
  };

  const mediaCounts = { ...(existing.mediaCounts || {}) };
  const episodeCounts = { ...(existing.episodeCounts || {}) };
  const genreCounts = { ...(existing.genreCounts || {}) };

  if (params.kind === 'playback_start') {
    mediaCounts[cleanMedia] = (mediaCounts[cleanMedia] || 0) + 1;
    if (episodeKey) {
      episodeCounts[episodeKey] = (episodeCounts[episodeKey] || 0) + 1;
    }
    for (const g of (params.genres || []).slice(0, 4)) {
      const cleanG = String(g || '').trim();
      if (cleanG) genreCounts[cleanG] = (genreCounts[cleanG] || 0) + 1;
    }
  }

  map[dayKey] = {
    id: dayKey,
    playbackStarts: existing.playbackStarts + (params.kind === 'playback_start' ? 1 : 0),
    playbackCompletes: existing.playbackCompletes + (params.kind === 'playback_complete' ? 1 : 0),
    watchlistAdds: existing.watchlistAdds + (params.kind === 'watchlist_add' ? 1 : 0),
    mediaCounts,
    episodeCounts,
    genreCounts,
    updatedAtMs: Date.now(),
  };
  saveLocalAnalyticsDailyMap(map);

  if (params.isSignedIn) {
    void recordAnalyticsEventInFirestore(dayKey, {
      kind: params.kind,
      mediaId: cleanMedia,
      episodeKey,
      genres: params.genres,
    });
  }

  if (!shouldSkipBackendApiCalls()) {
    void fetch(resolveApiEndpoint('/api/analytics/event'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dayKey,
        kind: params.kind,
        mediaId: cleanMedia,
        episodeKey,
        genres: (params.genres || []).slice(0, 4),
      }),
    }).catch(() => undefined);
  }

  return true;
}

export type AnalyticsTimeframe = 'daily' | 'weekly' | 'monthly';

export interface AggregatedAnalyticsSummary {
  timeframe: AnalyticsTimeframe;
  playbackStarts: number;
  playbackCompletes: number;
  completionRatePct: number;
  watchlistAdds: number;
  topMedia: Array<{ mediaId: string; count: number }>;
  topEpisodes: Array<{ episodeKey: string; count: number }>;
  topGenres: Array<{ genre: string; count: number }>;
  daysCount: number;
}

export function aggregateAnalyticsRecords(
  records: AnalyticsDailyRecord[],
  timeframe: AnalyticsTimeframe
): AggregatedAnalyticsSummary {
  const daysBack = timeframe === 'daily' ? 1 : timeframe === 'weekly' ? 7 : 30;
  const cutoffMs = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  const todayKey = getDayKey();

  const inRange = records.filter((rec) => {
    if (timeframe === 'daily') return rec.id === todayKey;
    const ms = Date.parse(`${rec.id}T12:00:00Z`);
    return Number.isFinite(ms) ? ms >= cutoffMs : false;
  });

  let playbackStarts = 0;
  let playbackCompletes = 0;
  let watchlistAdds = 0;
  const mediaCounts: Record<string, number> = {};
  const episodeCounts: Record<string, number> = {};
  const genreCounts: Record<string, number> = {};

  for (const rec of inRange) {
    playbackStarts += rec.playbackStarts || 0;
    playbackCompletes += rec.playbackCompletes || 0;
    watchlistAdds += rec.watchlistAdds || 0;
    for (const [k, v] of Object.entries(rec.mediaCounts || {})) {
      mediaCounts[k] = (mediaCounts[k] || 0) + (Number(v) || 0);
    }
    for (const [k, v] of Object.entries(rec.episodeCounts || {})) {
      episodeCounts[k] = (episodeCounts[k] || 0) + (Number(v) || 0);
    }
    for (const [k, v] of Object.entries(rec.genreCounts || {})) {
      genreCounts[k] = (genreCounts[k] || 0) + (Number(v) || 0);
    }
  }

  const completionRatePct =
    playbackStarts > 0 ? Math.min(100, Math.round((playbackCompletes / playbackStarts) * 100)) : 0;

  return {
    timeframe,
    playbackStarts,
    playbackCompletes,
    completionRatePct,
    watchlistAdds,
    topMedia: Object.entries(mediaCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([mediaId, count]) => ({ mediaId, count })),
    topEpisodes: Object.entries(episodeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([episodeKey, count]) => ({ episodeKey, count })),
    topGenres: Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([genre, count]) => ({ genre, count })),
    daysCount: inRange.length,
  };
}

export async function loadMergedAnalyticsSummary(
  timeframe: AnalyticsTimeframe
): Promise<AggregatedAnalyticsSummary> {
  const localMap = loadLocalAnalyticsDailyMap();
  const merged = new Map<string, AnalyticsDailyRecord>(Object.entries(localMap));

  const mergeList = (list: AnalyticsDailyRecord[]) => {
    for (const rec of list) {
      const existing = merged.get(rec.id);
      if (!existing || (rec.playbackStarts || 0) >= (existing.playbackStarts || 0)) {
        merged.set(rec.id, rec);
      }
    }
  };

  const cloudList = await fetchAnalyticsDailyRange(30).catch(() => [] as AnalyticsDailyRecord[]);
  mergeList(cloudList);

  if (!shouldSkipBackendApiCalls()) {
    try {
      const res = await fetch(resolveApiEndpoint('/api/analytics/summary?days=30'));
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        const json = (await res.json()) as { ok?: boolean; days?: AnalyticsDailyRecord[] };
        if (json.ok && Array.isArray(json.days)) {
          mergeList(json.days);
        }
      }
    } catch {
      // Ignore backend offline fallback
    }
  }

  return aggregateAnalyticsRecords(Array.from(merged.values()), timeframe);
}
