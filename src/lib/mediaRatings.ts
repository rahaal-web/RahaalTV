import {
  fetchViaBrowserOrCorsRelay,
  resolveApiEndpoint,
  shouldSkipBackendApiCalls,
} from './clientScraper';
import {
  buildExternalSearchQueries,
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

const WIKIDATA_FILM_QIDS = new Set([
  'Q11424', // film
  'Q24869', // feature film
  'Q202866', // animated film
  'Q226730', // silent film
  'Q506240', // television film
  'Q24856', // film series
]);

const WIKIDATA_SERIES_QIDS = new Set([
  'Q5398426', // television series
  'Q1259759', // miniseries
  'Q1107', // anime
  'Q63952888', // anime television series
  'Q581714', // animated series
  'Q15416', // television program
]);

const RATING_RESULT_CACHE = new Map<string, ResolvedMediaRating | null>();
const WIKIDATA_BRIDGE_CACHE = new Map<string, { imdbId: string; englishTitle: string; year: string } | null>();

let wikimediaQueue: Promise<unknown> = Promise.resolve();
let lastWikimediaAt = 0;

function enqueueWikimediaCall<T>(task: () => Promise<T>): Promise<T> {
  const run = wikimediaQueue.then(async () => {
    const waitMs = Math.max(0, 420 - (Date.now() - lastWikimediaAt));
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastWikimediaAt = Date.now();
    return task();
  });
  wikimediaQueue = run.catch(() => undefined);
  return run;
}

async function fetchWikimediaJson<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await enqueueWikimediaCall(() =>
        fetch(url, {
          headers: { 'Api-User-Agent': 'RahaLTV/1.0 (https://rahaaltv.app)' },
          signal: AbortSignal.timeout(7000),
        })
      );
      const text = await res.text();
      if (
        res.status === 429 ||
        /too many requests/i.test(text) ||
        (!res.ok && res.status >= 500)
      ) {
        if (attempt < 2) {
          const retryAfterSec = Number(res.headers.get('retry-after') || '');
          const delayMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
            ? Math.min(8000, retryAfterSec * 1000)
            : 1600 * (attempt + 1);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        return null;
      }
      if (!res.ok || !text.trim().startsWith('{')) return null;
      return JSON.parse(text) as T;
    } catch {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      return null;
    }
  }
  return null;
}

function normalizeRatingNumber(raw: unknown): number | null {
  const num = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
  if (!Number.isFinite(num) || num <= 0 || num > 10) return null;
  return Math.round(num * 10) / 10;
}

async function fetchTvmazeRatingByImdbId(
  ttId: string
): Promise<{ rating: number; name?: string; year?: string } | null> {
  try {
    const res = await fetch(
      `https://api.tvmaze.com/lookup/shows?imdb=${encodeURIComponent(ttId)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const show = (await res.json()) as {
      name?: string;
      premiered?: string;
      rating?: { average?: number | null };
    };
    const rating = normalizeRatingNumber(show?.rating?.average);
    if (rating === null) return null;
    return {
      rating,
      name: show.name,
      year: show.premiered?.slice(0, 4) || undefined,
    };
  } catch {
    return null;
  }
}

async function fetchCinemetaRatingByImdbId(
  ttId: string,
  kind: string
): Promise<{ rating: number; name?: string; year?: string; source: 'imdb' | 'tvmaze' } | null> {
  const typesToTry =
    kind === 'series' || kind === 'tv' || kind === 'wrestling'
      ? ['series', 'movie']
      : ['movie', 'series'];

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
          source: 'imdb',
        };
      }
    } catch {
      // ignore Cinemeta lookup error
    }
  }

  if (kind === 'series' || kind === 'tv' || kind === 'wrestling') {
    const tv = await fetchTvmazeRatingByImdbId(ttId);
    if (tv) {
      return { ...tv, source: 'tvmaze' };
    }
  }

  return null;
}

async function searchCinemetaForRating(params: {
  queries: string[];
  title: string;
  englishTitle: string;
  effectiveYear: string;
  yearExplicit: boolean;
  kind: string;
  inputId?: string;
}): Promise<ResolvedMediaRating | null> {
  const { queries, title, englishTitle, effectiveYear, yearExplicit, kind, inputId } = params;
  const cmTypes =
    kind === 'series' || kind === 'tv' || kind === 'wrestling'
      ? ['series', 'movie']
      : ['movie', 'series'];

  for (const cmType of cmTypes) {
    for (const q of queries.slice(0, 3)) {
      if (!/[A-Za-z]/.test(q) && /[\u0600-\u06FF]/.test(q)) {
        // Cinemeta only indexes Latin/English titles; skip pure Arabic terms to save requests
        continue;
      }
      try {
        const res = await fetch(
          `https://v3-cinemeta.strem.io/catalog/${cmType}/top/search=${encodeURIComponent(q)}.json`,
          { signal: AbortSignal.timeout(5500) }
        );
        if (!res.ok) continue;
        const json = (await res.json()) as {
          metas?: Array<{ id?: string; name?: string; releaseInfo?: string; year?: string | number }>;
        };

        const matches: Array<{ id: string; score: number; name: string; year: string }> = [];
        for (const m of (json.metas || []).slice(0, 12)) {
          if (!m?.id || !/^tt\d+$/i.test(m.id) || !m.name) continue;
          const candYear = String(m.year || m.releaseInfo || '').slice(0, 4);
          const check = scoreExternalTitleMatch({
            queryTitle: title,
            englishTitle,
            expectedYear: effectiveYear,
            expectedYearExplicit: yearExplicit,
            kind,
            candidateTitles: [m.name],
            candidateYear: candYear,
          });
          if (check.matched) {
            matches.push({ id: m.id, score: check.score, name: m.name, year: candYear });
          }
        }

        matches.sort((a, b) => b.score - a.score);
        for (const cand of matches.slice(0, 2)) {
          const meta = await fetchCinemetaRatingByImdbId(cand.id, cmType);
          if (meta) {
            return {
              id: inputId,
              imdb: meta.rating,
              imdbId: cand.id,
              matchedTitle: meta.name || cand.name,
              year: meta.year || cand.year || undefined,
              source: meta.source,
            };
          }
        }
      } catch {
        // ignore Cinemeta search error
      }
    }
  }
  return null;
}

async function searchImdbSuggestionForRating(params: {
  queries: string[];
  title: string;
  englishTitle: string;
  effectiveYear: string;
  yearExplicit: boolean;
  kind: string;
  inputId?: string;
}): Promise<ResolvedMediaRating | null> {
  const { queries, title, englishTitle, effectiveYear, yearExplicit, kind, inputId } = params;
  for (const q of queries.slice(0, 3)) {
    if (!/[A-Za-z]/.test(q) && /[\u0600-\u06FF]/.test(q)) {
      continue;
    }
    const firstChar = q.charAt(0).toLowerCase();
    const prefix = /[a-z0-9]/.test(firstChar) ? firstChar : 'a';
    const endpoint = `https://v3.sg.media-imdb.com/suggestion/${prefix}/${encodeURIComponent(q.toLowerCase())}.json`;

    try {
      const fetched = await fetchViaBrowserOrCorsRelay(endpoint, 6500);
      if (!fetched.ok || !fetched.text.trim().startsWith('{')) continue;
      const json = JSON.parse(fetched.text) as {
        d?: Array<{ id?: string; l?: string; qid?: string; y?: number }>;
      };

      const matches: Array<{ id: string; score: number }> = [];
      for (const item of (json.d || []).slice(0, 10)) {
        if (!item?.id || !/^tt\d+$/i.test(item.id) || !item.l) continue;
        const qid = (item.qid || '').toLowerCase();
        if (
          kind === 'movie' &&
          qid &&
          !['movie', 'feature', 'tvmovie', 'short', 'video', 'tvspecial'].includes(qid)
        ) {
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
          kind,
          candidateTitles: [item.l],
          candidateYear: item.y ? String(item.y) : undefined,
        });
        if (check.matched) {
          matches.push({ id: item.id, score: check.score });
        }
      }

      matches.sort((a, b) => b.score - a.score);
      for (const cand of matches.slice(0, 2)) {
        const meta = await fetchCinemetaRatingByImdbId(cand.id, kind);
        if (meta) {
          return {
            id: inputId,
            imdb: meta.rating,
            imdbId: cand.id,
            matchedTitle: meta.name,
            year: meta.year,
            source: meta.source,
          };
        }
      }
    } catch {
      // ignore IMDb suggestion error
    }
  }
  return null;
}

async function queryWikidataBridgeInBrowser(params: {
  queries: string[];
  title: string;
  englishTitle: string;
  year: string;
  yearExplicit: boolean;
  kind: string;
}): Promise<{ imdbId: string; englishTitle: string; year: string } | null> {
  const { queries, title, englishTitle, year, yearExplicit, kind } = params;
  if (queries.length === 0) return null;

  const cacheKey = `${kind}|${queries.slice(0, 3).join('||').toLowerCase()}|${year}`;
  if (WIKIDATA_BRIDGE_CACHE.has(cacheKey)) {
    return WIKIDATA_BRIDGE_CACHE.get(cacheKey) || null;
  }

  const scoreEntityIds = async (ids: string[]) => {
    if (ids.length === 0) return null;
    const entJson = await fetchWikimediaJson<{
      entities?: Record<
        string,
        {
          labels?: { ar?: { value?: string }; en?: { value?: string }; mul?: { value?: string } };
          aliases?: {
            ar?: Array<{ value?: string }>;
            en?: Array<{ value?: string }>;
            mul?: Array<{ value?: string }>;
          };
          claims?: Record<
            string,
            Array<{ mainsnak?: { datavalue?: { value?: string | { id?: string; time?: string } } } }>
          >;
        }
      >;
    }>(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('|')}&props=labels|aliases|claims&languages=ar|en|mul&format=json&origin=*`
    );
    if (!entJson) return null;

    let bestMatch: { score: number; imdbId: string; englishTitle: string; year: string } | null = null;
    for (const id of ids) {
      const ent = entJson.entities?.[id];
      if (!ent?.claims) continue;

      const imdbClaim = ent.claims.P345?.[0]?.mainsnak?.datavalue?.value;
      const imdbId = typeof imdbClaim === 'string' && /^tt\d{6,10}$/i.test(imdbClaim) ? imdbClaim : '';
      const enLabel = ent.labels?.en?.value || ent.labels?.mul?.value || '';
      if (!imdbId && !enLabel) continue;

      const p31Ids = (ent.claims.P31 || [])
        .map((c) => {
          const v = c?.mainsnak?.datavalue?.value;
          return typeof v === 'object' && v?.id ? v.id : '';
        })
        .filter(Boolean);
      const isSeriesQid = p31Ids.some((qid) => WIKIDATA_SERIES_QIDS.has(qid));
      const isFilmQid = p31Ids.some((qid) => WIKIDATA_FILM_QIDS.has(qid));
      if (kind === 'movie' && isSeriesQid && !isFilmQid) continue;
      if (kind === 'series' && isFilmQid && !isSeriesQid) continue;

      const dateClaim =
        ent.claims.P577?.[0]?.mainsnak?.datavalue?.value ||
        ent.claims.P580?.[0]?.mainsnak?.datavalue?.value;
      const candYear =
        typeof dateClaim === 'object' && dateClaim?.time
          ? dateClaim.time.match(/(\d{4})/)?.[1] || ''
          : '';

      const check = scoreExternalTitleMatch({
        queryTitle: title,
        englishTitle,
        expectedYear: year,
        expectedYearExplicit: yearExplicit,
        kind,
        candidateTitles: [
          ent.labels?.ar?.value,
          enLabel,
          ...(ent.aliases?.ar || []).map((a) => a.value),
          ...(ent.aliases?.en || []).map((a) => a.value),
          ...(ent.aliases?.mul || []).map((a) => a.value),
        ],
        candidateYear: candYear,
      });

      if (check.matched) {
        const effectiveScore = imdbId ? check.score + 0.05 : check.score;
        if (!bestMatch || effectiveScore > bestMatch.score) {
          bestMatch = {
            score: effectiveScore,
            imdbId,
            englishTitle: enLabel || ent.labels?.ar?.value || '',
            year: candYear,
          };
        }
      }
    }

    return bestMatch
      ? { imdbId: bestMatch.imdbId, englishTitle: bestMatch.englishTitle, year: bestMatch.year }
      : null;
  };

  for (const term of queries.slice(0, 3)) {
    const lang = /[\u0600-\u06FF]/.test(term) ? 'ar' : 'en';
    const sJson = await fetchWikimediaJson<{ search?: Array<{ id?: string }> }>(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(term)}&language=${lang}&limit=6&format=json&origin=*`
    );
    if (sJson) {
      const ids = (sJson.search || []).map((s) => s.id).filter((id): id is string => Boolean(id));
      const matched = await scoreEntityIds(ids);
      if (matched) {
        WIKIDATA_BRIDGE_CACHE.set(cacheKey, matched);
        return matched;
      }
    }
  }

  // Wikipedia full-text search fallback when wbsearchentities missed punctuation/subtitles
  const primaryTerm = queries.find((q) => /[\u0600-\u06FF]/.test(q)) || queries[0];
  if (primaryTerm) {
    const wikiLang = /[\u0600-\u06FF]/.test(primaryTerm) ? 'ar' : 'en';
    const wpJson = await fetchWikimediaJson<{
      query?: { pages?: Record<string, { pageprops?: { wikibase_item?: string } }> };
    }>(
      `https://${wikiLang}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(primaryTerm)}&gsrlimit=5&prop=pageprops&ppprop=wikibase_item&format=json&origin=*`
    );
    if (wpJson) {
      const ids = Array.from(
        new Set(
          Object.values(wpJson.query?.pages || {})
            .map((p) => p.pageprops?.wikibase_item)
            .filter((id): id is string => Boolean(id && /^Q\d+$/i.test(id)))
        )
      );
      const matched = await scoreEntityIds(ids);
      if (matched) {
        WIKIDATA_BRIDGE_CACHE.set(cacheKey, matched);
        return matched;
      }
    }
  }

  WIKIDATA_BRIDGE_CACHE.set(cacheKey, null);
  return null;
}

async function searchTvmazeForRating(params: {
  queries: string[];
  title: string;
  englishTitle: string;
  effectiveYear: string;
  yearExplicit: boolean;
  kind: string;
  inputId?: string;
}): Promise<ResolvedMediaRating | null> {
  const { queries, title, englishTitle, effectiveYear, yearExplicit, kind, inputId } = params;
  if (kind !== 'series' && kind !== 'tv' && kind !== 'wrestling') return null;

  for (const q of queries.slice(0, 3)) {
    if (!/[A-Za-z]/.test(q) && /[\u0600-\u06FF]/.test(q)) continue;
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
      let best: {
        score: number;
        show: NonNullable<(typeof list)[number]['show']>;
      } | null = null;
      for (const entry of list.slice(0, 8)) {
        const show = entry?.show;
        if (!show?.name) continue;
        const check = scoreExternalTitleMatch({
          queryTitle: title,
          englishTitle,
          expectedYear: effectiveYear,
          expectedYearExplicit: yearExplicit,
          kind,
          candidateTitles: [show.name],
          candidateYear: show.premiered?.slice(0, 4),
        });
        if (check.matched && (!best || check.score > best.score)) {
          best = { score: check.score, show };
        }
      }
      if (!best) continue;

      const extImdb = best.show.externals?.imdb || '';
      if (extImdb && /^tt\d+$/i.test(extImdb)) {
        const meta = await fetchCinemetaRatingByImdbId(extImdb, kind);
        if (meta) {
          return {
            id: inputId,
            imdb: meta.rating,
            imdbId: extImdb,
            matchedTitle: meta.name || best.show.name,
            year: meta.year || best.show.premiered?.slice(0, 4),
            source: meta.source,
          };
        }
      }
      const tvRating = normalizeRatingNumber(best.show.rating?.average);
      if (tvRating !== null) {
        return {
          id: inputId,
          imdb: tvRating,
          imdbId: extImdb || undefined,
          matchedTitle: best.show.name,
          year: best.show.premiered?.slice(0, 4),
          source: 'tvmaze',
        };
      }
    } catch {
      // ignore TVmaze error
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
  const queries = buildExternalSearchQueries(title, englishTitle);

  const cacheKey = `${kind}|${imdbId}|${title}|${englishTitle}|${effectiveYear}`;
  if (RATING_RESULT_CACHE.has(cacheKey)) {
    const cached = RATING_RESULT_CACHE.get(cacheKey);
    return cached ? { ...cached, id: input.id } : null;
  }

  const remember = (res: ResolvedMediaRating | null) => {
    if (RATING_RESULT_CACHE.size > 400) RATING_RESULT_CACHE.clear();
    RATING_RESULT_CACHE.set(cacheKey, res);
    return res;
  };

  if (imdbId && /^tt\d{6,10}$/i.test(imdbId)) {
    const direct = await fetchCinemetaRatingByImdbId(imdbId, kind);
    if (direct) {
      return remember({
        id: input.id,
        imdb: direct.rating,
        imdbId,
        matchedTitle: direct.name,
        year: direct.year,
        source: direct.source,
      });
    }
  }

  if (queries.length === 0) return remember(null);

  // 1. Cinemeta catalog search (movie/series)
  const cmRes = await searchCinemetaForRating({
    queries,
    title,
    englishTitle,
    effectiveYear,
    yearExplicit,
    kind,
    inputId: input.id,
  });
  if (cmRes) return remember(cmRes);

  // 2. IMDb Suggestion API (via Worker/CORS relay when needed) -> Cinemeta / TVmaze rating
  const suggestRes = await searchImdbSuggestionForRating({
    queries,
    title,
    englishTitle,
    effectiveYear,
    yearExplicit,
    kind,
    inputId: input.id,
  });
  if (suggestRes) return remember(suggestRes);

  // 3. Wikidata & Wikipedia Arabic/English bridge -> Cinemeta / TVmaze / English title retry
  const wiki = await queryWikidataBridgeInBrowser({
    queries,
    title,
    englishTitle,
    year: effectiveYear,
    yearExplicit,
    kind,
  });
  if (wiki?.imdbId) {
    const meta = await fetchCinemetaRatingByImdbId(wiki.imdbId, kind);
    if (meta) {
      return remember({
        id: input.id,
        imdb: meta.rating,
        imdbId: wiki.imdbId,
        matchedTitle: meta.name || wiki.englishTitle || undefined,
        year: meta.year || wiki.year || undefined,
        source: meta.source,
      });
    }
  }
  if (wiki?.englishTitle) {
    const bridgedQueries = buildExternalSearchQueries(wiki.englishTitle, wiki.englishTitle);
    const effectiveBridgeTitle = englishTitle || wiki.englishTitle;
    const cmBridge = await searchCinemetaForRating({
      queries: bridgedQueries,
      title,
      englishTitle: effectiveBridgeTitle,
      effectiveYear: wiki.year || effectiveYear,
      yearExplicit,
      kind,
      inputId: input.id,
    });
    if (cmBridge) return remember(cmBridge);

    const suggestBridge = await searchImdbSuggestionForRating({
      queries: bridgedQueries,
      title,
      englishTitle: effectiveBridgeTitle,
      effectiveYear: wiki.year || effectiveYear,
      yearExplicit,
      kind,
      inputId: input.id,
    });
    if (suggestBridge) return remember(suggestBridge);

    const tvBridge = await searchTvmazeForRating({
      queries: bridgedQueries,
      title,
      englishTitle: effectiveBridgeTitle,
      effectiveYear: wiki.year || effectiveYear,
      yearExplicit,
      kind,
      inputId: input.id,
    });
    if (tvBridge) return remember(tvBridge);
  }

  // 4. TVmaze fallback for series/tv/wrestling
  const tvRes = await searchTvmazeForRating({
    queries,
    title,
    englishTitle,
    effectiveYear,
    yearExplicit,
    kind,
    inputId: input.id,
  });
  if (tvRes) return remember(tvRes);

  return remember(null);
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
        if (data.ok && data.result) {
          return data.result;
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
