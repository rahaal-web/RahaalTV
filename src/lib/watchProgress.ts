import {
  deleteWatchProgressFromFirestore,
  sanitizeRatingMediaId,
  saveWatchProgressToFirestore,
} from './firebase';
import type { MediaItem, MediaKind, WatchProgressRecord } from '../types/media';

const WATCH_PROGRESS_STORAGE_KEY = 'rahaltv_watch_progress_v1';
let memoryProgressStore: Record<string, WatchProgressRecord> = {};
const lastFlushTimestamps = new Map<string, number>();

export function buildWatchProgressId(params: {
  userId: string;
  profileId: string;
  mediaId: string;
  seasonNumber?: number;
  episodeNumber?: number;
}): string {
  const cleanUid = String(params.userId || 'guest').replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 100);
  const cleanProf = String(params.profileId || 'main').replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 60);
  const cleanMedia = sanitizeRatingMediaId(params.mediaId);
  if (typeof params.seasonNumber === 'number' && typeof params.episodeNumber === 'number') {
    return `${cleanUid}__${cleanProf}__${cleanMedia}__s${params.seasonNumber}e${params.episodeNumber}`.slice(0, 380);
  }
  return `${cleanUid}__${cleanProf}__${cleanMedia}`.slice(0, 380);
}

export function loadLocalWatchProgressMap(): Record<string, WatchProgressRecord> {
  if (typeof window === 'undefined') return { ...memoryProgressStore };
  try {
    const raw = window.localStorage.getItem(WATCH_PROGRESS_STORAGE_KEY);
    if (!raw) return { ...memoryProgressStore };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      memoryProgressStore = parsed as Record<string, WatchProgressRecord>;
    }
    return { ...memoryProgressStore };
  } catch {
    return { ...memoryProgressStore };
  }
}

function persistLocalWatchProgressMap(map: Record<string, WatchProgressRecord>): void {
  const entries = Object.entries(map);
  let nextMap = map;
  if (entries.length > 180) {
    entries.sort((a, b) => (b[1].updatedAtMs || 0) - (a[1].updatedAtMs || 0));
    nextMap = Object.fromEntries(entries.slice(0, 180));
  }
  memoryProgressStore = nextMap;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(WATCH_PROGRESS_STORAGE_KEY, JSON.stringify(nextMap));
    } catch {
      // Ignore quota errors
    }
  }
}

export function listWatchProgressForProfile(
  profileId: string,
  cloudRecords: WatchProgressRecord[] = [],
  userId = 'guest'
): WatchProgressRecord[] {
  const localMap = loadLocalWatchProgressMap();
  const merged = new Map<string, WatchProgressRecord>();

  for (const rec of Object.values(localMap)) {
    if (rec.profileId === profileId && (rec.userId === userId || rec.userId === 'guest')) {
      merged.set(rec.id, rec);
    }
  }
  for (const rec of cloudRecords) {
    if (rec.profileId === profileId && rec.userId === userId) {
      const existing = merged.get(rec.id);
      if (!existing || (rec.updatedAtMs || 0) >= (existing.updatedAtMs || 0)) {
        merged.set(rec.id, rec);
      }
    }
  }
  return Array.from(merged.values()).sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
}

export function computeWatchProgressPayload(params: {
  userId: string;
  profileId: string;
  media: MediaItem;
  seasonNumber?: number;
  episodeNumber?: number;
  positionSec: number;
  durationSec: number;
  lastServerUrl?: string;
}): WatchProgressRecord {
  const pos = Math.max(0, Math.round(params.positionSec || 0));
  const dur = Math.max(0, Math.round(params.durationSec || 0));
  const pct = dur > 0 ? Math.min(100, Math.max(0, Math.round((pos / dur) * 100))) : pos > 0 ? 5 : 0;
  const completed = (dur > 0 && pct >= 92) || (dur > 60 && dur - pos <= 35);
  const id = buildWatchProgressId({
    userId: params.userId,
    profileId: params.profileId,
    mediaId: params.media.id,
    seasonNumber: params.seasonNumber,
    episodeNumber: params.episodeNumber,
  });

  return {
    id,
    userId: params.userId,
    profileId: params.profileId,
    mediaId: sanitizeRatingMediaId(params.media.id),
    mediaTitle: params.media.title,
    kind: params.media.kind as MediaKind,
    ...(typeof params.seasonNumber === 'number' ? { seasonNumber: params.seasonNumber } : {}),
    ...(typeof params.episodeNumber === 'number' ? { episodeNumber: params.episodeNumber } : {}),
    positionSec: pos,
    durationSec: dur,
    progressPct: pct,
    completed,
    hiddenFromContinueWatching: false,
    ...(params.lastServerUrl ? { lastServerUrl: params.lastServerUrl } : {}),
    updatedAtMs: Date.now(),
  };
}

export async function saveWatchProgressEntry(
  record: WatchProgressRecord,
  options: { immediate?: boolean; throttleMs?: number; isSignedIn?: boolean } = {}
): Promise<WatchProgressRecord> {
  const map = loadLocalWatchProgressMap();
  map[record.id] = record;
  persistLocalWatchProgressMap(map);

  const now = Date.now();
  const throttle = options.throttleMs ?? 7000;
  const prevFlush = lastFlushTimestamps.get(record.id) || 0;
  if (options.isSignedIn && record.userId !== 'guest' && (options.immediate || now - prevFlush >= throttle)) {
    lastFlushTimestamps.set(record.id, now);
    await saveWatchProgressToFirestore(record);
  }
  return record;
}

export async function removeFromContinueWatching(
  progressId: string,
  isSignedIn: boolean
): Promise<void> {
  const map = loadLocalWatchProgressMap();
  const existing = map[progressId];
  if (existing) {
    map[progressId] = {
      ...existing,
      hiddenFromContinueWatching: true,
      updatedAtMs: Date.now(),
    };
    persistLocalWatchProgressMap(map);
    if (isSignedIn && existing.userId !== 'guest') {
      await saveWatchProgressToFirestore(map[progressId]).catch(() =>
        deleteWatchProgressFromFirestore(progressId)
      );
    }
  } else if (isSignedIn) {
    await deleteWatchProgressFromFirestore(progressId);
  }
}

export async function mergeGuestWatchProgressToAccount(
  uid: string,
  profileId: string
): Promise<WatchProgressRecord[]> {
  const map = loadLocalWatchProgressMap();
  const migrated: WatchProgressRecord[] = [];
  for (const [key, rec] of Object.entries(map)) {
    if (rec.userId !== 'guest') continue;
    const newId = buildWatchProgressId({
      userId: uid,
      profileId: rec.profileId || profileId,
      mediaId: rec.mediaId,
      seasonNumber: rec.seasonNumber,
      episodeNumber: rec.episodeNumber,
    });
    const nextRec: WatchProgressRecord = {
      ...rec,
      id: newId,
      userId: uid,
      profileId: rec.profileId || profileId,
    };
    delete map[key];
    map[newId] = nextRec;
    migrated.push(nextRec);
  }
  if (migrated.length > 0) {
    persistLocalWatchProgressMap(map);
    await Promise.all(migrated.slice(0, 20).map((r) => saveWatchProgressToFirestore(r)));
  }
  return migrated;
}

export function findLatestProgressForMedia(
  mediaId: string,
  records: WatchProgressRecord[]
): WatchProgressRecord | null {
  const clean = sanitizeRatingMediaId(mediaId);
  const matching = records
    .filter((r) => sanitizeRatingMediaId(r.mediaId) === clean)
    .sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
  return matching[0] || null;
}

export function findProgressForEpisode(
  mediaId: string,
  seasonNumber: number | undefined,
  episodeNumber: number | undefined,
  records: WatchProgressRecord[]
): WatchProgressRecord | null {
  const clean = sanitizeRatingMediaId(mediaId);
  return (
    records.find(
      (r) =>
        sanitizeRatingMediaId(r.mediaId) === clean &&
        (seasonNumber === undefined || r.seasonNumber === seasonNumber) &&
        (episodeNumber === undefined || r.episodeNumber === episodeNumber)
    ) || null
  );
}

export interface ContinueWatchingEntry {
  media: MediaItem;
  progress: WatchProgressRecord;
}

export function buildContinueWatchingEntries(
  catalog: MediaItem[],
  records: WatchProgressRecord[],
  limit = 16
): ContinueWatchingEntry[] {
  const byId = new Map(catalog.map((m) => [sanitizeRatingMediaId(m.id), m]));
  const latestPerMedia = new Map<string, WatchProgressRecord>();

  for (const rec of records) {
    if (rec.hiddenFromContinueWatching) continue;
    const key = sanitizeRatingMediaId(rec.mediaId);
    const existing = latestPerMedia.get(key);
    if (!existing || (rec.updatedAtMs || 0) > (existing.updatedAtMs || 0)) {
      latestPerMedia.set(key, rec);
    }
  }

  const out: ContinueWatchingEntry[] = [];
  for (const rec of latestPerMedia.values()) {
    // Only show incomplete works or recently paused works (>= 2% progress)
    if (rec.completed) continue;
    const media = byId.get(sanitizeRatingMediaId(rec.mediaId));
    if (!media) continue;
    out.push({ media, progress: rec });
  }

  return out
    .sort((a, b) => (b.progress.updatedAtMs || 0) - (a.progress.updatedAtMs || 0))
    .slice(0, limit);
}

export function formatPlaybackSeconds(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }
  return `${mins}:${String(rem).padStart(2, '0')}`;
}
