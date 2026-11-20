import { sanitizeRatingMediaId } from './firebase';
import { normalizeArabicText } from './categoryMatcher';
import type { MediaItem, MediaReviewRecord, WatchProgressRecord } from '../types/media';

export interface AffinityProfile {
  genreWeights: Map<string, number>;
  personWeights: Map<string, number>;
  categoryWeights: Map<string, number>;
  watchedIds: Set<string>;
  watchlistSet: Set<string>;
  lastWatchedMedia: MediaItem | null;
}

export function buildUserAffinityProfile(params: {
  catalog: MediaItem[];
  watchProgress: WatchProgressRecord[];
  watchlistIds: string[];
  reviews?: MediaReviewRecord[];
  userId?: string | null;
}): AffinityProfile {
  const genreWeights = new Map<string, number>();
  const personWeights = new Map<string, number>();
  const categoryWeights = new Map<string, number>();
  const watchedIds = new Set<string>();
  const watchlistSet = new Set(params.watchlistIds.map((id) => sanitizeRatingMediaId(id)));
  const byId = new Map(params.catalog.map((m) => [sanitizeRatingMediaId(m.id), m]));

  const addWeight = (map: Map<string, number>, rawKey: string | undefined, weight: number) => {
    const key = normalizeArabicText(rawKey || '');
    if (!key || key.length < 2) return;
    map.set(key, (map.get(key) || 0) + weight);
  };

  let lastWatchedMedia: MediaItem | null = null;
  const sortedProgress = [...params.watchProgress].sort(
    (a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0)
  );

  for (const rec of sortedProgress) {
    const cleanId = sanitizeRatingMediaId(rec.mediaId);
    watchedIds.add(cleanId);
    const media = byId.get(cleanId);
    if (!media) continue;
    if (!lastWatchedMedia) lastWatchedMedia = media;
    const w = rec.completed ? 3.0 : rec.progressPct >= 30 ? 2.2 : 1.2;
    (media.genres || []).forEach((g) => addWeight(genreWeights, g, w));
    (media.categories || []).forEach((c) => addWeight(categoryWeights, c, w * 0.6));
    if (media.director) addWeight(personWeights, media.director, w * 1.4);
    (media.cast || []).slice(0, 6).forEach((c) => addWeight(personWeights, c.name, w));
  }

  for (const id of watchlistSet) {
    const media = byId.get(id);
    if (!media) continue;
    (media.genres || []).forEach((g) => addWeight(genreWeights, g, 2.0));
    (media.categories || []).forEach((c) => addWeight(categoryWeights, c, 1.0));
    if (media.director) addWeight(personWeights, media.director, 1.2);
    (media.cast || []).slice(0, 4).forEach((c) => addWeight(personWeights, c.name, 0.9));
  }

  if (params.userId && params.reviews) {
    for (const rev of params.reviews) {
      if (rev.userId !== params.userId || rev.rating10 < 7) continue;
      const media = byId.get(sanitizeRatingMediaId(rev.mediaId));
      if (!media) continue;
      const bonus = (rev.rating10 - 6) * 0.8;
      (media.genres || []).forEach((g) => addWeight(genreWeights, g, bonus));
      if (media.director) addWeight(personWeights, media.director, bonus);
    }
  }

  return {
    genreWeights,
    personWeights,
    categoryWeights,
    watchedIds,
    watchlistSet,
    lastWatchedMedia,
  };
}

export function computeMediaSimilarityScore(source: MediaItem, candidate: MediaItem): number {
  if (source.id === candidate.id) return -1;
  let score = 0;

  if (source.kind === candidate.kind) score += 2.5;
  const srcGenres = new Set((source.genres || []).map((g) => normalizeArabicText(g)));
  for (const g of candidate.genres || []) {
    if (srcGenres.has(normalizeArabicText(g))) score += 4.0;
  }

  const srcCats = new Set((source.categories || []).map((c) => normalizeArabicText(c)));
  for (const c of candidate.categories || []) {
    if (srcCats.has(normalizeArabicText(c))) score += 2.0;
  }

  if (source.director && candidate.director && normalizeArabicText(source.director) === normalizeArabicText(candidate.director)) {
    score += 5.0;
  }

  const srcCast = new Set((source.cast || []).map((c) => normalizeArabicText(c.name)));
  for (const c of candidate.cast || []) {
    if (srcCast.has(normalizeArabicText(c.name))) score += 3.0;
  }

  const yearA = parseInt(source.year, 10);
  const yearB = parseInt(candidate.year, 10);
  if (Number.isFinite(yearA) && Number.isFinite(yearB)) {
    const diff = Math.abs(yearA - yearB);
    if (diff <= 2) score += 1.5;
    else if (diff <= 5) score += 0.7;
  }

  if (candidate.imdb >= 7.5) score += 0.8;
  return score;
}

export function computeSimilarMedia(
  source: MediaItem,
  catalog: MediaItem[],
  limit = 10
): MediaItem[] {
  return catalog
    .filter((c) => c.id !== source.id)
    .map((candidate) => ({
      candidate,
      score: computeMediaSimilarityScore(source, candidate),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.candidate.imdb || 0) - (a.candidate.imdb || 0))
    .slice(0, limit)
    .map((x) => x.candidate);
}

export interface PersonalizedShelf {
  id: string;
  title: string;
  subtitle: string;
  items: MediaItem[];
}

export function buildPersonalizedShelves(params: {
  catalog: MediaItem[];
  watchProgress: WatchProgressRecord[];
  watchlistIds: string[];
  reviews?: MediaReviewRecord[];
  userId?: string | null;
}): PersonalizedShelf[] {
  const { catalog } = params;
  if (catalog.length === 0) return [];

  const profile = buildUserAffinityProfile(params);
  const shelves: PersonalizedShelf[] = [];

  // 1. "لأنك شاهدت [عنوان]"
  if (profile.lastWatchedMedia) {
    const similar = computeSimilarMedia(profile.lastWatchedMedia, catalog, 10).filter(
      (m) => !profile.watchedIds.has(sanitizeRatingMediaId(m.id))
    );
    if (similar.length >= 2) {
      shelves.push({
        id: 'shelf-because-watched',
        title: `لأنك شاهدت ${profile.lastWatchedMedia.title}`,
        subtitle: 'أعمال قريبة من نفس التصنيف والأسلوب السينمائي',
        items: similar,
      });
    }
  }

  // 2. "قد يعجبك أيضاً" — scored by user affinity
  if (profile.genreWeights.size > 0 || profile.personWeights.size > 0) {
    const scored = catalog
      .filter((m) => !profile.watchedIds.has(sanitizeRatingMediaId(m.id)))
      .map((m) => {
        let score = 0;
        (m.genres || []).forEach((g) => {
          score += (profile.genreWeights.get(normalizeArabicText(g)) || 0) * 2.5;
        });
        (m.categories || []).forEach((c) => {
          score += profile.categoryWeights.get(normalizeArabicText(c)) || 0;
        });
        if (m.director) {
          score += (profile.personWeights.get(normalizeArabicText(m.director)) || 0) * 1.5;
        }
        (m.cast || []).forEach((c) => {
          score += profile.personWeights.get(normalizeArabicText(c.name)) || 0;
        });
        if (m.imdb >= 7.2) score += 0.6;
        return { m, score };
      })
      .filter((x) => x.score > 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((x) => x.m);

    if (scored.length >= 2) {
      shelves.push({
        id: 'shelf-may-like',
        title: 'قد يعجبك أيضاً',
        subtitle: 'ترشيحات ذكية مبنية على مشاهداتك وقائمتك وتقييماتك',
        items: scored,
      });
    }
  }

  // 3. "ترشيحات هذا الأسبوع" — top community + IMDb + fresh works
  const weeklyPicks = [...catalog]
    .filter((m) => !m.comingSoon)
    .sort((a, b) => {
      const aScore = (a.reviewSummary?.average10 || a.imdb || 0) * 1.2 + (a.isNew ? 2 : 0) + (a.pinned ? 1.5 : 0);
      const bScore = (b.reviewSummary?.average10 || b.imdb || 0) * 1.2 + (b.isNew ? 2 : 0) + (b.pinned ? 1.5 : 0);
      return bScore - aScore;
    })
    .slice(0, 10);

  if (weeklyPicks.length >= 3) {
    shelves.push({
      id: 'shelf-weekly-picks',
      title: 'ترشيحات هذا الأسبوع',
      subtitle: 'أفضل الأعمال تقييماً والأكثر تميزاً في مكتبة Rahal TV',
      items: weeklyPicks,
    });
  }

  return shelves;
}
