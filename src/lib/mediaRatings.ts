import { resolveApiEndpoint, shouldSkipBackendApiCalls } from './clientScraper';
import {
  cleanExternalSearchTitle,
  extractCleanEnglishTitleCandidate,
  inferEffectiveYear,
  scoreExternalTitleMatch,
} from './imageMatching';

export interface RatingLookupInput {
  id?: string;
  title: string;
  englishTitle?: string;
  year?: string;
  kind?: string;
  imdbId?: string;
}

export interface ResolvedMediaRating {
  id?: string;
  imdb: number;
  imdbId?: string;
  votes?: string;
  matchedTitle?: string;
  year?: string;
  source: 'imdb' | 'tmdb' | 'tvmaze';
}

function buildRatingSearchQueries(title: string, englishTitle = ''): string[] {
  const cleanedFromTitleEng = extractCleanEnglishTitleCandidate(title);
  const cleanedFromTitle = cleanExternalSearchTitle(title, '');
  const cleanedFromEnglish = cleanExternalSearchTitle('', englishTitle);

  const rawList: string[] = [];
  if (
    cleanedFromTitleEng &&
    cleanedFromEnglish &&
    cleanedFromTitleEng.length > cleanedFromEnglish.length + 2 &&
    cleanedFromTitleEng.toLowerCase().startsWith(cleanedFromEnglish.toLowerCase())
  ) {
    rawList.push(cleanedFromTitleEng, cleanedFromEnglish, cleanedFromTitle);
  } else {
    rawList.push(cleanedFromEnglish, cleanedFromTitleEng, cleanedFromTitle);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of rawList) {
    const clean = q.trim();
    const key = clean.toLowerCase();
    if (clean.length >= 2 && !seen.has(key)) {
      seen.add(key);
      out.push(clean);
    }
  }
  return out;
}

function normalizeRatingNumber(raw: unknown): number | null {
  const num = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
  if (!Number.isFinite(num) || num <= 0 || num > 10) return null;
  return Math.round(num * 10) / 10;
}

async function fetchCinemetaRatingByImdbId(
  ttId: string,
  kind: string
): Promise<{ rating: number; name?: string; year?: string } | null> {
  const typesToTry =
    kind === 'series'
      ? ['series', 'movie']
      : kind === 'tv' || kind === 'wrestling'
        ? ['movie', 'series']
        : ['movie'];

  for (const cmType of typesToTry) {
    try {
      const res = await fetch(
        `https://v3-cinemeta.strem.io/meta/${cmType}/${encodeURIComponent(ttId)}.json`,
        { signal: AbortSignal.timeout(5500) }
      );
      if (!res.ok) continue;
      const json = (await res.json()) as {
        meta?: { imdbRating?: string | number; name?: string; year?: string | number; releaseInfo?: string };
      };
      const rating = normalizeRatingNumber(json.meta?.imdbRating);
      if (rating !== null) {
        return {
          rating,
          name: json.meta?.name,
          year: String(json.meta?.year || json.meta?.releaseInfo || '').slice(0, 4) || undefined,
        };
      }
    } catch {
      // ignore Cinemeta lookup error
    }
  }
  return null;
}

export async function resolveMediaRatingInBrowser(
  input: RatingLookupInput
): Promise<ResolvedMediaRating | null> {
  const title = String(input.title || '').trim();
  const englishTitle = String(input.englishTitle || '').trim();
  const kind = String(input.kind || 'movie');
  const imdbId = String(input.imdbId || '').trim();
  const { year: effectiveYear, explicit: yearExplicit } = inferEffectiveYear(title, input.year);
  const queries = buildRatingSearchQueries(title, englishTitle);

  if (imdbId && /^tt\d{6,10}$/i.test(imdbId)) {
    const direct = await fetchCinemetaRatingByImdbId(imdbId, kind);
    if (direct) {
      return {
        id: input.id,
        imdb: direct.rating,
        imdbId,
        matchedTitle: direct.name,
        year: direct.year,
        source: 'imdb',
      };
    }
  }

  if (queries.length === 0) return null;

  // 1. Cinemeta catalog search (movie/series)
  const cmTypes =
    kind === 'series' ? ['series'] : kind === 'tv' || kind === 'wrestling' ? ['series', 'movie'] : ['movie'];
  for (const cmType of cmTypes) {
    for (const q of queries.slice(0, 2)) {
      try {
        const res = await fetch(
          `https://v3-cinemeta.strem.io/catalog/${cmType}/top/search=${encodeURIComponent(q)}.json`,
          { signal: AbortSignal.timeout(5500) }
        );
        if (!res.ok) continue;
        const json = (await res.json()) as {
          metas?: Array<{ id?: string; name?: string; releaseInfo?: string; year?: string | number }>;
        };
        let bestId = '';
        let bestScore = 0;
        let bestName = '';
        let bestYear = '';
        for (const m of (json.metas || []).slice(0, 10)) {
          if (!m?.id || !/^tt\d+$/i.test(m.id) || !m.name) continue;
          const candYear = String(m.year || m.releaseInfo || '').slice(0, 4);
          const check = scoreExternalTitleMatch({
            queryTitle: title,
            englishTitle,
            expectedYear: effectiveYear,
            expectedYearExplicit: yearExplicit,
            candidateTitles: [m.name],
            candidateYear: candYear,
          });
          if (check.matched && check.score > bestScore) {
            bestScore = check.score;
            bestId = m.id;
            bestName = m.name;
            bestYear = candYear;
          }
        }
        if (bestId) {
          const meta = await fetchCinemetaRatingByImdbId(bestId, cmType);
          if (meta) {
            return {
              id: input.id,
              imdb: meta.rating,
              imdbId: bestId,
              matchedTitle: meta.name || bestName,
              year: meta.year || bestYear || undefined,
              source: 'imdb',
            };
          }
        }
      } catch {
        // ignore Cinemeta search error
      }
    }
  }

  // 2. IMDb Suggestion API to discover ttId -> Cinemeta meta rating
  for (const q of queries.slice(0, 2)) {
    const firstChar = q.charAt(0).toLowerCase();
    const prefix = /[a-z0-9]/.test(firstChar) ? firstChar : 'a';
    try {
      const res = await fetch(
        `https://v3.sg.media-imdb.com/suggestion/${prefix}/${encodeURIComponent(q.toLowerCase())}.json`,
        { signal: AbortSignal.timeout(5500) }
      );
      if (!res.ok) continue;
      const json = (await res.json()) as {
        d?: Array<{ id?: string; l?: string; qid?: string; y?: number }>;
      };
      let bestId = '';
      let bestScore = 0;
      for (const item of (json.d || []).slice(0, 10)) {
        if (!item?.id || !/^tt\d+$/i.test(item.id) || !item.l) continue;
        const qid = (item.qid || '').toLowerCase();
        if (kind === 'movie' && qid && !['movie', 'feature', 'tvmovie', 'short', 'video'].includes(qid)) {
          continue;
        }
        if (kind === 'series' && qid && !['tvseries', 'tvminiseries'].includes(qid)) {
          continue;
        }
        const check = scoreExternalTitleMatch({
          queryTitle: title,
          englishTitle,
          expectedYear: effectiveYear,
          expectedYearExplicit: yearExplicit,
          candidateTitles: [item.l],
          candidateYear: item.y ? String(item.y) : undefined,
        });
        if (check.matched && check.score > bestScore) {
          bestScore = check.score;
          bestId = item.id;
        }
      }
      if (bestId) {
        const meta = await fetchCinemetaRatingByImdbId(bestId, kind);
        if (meta) {
          return {
            id: input.id,
            imdb: meta.rating,
            imdbId: bestId,
            matchedTitle: meta.name,
            year: meta.year,
            source: 'imdb',
          };
        }
      }
    } catch {
      // ignore IMDb suggestion error
    }
  }

  // 3. TVmaze fallback for series/tv
  if (kind === 'series' || kind === 'tv') {
    for (const q of queries.slice(0, 2)) {
      try {
        const res = await fetch(
          `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (!res.ok) continue;
        const list = (await res.json()) as Array<{
          show?: {
            name?: string;
            premiered?: string;
            rating?: { average?: number | null };
            externals?: { imdb?: string | null };
          };
        }>;
        for (const entry of list.slice(0, 6)) {
          const show = entry?.show;
          if (!show?.name) continue;
          const check = scoreExternalTitleMatch({
            queryTitle: title,
            englishTitle,
            expectedYear: effectiveYear,
            expectedYearExplicit: yearExplicit,
            candidateTitles: [show.name],
            candidateYear: show.premiered?.slice(0, 4),
          });
          if (!check.matched) continue;
          const extImdb = show.externals?.imdb || '';
          if (extImdb && /^tt\d+$/i.test(extImdb)) {
            const meta = await fetchCinemetaRatingByImdbId(extImdb, 'series');
            if (meta) {
              return {
                id: input.id,
                imdb: meta.rating,
                imdbId: extImdb,
                matchedTitle: meta.name || show.name,
                year: meta.year || show.premiered?.slice(0, 4),
                source: 'imdb',
              };
            }
          }
          const tvRating = normalizeRatingNumber(show.rating?.average);
          if (tvRating !== null) {
            return {
              id: input.id,
              imdb: tvRating,
              imdbId: extImdb || undefined,
              matchedTitle: show.name,
              year: show.premiered?.slice(0, 4),
              source: 'tvmaze',
            };
          }
        }
      } catch {
        // ignore TVmaze error
      }
    }
  }

  return null;
}

export async function resolveSingleMediaRating(
  input: RatingLookupInput
): Promise<ResolvedMediaRating | null> {
  if (!shouldSkipBackendApiCalls()) {
    try {
      const response = await fetch(resolveApiEndpoint('/api/ratings/resolve'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const contentType = response.headers.get('content-type') || '';
      if (response.ok && contentType.includes('application/json')) {
        const data = (await response.json()) as {
          ok?: boolean;
          result?: ResolvedMediaRating | null;
        };
        if (data.ok) {
          return data.result || null;
        }
      }
    } catch {
      // Fall back to direct browser lookup if backend unavailable
    }
  }
  return resolveMediaRatingInBrowser(input);
}

export async function resolveMediaRatingsBatch(
  items: RatingLookupInput[],
  onProgress?: (done: number, total: number) => void
): Promise<Record<string, ResolvedMediaRating>> {
  const results: Record<string, ResolvedMediaRating> = {};
  const total = items.length;
  if (total === 0) return results;

  const CHUNK_SIZE = 20;
  let processed = 0;

  for (let i = 0; i < total; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    let handledByBackend = false;

    if (!shouldSkipBackendApiCalls()) {
      try {
        const response = await fetch(resolveApiEndpoint('/api/ratings/resolve'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: chunk }),
        });
        const contentType = response.headers.get('content-type') || '';
        if (response.ok && contentType.includes('application/json')) {
          const data = (await response.json()) as {
            ok?: boolean;
            results?: Record<string, ResolvedMediaRating | null>;
          };
          if (data.ok && data.results) {
            for (const [id, entry] of Object.entries(data.results)) {
              if (entry && entry.imdb > 0) {
                results[id] = entry;
              }
            }
            handledByBackend = true;
          }
        }
      } catch {
        // Fall through to browser resolution
      }
    }

    if (!handledByBackend) {
      const CONCURRENCY = 4;
      for (let j = 0; j < chunk.length; j += CONCURRENCY) {
        const sub = chunk.slice(j, j + CONCURRENCY);
        const resolvedSub = await Promise.all(
          sub.map(async (it) => ({
            id: String(it.id || ''),
            res: await resolveMediaRatingInBrowser(it),
          }))
        );
        for (const entry of resolvedSub) {
          if (entry.id && entry.res && entry.res.imdb > 0) {
            results[entry.id] = entry.res;
          }
        }
      }
    }

    processed = Math.min(total, i + chunk.length);
    onProgress?.(processed, total);
  }

  return results;
}
