import type {
  MediaItem,
  MediaKind,
  RecentlyWatchedPreferences,
  RecentlyWatchedRecord,
} from '../types/media';

function sanitizeMediaKey(mediaId: string): string {
  return (
    String(mediaId || '')
      .trim()
      .replace(/[^a-zA-Z0-9_\-]/g, '-')
      .slice(0, 128) || 'unknown-media'
  );
}

export const RECENTLY_WATCHED_STORAGE_KEY = 'rahaltv_recently_watched_v1';
export const RECENTLY_WATCHED_PREFS_KEY = 'rahaltv_recently_watched_prefs_v1';

export const DEFAULT_RECENTLY_WATCHED_PREFS: RecentlyWatchedPreferences = {
  maxItems: 24,
  hideCompleted: false,
};

let memoryMap: Record<string, RecentlyWatchedRecord> = {};
const lastCloudWriteByDocId = new Map<string, number>();

export type PlaybackRecordReason = 'start' | 'heartbeat' | 'episode_switch' | 'close';

export function buildRecentlyWatchedId(params: {
  userId: string;
  mediaId: string;
}): string {
  const cleanUid = String(params.userId || 'guest')
    .replace(/[^a-zA-Z0-9_\-]/g, '-')
    .slice(0, 100) || 'guest';
  const cleanMedia = sanitizeMediaKey(params.mediaId);
  return `${cleanUid}__${cleanMedia}`.slice(0, 260);
}

export function loadLocalRecentlyWatchedMap(): Record<string, RecentlyWatchedRecord> {
  if (typeof window === 'undefined') return { ...memoryMap };
  try {
    const raw = window.localStorage.getItem(RECENTLY_WATCHED_STORAGE_KEY);
    if (!raw) return { ...memoryMap };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      memoryMap = parsed as Record<string, RecentlyWatchedRecord>;
    }
    return { ...memoryMap };
  } catch {
    return { ...memoryMap };
  }
}

function persistLocalRecentlyWatchedMap(
  map: Record<string, RecentlyWatchedRecord>,
  maxCap = 60
): void {
  const entries = Object.entries(map);
  let nextMap = map;
  if (entries.length > maxCap) {
    entries.sort((a, b) => (b[1].lastWatchedAtMs || 0) - (a[1].lastWatchedAtMs || 0));
    nextMap = Object.fromEntries(entries.slice(0, maxCap));
  }
  memoryMap = nextMap;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(RECENTLY_WATCHED_STORAGE_KEY, JSON.stringify(nextMap));
    } catch {
      // Ignore quota errors
    }
  }
}

export function loadRecentlyWatchedPrefs(): RecentlyWatchedPreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_RECENTLY_WATCHED_PREFS };
  try {
    const raw = window.localStorage.getItem(RECENTLY_WATCHED_PREFS_KEY);
    if (!raw) return { ...DEFAULT_RECENTLY_WATCHED_PREFS };
    const parsed = JSON.parse(raw) as Partial<RecentlyWatchedPreferences>;
    const maxItems = Math.min(60, Math.max(6, Math.round(Number(parsed.maxItems) || 24)));
    return {
      maxItems,
      hideCompleted: Boolean(parsed.hideCompleted),
    };
  } catch {
    return { ...DEFAULT_RECENTLY_WATCHED_PREFS };
  }
}

export function saveRecentlyWatchedPrefs(
  patch: Partial<RecentlyWatchedPreferences>
): RecentlyWatchedPreferences {
  const current = loadRecentlyWatchedPrefs();
  const next: RecentlyWatchedPreferences = {
    maxItems: Math.min(60, Math.max(6, Math.round(Number(patch.maxItems ?? current.maxItems) || 24))),
    hideCompleted: patch.hideCompleted ?? current.hideCompleted,
  };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(RECENTLY_WATCHED_PREFS_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota errors
    }
  }
  return next;
}

export function buildRecentlyWatchedPayload(params: {
  userId: string;
  media: MediaItem;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  positionSec?: number;
  durationSec?: number;
  lastServerIndex?: number;
  lastServerUrl?: string;
  existingCreatedAtMs?: number;
}): RecentlyWatchedRecord {
  const pos = Math.max(0, Math.round(params.positionSec || 0));
  const dur = Math.max(0, Math.round(params.durationSec || 0));
  const progressPct =
    dur > 0 ? Math.min(100, Math.max(0, Math.round((pos / dur) * 100))) : pos > 0 ? 5 : 0;
  const completed = (dur > 0 && progressPct >= 92) || (dur > 60 && dur - pos <= 35);
  const now = Date.now();
  const cleanMediaId = sanitizeMediaKey(params.media.id);
  const id = buildRecentlyWatchedId({ userId: params.userId, mediaId: cleanMediaId });

  return {
    id,
    userId: params.userId,
    mediaId: cleanMediaId,
    slug: String(params.media.slug || cleanMediaId).slice(0, 128),
    title: String(params.media.title || 'عمل بدون عنوان').slice(0, 200),
    englishTitle: String(params.media.englishTitle || '').slice(0, 200),
    kind: (params.media.kind || 'movie') as MediaKind,
    year: String(params.media.year || '').slice(0, 10),
    quality: String(params.media.quality || '').slice(0, 40),
    poster: String(params.media.poster_url || params.media.poster || '').slice(0, 500),
    backdrop: String(params.media.backdrop_url || params.media.backdrop || '').slice(0, 500),
    ...(typeof params.seasonNumber === 'number' ? { seasonNumber: params.seasonNumber } : {}),
    ...(typeof params.episodeNumber === 'number' ? { episodeNumber: params.episodeNumber } : {}),
    ...(params.episodeTitle ? { episodeTitle: String(params.episodeTitle).slice(0, 120) } : {}),
    positionSec: pos,
    durationSec: dur,
    progressPct,
    completed,
    ...(typeof params.lastServerIndex === 'number'
      ? { lastServerIndex: Math.max(0, Math.round(params.lastServerIndex)) }
      : {}),
    ...(params.lastServerUrl ? { lastServerUrl: String(params.lastServerUrl).slice(0, 600) } : {}),
    lastWatchedAtMs: now,
    createdAtMs: params.existingCreatedAtMs || now,
  };
}

/**
 * Records playback into Recently Watched ONLY when genuine playback starts/progresses inside PlayerModal.
 * Throttles Firestore writes so continuous 1-second video ticks never flood Firestore.
 */
export async function recordRecentlyWatchedPlayback(params: {
  userId: string;
  isSignedIn: boolean;
  media: MediaItem;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  positionSec?: number;
  durationSec?: number;
  lastServerIndex?: number;
  lastServerUrl?: string;
  reason: PlaybackRecordReason;
  throttleMs?: number;
}): Promise<RecentlyWatchedRecord> {
  const map = loadLocalRecentlyWatchedMap();
  const docId = buildRecentlyWatchedId({ userId: params.userId, mediaId: params.media.id });
  const existing = map[docId];

  const record = buildRecentlyWatchedPayload({
    userId: params.userId,
    media: params.media,
    seasonNumber: params.seasonNumber,
    episodeNumber: params.episodeNumber,
    episodeTitle: params.episodeTitle,
    positionSec: params.positionSec,
    durationSec: params.durationSec,
    lastServerIndex: params.lastServerIndex,
    lastServerUrl: params.lastServerUrl,
    existingCreatedAtMs: existing?.createdAtMs,
  });

  map[docId] = record;
  persistLocalRecentlyWatchedMap(map);

  const now = Date.now();
  const throttle = params.throttleMs ?? 15000;
  const lastWrite = lastCloudWriteByDocId.get(docId) || 0;
  const shouldSyncCloud =
    params.isSignedIn &&
    params.userId !== 'guest' &&
    (params.reason === 'start' ||
      params.reason === 'episode_switch' ||
      params.reason === 'close' ||
      now - lastWrite >= throttle);

  if (shouldSyncCloud) {
    lastCloudWriteByDocId.set(docId, now);
    const { saveRecentlyWatchedToFirestore } = await import('./firebase');
    await saveRecentlyWatchedToFirestore(record, !existing);
  }

  return record;
}

export function listRecentlyWatchedItems(params: {
  userId: string;
  isSignedIn: boolean;
  cloudRecords?: RecentlyWatchedRecord[];
  maxItems?: number;
  hideCompleted?: boolean;
}): RecentlyWatchedRecord[] {
  const localMap = loadLocalRecentlyWatchedMap();
  const byMediaId = new Map<string, RecentlyWatchedRecord>();

  const ingest = (rec: RecentlyWatchedRecord) => {
    const key = sanitizeMediaKey(rec.mediaId);
    const prev = byMediaId.get(key);
    if (!prev || (rec.lastWatchedAtMs || 0) >= (prev.lastWatchedAtMs || 0)) {
      byMediaId.set(key, rec);
    }
  };

  for (const rec of Object.values(localMap)) {
    if (params.isSignedIn) {
      if (rec.userId === params.userId || rec.userId === 'guest') {
        ingest(rec);
      }
    } else if (rec.userId === 'guest') {
      ingest(rec);
    }
  }

  if (params.isSignedIn && Array.isArray(params.cloudRecords)) {
    for (const rec of params.cloudRecords) {
      if (rec.userId === params.userId) {
        ingest(rec);
      }
    }
  }

  let list = Array.from(byMediaId.values()).sort(
    (a, b) => (b.lastWatchedAtMs || 0) - (a.lastWatchedAtMs || 0)
  );

  if (params.hideCompleted) {
    list = list.filter((r) => !r.completed);
  }

  const cap = Math.min(60, Math.max(1, params.maxItems || 40));
  return list.slice(0, cap);
}

export async function removeRecentlyWatchedEntry(params: {
  mediaId: string;
  userId: string;
  isSignedIn: boolean;
}): Promise<void> {
  const cleanMedia = sanitizeMediaKey(params.mediaId);
  const map = loadLocalRecentlyWatchedMap();
  let changed = false;

  for (const [key, rec] of Object.entries(map)) {
    if (
      sanitizeMediaKey(rec.mediaId) === cleanMedia &&
      (rec.userId === params.userId || rec.userId === 'guest')
    ) {
      delete map[key];
      changed = true;
    }
  }

  if (changed) {
    persistLocalRecentlyWatchedMap(map);
  }

  if (params.isSignedIn && params.userId !== 'guest') {
    const docId = buildRecentlyWatchedId({ userId: params.userId, mediaId: cleanMedia });
    const { deleteRecentlyWatchedFromFirestore } = await import('./firebase');
    await deleteRecentlyWatchedFromFirestore(docId);
  }
}

export async function clearAllRecentlyWatchedEntries(params: {
  userId: string;
  isSignedIn: boolean;
}): Promise<void> {
  const map = loadLocalRecentlyWatchedMap();
  for (const [key, rec] of Object.entries(map)) {
    if (rec.userId === params.userId || rec.userId === 'guest') {
      delete map[key];
    }
  }
  persistLocalRecentlyWatchedMap(map);

  if (params.isSignedIn && params.userId !== 'guest') {
    const { clearRecentlyWatchedCollectionForUser } = await import('./firebase');
    await clearRecentlyWatchedCollectionForUser(params.userId);
  }
}

/**
 * Merges guest local recently-watched records into the signed-in account's Firestore collection.
 * Strictly removes guest local entries ONLY after cloud batch commit succeeds.
 */
export async function mergeGuestRecentlyWatchedToAccount(
  uid: string,
  cloudRecords: RecentlyWatchedRecord[] = []
): Promise<RecentlyWatchedRecord[]> {
  if (!uid || uid === 'guest') return [];
  const map = loadLocalRecentlyWatchedMap();
  const guestEntries = Object.entries(map).filter(([, rec]) => rec.userId === 'guest');
  if (guestEntries.length === 0) return [];

  const cloudByMedia = new Map<string, RecentlyWatchedRecord>();
  for (const rec of cloudRecords) {
    if (rec.userId === uid) {
      cloudByMedia.set(sanitizeMediaKey(rec.mediaId), rec);
    }
  }

  const recordsToWrite: RecentlyWatchedRecord[] = [];
  for (const [, guestRec] of guestEntries) {
    const cleanMedia = sanitizeMediaKey(guestRec.mediaId);
    const docId = buildRecentlyWatchedId({ userId: uid, mediaId: cleanMedia });
    const existingCloud = cloudByMedia.get(cleanMedia);
    const newerTimestamp = Math.max(
      guestRec.lastWatchedAtMs || 0,
      existingCloud?.lastWatchedAtMs || 0
    );
    const bestProgress =
      (guestRec.lastWatchedAtMs || 0) >= (existingCloud?.lastWatchedAtMs || 0)
        ? guestRec
        : existingCloud!;

    const mergedRecord: RecentlyWatchedRecord = {
      ...bestProgress,
      id: docId,
      userId: uid,
      mediaId: cleanMedia,
      lastWatchedAtMs: newerTimestamp,
      createdAtMs: existingCloud?.createdAtMs || guestRec.createdAtMs || Date.now(),
    };
    recordsToWrite.push(mergedRecord);
  }

  const { batchMergeRecentlyWatchedToFirestore } = await import('./firebase');
  const synced = await batchMergeRecentlyWatchedToFirestore(recordsToWrite);
  if (!synced) {
    return [];
  }

  // Only remove guest local records after confirmed Firestore write!
  const updatedMap = loadLocalRecentlyWatchedMap();
  for (const [key, rec] of Object.entries(updatedMap)) {
    if (rec.userId === 'guest') {
      delete updatedMap[key];
    }
  }
  for (const written of recordsToWrite) {
    updatedMap[written.id] = written;
  }
  persistLocalRecentlyWatchedMap(updatedMap);
  return recordsToWrite;
}

export function formatRelativeArabicTime(timestampMs: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - (timestampMs || Date.now())) / 1000));
  if (diffSec < 60) return 'منذ لحظات';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `منذ ${mins} د`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} س`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'أمس';
  if (days < 7) return `منذ ${days} أيام`;
  try {
    return new Date(timestampMs).toLocaleDateString('ar-EG', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'مؤخراً';
  }
}
