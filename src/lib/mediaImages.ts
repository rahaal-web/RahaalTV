import { ImageQualityStatus, MediaItem, MediaKind } from '../types/media';
import {
  fetchViaBrowserOrCorsRelay,
  resolveApiEndpoint,
  shouldSkipBackendApiCalls,
} from './clientScraper';
import {
  cleanExternalSearchTitle,
  extractCleanEnglishTitleCandidate,
  isJunkImageCandidate,
  isLowTrustScrapedPosterUrl,
  scoreExternalTitleMatch,
} from './imageMatching';
import { FALLBACK_BACKDROP, FALLBACK_POSTER, resolveMediaAssetUrl } from './mediaFilters';
import { createTimeoutSignal } from './browserCompat';

async function fetchWithCompatTimeout(url: string, ms: number): Promise<Response> {
  const { signal, cleanup } = createTimeoutSignal(ms);
  try {
    return await fetch(url, { signal });
  } finally {
    cleanup();
  }
}

export interface ImageDimensionResult {
  ok: boolean;
  url: string;
  width: number;
  height: number;
  aspectRatio: number;
  orientation: 'landscape' | 'portrait' | 'square' | 'unknown';
}

export interface ResolvedImageBundle {
  poster_url: string;
  poster_width: number;
  poster_height: number;
  backdrop_url: string;
  backdrop_width: number;
  backdrop_height: number;
  image_source: string;
  image_quality_status: ImageQualityStatus;
  notes?: string[];
}

export function isLocalBuiltinAsset(url?: string | null): boolean {
  const clean = String(url || '').trim();
  if (!clean) return false;
  return (
    clean.startsWith('/src/assets/') ||
    clean.startsWith('/assets/') ||
    clean.startsWith('data:image/') ||
    /\/assets\/.*-(jpg|jpeg|png|webp)|hero_scifi_backdrop|poster_/i.test(clean)
  );
}

/**
 * Upgrades known CDN URL patterns to full/higher resolution variants without guessing random hosts.
 */
export function upgradeKnownImageUrl(rawUrl?: string | null): string {
  const clean = String(rawUrl || '').trim();
  if (!clean || !/^https?:\/\//i.test(clean)) return clean;

  // 1. TMDB CDN -> /original (highest resolution)
  if (/image\.tmdb\.org\/t\/p\//i.test(clean)) {
    return clean.replace(
      /\/t\/p\/(?:w\d+|h\d+|original)\//i,
      '/t/p/original/'
    );
  }

  // 2. Blogger / Googleusercontent -> /s1600/ or =s1600
  if (/bp\.blogspot\.com|blogger\.googleusercontent\.com|googleusercontent\.com/i.test(clean)) {
    let upgraded = clean.replace(
      /\/(?:s|w|h)\d+(?:-[a-zA-Z0-9]+)*\//i,
      '/s1600/'
    );
    upgraded = upgraded.replace(/=[sw]\d+(?:-[a-zA-Z0-9-]+)*$/i, '=s1600');
    return upgraded;
  }

  // 3. IMDb / Amazon Media CDN -> remove thumbnail resize suffixes
  if (/media-amazon\.com\/images\/|ssl-images-amazon\.com\/images\//i.test(clean)) {
    return clean.replace(/\._V1_[^.]*\.(jpg|jpeg|png|webp)$/i, '._V1_.$1');
  }

  // 4. WordPress standard thumbnail suffix e.g. image-300x450.jpg -> image.jpg
  if (/\/wp-content\/uploads\//i.test(clean)) {
    return clean.replace(/-\d{2,4}x\d{2,4}(?=\.(jpg|jpeg|png|webp)(?:\?|$))/i, '');
  }

  // 5. Apple iTunes CDN artwork -> 1200x1800bb
  if (/mzstatic\.com\/image\/thumb\//i.test(clean)) {
    return clean.replace(/\/\d+x\d+bb\.(jpg|webp|png)$/i, '/1200x1800bb.jpg');
  }

  return clean;
}

/**
 * Picks optimal TMDB responsive URL size (falls back unchanged for non-TMDB URLs).
 */
export function optimizeTmdbUrl(
  url: string,
  size: 'w342' | 'w500' | 'w780' | 'w1280' | 'original'
): string {
  const clean = String(url || '').trim();
  if (!/image\.tmdb\.org\/t\/p\//i.test(clean)) return clean;
  return clean.replace(/\/t\/p\/(?:w\d+|h\d+|original)\//i, `/t/p/${size}/`);
}

export function buildPosterSrcSet(url?: string | null): string | undefined {
  const clean = String(url || '').trim();
  if (!/image\.tmdb\.org\/t\/p\//i.test(clean)) return undefined;
  return `${optimizeTmdbUrl(clean, 'w342')} 342w, ${optimizeTmdbUrl(clean, 'w500')} 500w, ${optimizeTmdbUrl(clean, 'w780')} 780w, ${optimizeTmdbUrl(clean, 'original')} 1200w`;
}

export function buildBackdropSrcSet(url?: string | null): string | undefined {
  const clean = String(url || '').trim();
  if (!/image\.tmdb\.org\/t\/p\//i.test(clean)) return undefined;
  return `${optimizeTmdbUrl(clean, 'w780')} 780w, ${optimizeTmdbUrl(clean, 'w1280')} 1280w, ${optimizeTmdbUrl(clean, 'original')} 1920w`;
}

export function isObviouslyLowResUrl(url?: string | null): boolean {
  const clean = String(url || '').trim().toLowerCase();
  if (!clean) return true;
  if (/image\.tmdb\.org\/t\/p\/(?:w92|w154|w185|w300)\b/.test(clean)) return true;
  if (/\/s(?:72|120|180|240|320|400)(?:-c)?\//.test(clean)) return true;
  if (/-\d{2,3}x\d{2,3}\.(jpg|jpeg|png|webp)/.test(clean)) {
    const m = clean.match(/-(\d{2,3})x(\d{2,3})\./);
    if (m && (Number(m[1]) < 450 || Number(m[2]) < 450)) return true;
  }
  return false;
}

/**
 * Strictly returns Portrait Poster URL for movie cards, archive tiles, and detail poster card.
 */
export function getPosterUrl(item?: Partial<MediaItem> | null): string {
  if (!item) return FALLBACK_POSTER;
  const candidate = item.poster_url || item.poster;
  return resolveMediaAssetUrl(candidate, FALLBACK_POSTER);
}

/**
 * Returns Square Thumbnail URL derived cleanly from the Poster URL (for the 8-item 1:1 Hero Strip).
 */
export function getHeroThumbUrl(item?: Partial<MediaItem> | null): string {
  const poster = getPosterUrl(item);
  if (/image\.tmdb\.org\/t\/p\//i.test(poster)) {
    return optimizeTmdbUrl(poster, 'w342');
  }
  return poster;
}

/**
 * Evaluates whether a MediaItem has a dedicated genuine Landscape Backdrop (separate from a portrait poster).
 */
export function getBackdropInfo(item?: Partial<MediaItem> | null): {
  url: string;
  hasDedicatedBackdrop: boolean;
  isPortraitMismatch: boolean;
} {
  if (!item) {
    return {
      url: FALLBACK_BACKDROP,
      hasDedicatedBackdrop: false,
      isPortraitMismatch: false,
    };
  }

  const posterResolved = getPosterUrl(item);
  const rawBackdrop =
    item.backdrop_url !== undefined ? item.backdrop_url : item.backdrop;
  const backdropResolved = resolveMediaAssetUrl(rawBackdrop, '');

  if (!backdropResolved) {
    return {
      url: FALLBACK_BACKDROP,
      hasDedicatedBackdrop: false,
      isPortraitMismatch: false,
    };
  }

  const bw = Number(item.backdrop_width || 0);
  const bh = Number(item.backdrop_height || 0);
  const pw = Number(item.poster_width || 0);
  const ph = Number(item.poster_height || 0);

  // Explicit dimension measurement proves portrait image was mistakenly assigned to backdrop
  if (bw > 0 && bh > 0 && bw <= bh) {
    return {
      url: backdropResolved,
      hasDedicatedBackdrop: false,
      isPortraitMismatch: true,
    };
  }

  // Same URL as poster & poster is verified portrait or dimensions unverified
  if (backdropResolved === posterResolved) {
    if (pw > 0 && ph > 0 && pw > ph) {
      // Edge case: stored URL is actually landscape
      return {
        url: backdropResolved,
        hasDedicatedBackdrop: true,
        isPortraitMismatch: false,
      };
    }
    if (pw > 0 && ph > 0 && ph >= pw) {
      return {
        url: backdropResolved,
        hasDedicatedBackdrop: false,
        isPortraitMismatch: true,
      };
    }
    return {
      url: backdropResolved,
      hasDedicatedBackdrop: false,
      isPortraitMismatch: false,
    };
  }

  return {
    url: backdropResolved,
    hasDedicatedBackdrop: true,
    isPortraitMismatch: false,
  };
}

export function getBackdropUrl(item?: Partial<MediaItem> | null): string {
  const info = getBackdropInfo(item);
  return info.hasDedicatedBackdrop ? info.url : FALLBACK_BACKDROP;
}

/**
 * Computes honest ImageQualityStatus using real measured pixel dimensions when available.
 */
export function evaluateImageQuality(params: {
  posterUrl?: string;
  backdropUrl?: string;
  posterWidth?: number;
  posterHeight?: number;
  backdropWidth?: number;
  backdropHeight?: number;
}): ImageQualityStatus {
  const posterUrl = String(params.posterUrl || '').trim();
  const backdropUrl = String(params.backdropUrl || '').trim();
  const pw = Math.max(0, Math.round(Number(params.posterWidth) || 0));
  const ph = Math.max(0, Math.round(Number(params.posterHeight) || 0));
  const bw = Math.max(0, Math.round(Number(params.backdropWidth) || 0));
  const bh = Math.max(0, Math.round(Number(params.backdropHeight) || 0));

  const hasDistinctBackdrop = Boolean(backdropUrl && backdropUrl !== posterUrl);
  const backdropIsMeasuredPortrait = bw > 0 && bh > 0 && bw <= bh;

  if (!hasDistinctBackdrop || backdropIsMeasuredPortrait) {
    return 'missing_backdrop';
  }

  if (isObviouslyLowResUrl(posterUrl) || isObviouslyLowResUrl(backdropUrl)) {
    return 'low';
  }

  // Real dimension verification path
  if (pw > 0 && ph > 0 && bw > 0 && bh > 0) {
    if (pw < 450 || ph < 650 || bw < 960 || bh < 540) {
      return 'low';
    }
    if (pw >= 900 && ph >= 1300 && bw >= 1600 && bh >= 900) {
      return 'high';
    }
    if (pw >= 600 && ph >= 900 && bw >= 1200 && bh >= 675) {
      return 'high';
    }
    return 'medium';
  }

  if (bw > 0 && bh > 0 && (bw < 960 || bh < 540)) {
    return 'low';
  }
  if (pw > 0 && ph > 0 && (pw < 450 || ph < 650)) {
    return 'low';
  }

  return 'unknown';
}

export function getMediaImageQualityStatus(item?: Partial<MediaItem> | null): ImageQualityStatus {
  if (!item) return 'unknown';
  const posterUrl = item.poster_url || item.poster || '';
  const backdropUrl = item.backdrop_url !== undefined ? item.backdrop_url : item.backdrop || '';
  const computed = evaluateImageQuality({
    posterUrl,
    backdropUrl,
    posterWidth: item.poster_width,
    posterHeight: item.poster_height,
    backdropWidth: item.backdrop_width,
    backdropHeight: item.backdrop_height,
  });
  if (computed !== 'unknown') return computed;
  return item.image_quality_status || 'unknown';
}

export const IMAGE_QUALITY_BADGE_MAP: Record<
  ImageQualityStatus,
  { label: string; badgeClass: string }
> = {
  high: {
    label: 'جودة عالية HD/4K',
    badgeClass: 'bg-[#4CAF50]/15 border-[#4CAF50]/40 text-[#4CAF50]',
  },
  medium: {
    label: 'جودة متوسطة',
    badgeClass: 'bg-sky-500/15 border-sky-400/40 text-sky-300',
  },
  missing_backdrop: {
    label: 'بدون خلفية 16:9',
    badgeClass: 'bg-[#f9c400]/15 border-[#f9c400]/45 text-[#f9c400]',
  },
  low: {
    label: 'دقة منخفضة',
    badgeClass: 'bg-[#D92321]/20 border-[#D92321]/50 text-[#ff8a88]',
  },
  unknown: {
    label: 'غير مقاس فعلياً',
    badgeClass: 'bg-white/10 border-white/15 text-[#b7c9ef]',
  },
};

/**
 * Measures true rendered pixel dimensions of any image URL inside the browser via HTMLImageElement.
 */
export function probeImageDimensionsInBrowser(
  url: string,
  timeoutMs = 7000
): Promise<ImageDimensionResult> {
  const resolved = resolveMediaAssetUrl(url, '');
  if (!resolved) {
    return Promise.resolve({
      ok: false,
      url: '',
      width: 0,
      height: 0,
      aspectRatio: 0,
      orientation: 'unknown',
    });
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    let settled = false;

    const finish = (ok: boolean, width = 0, height = 0) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const ratio = width > 0 && height > 0 ? Number((width / height).toFixed(3)) : 0;
      const orientation: ImageDimensionResult['orientation'] =
        width === 0 || height === 0
          ? 'unknown'
          : width > height * 1.15
            ? 'landscape'
            : height > width * 1.15
              ? 'portrait'
              : 'square';
      resolve({ ok, url: resolved, width, height, aspectRatio: ratio, orientation });
    };

    const timer = setTimeout(() => finish(false, 0, 0), timeoutMs);

    img.onload = () => {
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      finish(w > 0 && h > 0, w, h);
    };
    img.onerror = () => finish(false, 0, 0);
    img.src = resolved;
  });
}

async function queryTvmazeImagesInBrowser(params: {
  query: string;
  title: string;
  englishTitle: string;
  year: string;
}): Promise<{
  poster?: string;
  backdrop?: string;
  pw?: number;
  ph?: number;
  bw?: number;
  bh?: number;
  matchedTitle?: string;
} | null> {
  const { query, title, englishTitle, year } = params;
  if (!query || query.length < 2) return null;
  try {
    const searchRes = await fetchWithCompatTimeout(
      `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`,
      6000
    );
    if (!searchRes.ok) return null;
    const candidates = (await searchRes.json()) as Array<{
      score?: number;
      show?: {
        id?: number;
        name?: string;
        premiered?: string;
      };
    }>;
    if (!Array.isArray(candidates) || candidates.length === 0) return null;

    let bestId = 0;
    let bestMatchScore = 0;
    let bestName = '';

    for (const entry of candidates.slice(0, 8)) {
      const show = entry.show;
      if (!show?.id || !show.name) continue;
      const check = scoreExternalTitleMatch({
        queryTitle: title,
        englishTitle,
        expectedYear: year,
        expectedYearExplicit: Boolean(year && year !== '2026'),
        candidateTitles: [show.name],
        candidateYear: show.premiered?.slice(0, 4),
      });
      if (check.matched && check.score > bestMatchScore) {
        bestMatchScore = check.score;
        bestId = show.id;
        bestName = show.name;
      }
    }

    if (!bestId) return null;

    const showRes = await fetchWithCompatTimeout(
      `https://api.tvmaze.com/shows/${bestId}?embed=images`,
      6000
    );
    if (!showRes.ok) return null;

    const data = (await showRes.json()) as {
      image?: { original?: string; medium?: string };
      _embedded?: {
        images?: Array<{
          type?: string;
          main?: boolean;
          resolutions?: {
            original?: { url?: string; width?: number; height?: number };
          };
        }>;
      };
    };

    const imgs = data._embedded?.images || [];
    const posters = imgs
      .filter((i) => i.type === 'poster' && i.resolutions?.original?.url)
      .sort(
        (a, b) =>
          (b.resolutions?.original?.width || 0) - (a.resolutions?.original?.width || 0)
      );
    const backgrounds = imgs
      .filter(
        (i) =>
          (i.type === 'background' || i.type === 'banner') &&
          i.resolutions?.original?.url &&
          (i.resolutions?.original?.width || 0) > (i.resolutions?.original?.height || 0)
      )
      .sort(
        (a, b) =>
          (b.resolutions?.original?.width || 0) - (a.resolutions?.original?.width || 0)
      );

    const bestPoster = posters[0]?.resolutions?.original;
    const bestBg = backgrounds[0]?.resolutions?.original;
    if (!bestPoster && !bestBg && !data.image?.original) return null;

    return {
      poster: bestPoster?.url || data.image?.original,
      pw: bestPoster?.width || 0,
      ph: bestPoster?.height || 0,
      backdrop: bestBg?.url || '',
      bw: bestBg?.width || 0,
      bh: bestBg?.height || 0,
      matchedTitle: bestName,
    };
  } catch {
    return null;
  }
}

async function queryItunesPosterInBrowser(params: {
  query: string;
  title: string;
  englishTitle: string;
  year: string;
  kind: MediaKind;
}): Promise<{ url: string; matchedTitle: string } | null> {
  const { query, title, englishTitle, year, kind } = params;
  // iTunes tvSeason artwork is 1:1 square cover art rather than 2:3 poster; only query movies
  if (!query || query.length < 2 || kind !== 'movie') return null;
  try {
    const res = await fetchWithCompatTimeout(
      `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=movie&entity=movie&limit=8`,
      6000
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      results?: Array<{
        trackName?: string;
        collectionName?: string;
        releaseDate?: string;
        artworkUrl100?: string;
      }>;
    };
    const results = json.results || [];
    let bestArt = '';
    let bestTitle = '';
    let bestScore = 0;

    for (const r of results) {
      if (!r.artworkUrl100) continue;
      const check = scoreExternalTitleMatch({
        queryTitle: title,
        englishTitle,
        expectedYear: year,
        expectedYearExplicit: Boolean(year && year !== '2026'),
        candidateTitles: [r.trackName, r.collectionName],
        candidateYear: r.releaseDate?.slice(0, 4),
      });
      if (check.matched && check.score > bestScore) {
        bestScore = check.score;
        bestArt = upgradeKnownImageUrl(r.artworkUrl100);
        bestTitle = r.trackName || r.collectionName || '';
      }
    }

    return bestArt ? { url: bestArt, matchedTitle: bestTitle } : null;
  } catch {
    return null;
  }
}

function buildCandidateSearchQueries(
  title: string,
  englishTitle: string,
  extraTitle?: string
): string[] {
  const candidates = [
    cleanExternalSearchTitle(title, englishTitle),
    extraTitle ? cleanExternalSearchTitle(extraTitle, extraTitle) : '',
    extractCleanEnglishTitleCandidate(title),
    cleanExternalSearchTitle(title, ''),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of candidates) {
    const clean = q.trim();
    const key = clean.toLowerCase();
    if (clean.length >= 2 && !seen.has(key)) {
      seen.add(key);
      out.push(clean);
    }
  }
  return out;
}

interface OfficialExternalMatch {
  imdbId?: string;
  poster?: string;
  backdrop?: string;
  pw?: number;
  ph?: number;
  bw?: number;
  bh?: number;
  source: string;
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

async function queryWikidataBridgeInBrowser(params: {
  queries: string[];
  title: string;
  englishTitle: string;
  year: string;
  kind: MediaKind;
}): Promise<{ imdbId: string; englishTitle: string; year: string } | null> {
  const { queries, title, englishTitle, year, kind } = params;
  const searchTerms = queries.slice(0, 2);
  if (searchTerms.length === 0) return null;

  for (const term of searchTerms) {
    const hasArabic = /[\u0600-\u06FF]/.test(term);
    const langs = hasArabic ? ['ar', 'en'] : ['en', 'ar'];
    for (const lang of langs) {
      try {
        const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(term)}&language=${lang}&limit=6&format=json&origin=*`;
        const searchRes = await fetchWithCompatTimeout(searchUrl, 5500);
        if (!searchRes.ok) continue;
        const searchJson = (await searchRes.json()) as {
          search?: Array<{ id?: string; label?: string }>;
        };
        const ids = (searchJson.search || []).map((s) => s.id).filter((id): id is string => Boolean(id));
        if (ids.length === 0) continue;

        const entUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('|')}&props=labels|aliases|claims&languages=ar|en&format=json&origin=*`;
        const entRes = await fetchWithCompatTimeout(entUrl, 5500);
        if (!entRes.ok) continue;
        const entJson = (await entRes.json()) as {
          entities?: Record<
            string,
            {
              labels?: { ar?: { value?: string }; en?: { value?: string } };
              aliases?: {
                ar?: Array<{ value?: string }>;
                en?: Array<{ value?: string }>;
              };
              claims?: Record<
                string,
                Array<{
                  mainsnak?: {
                    datavalue?: {
                      value?: string | { id?: string; time?: string };
                    };
                  };
                }>
              >;
            }
          >;
        };

        let bestMatch: { score: number; imdbId: string; englishTitle: string; year: string } | null = null;
        for (const id of ids) {
          const ent = entJson.entities?.[id];
          if (!ent?.claims) continue;

          const imdbClaim = ent.claims.P345?.[0]?.mainsnak?.datavalue?.value;
          const imdbId = typeof imdbClaim === 'string' && /^tt\d{6,10}$/i.test(imdbClaim) ? imdbClaim : '';
          if (!imdbId) continue;

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
          const candYearMatch =
            typeof dateClaim === 'object' && dateClaim?.time
              ? dateClaim.time.match(/(\d{4})/)
              : null;
          const candYear = candYearMatch?.[1] || '';

          const candidateTitles = [
            ent.labels?.ar?.value,
            ent.labels?.en?.value,
            ...(ent.aliases?.ar || []).map((a) => a.value),
            ...(ent.aliases?.en || []).map((a) => a.value),
          ];

          const check = scoreExternalTitleMatch({
            queryTitle: title,
            englishTitle,
            expectedYear: year,
            expectedYearExplicit: Boolean(year && year !== '2026'),
            candidateTitles,
            candidateYear: candYear,
          });

          if (check.matched && (!bestMatch || check.score > bestMatch.score)) {
            bestMatch = {
              score: check.score,
              imdbId,
              englishTitle: ent.labels?.en?.value || ent.labels?.ar?.value || '',
              year: candYear,
            };
          }
        }

        if (bestMatch) {
          return {
            imdbId: bestMatch.imdbId,
            englishTitle: bestMatch.englishTitle,
            year: bestMatch.year,
          };
        }
      } catch {
        // Ignore Wikidata network errors
      }
    }
  }
  return null;
}

async function queryImdbSuggestionInBrowser(params: {
  queries: string[];
  imdbId?: string;
  title: string;
  englishTitle: string;
  year: string;
  kind: MediaKind;
}): Promise<OfficialExternalMatch | null> {
  const { queries, imdbId = '', title, englishTitle, year, kind } = params;
  const searchList = imdbId ? [imdbId, ...queries] : queries;

  interface ImdbSuggestEntry {
    id?: string;
    l?: string;
    qid?: string;
    q?: string;
    y?: number;
    i?: { imageUrl?: string; width?: number; height?: number };
  }

  for (const rawQ of searchList.slice(0, 3)) {
    const cleanQ = rawQ.trim();
    if (cleanQ.length < 2) continue;
    const isDirectId = /^tt\d{6,10}$/i.test(cleanQ);
    const firstChar = cleanQ.charAt(0).toLowerCase();
    const prefix = /[a-z0-9]/.test(firstChar) ? firstChar : 'a';
    const endpoint = `https://v3.sg.media-imdb.com/suggestion/${prefix}/${encodeURIComponent(cleanQ.toLowerCase())}.json`;

    try {
      const fetched = await fetchViaBrowserOrCorsRelay(endpoint, 7500);
      if (!fetched.ok || !fetched.text.trim().startsWith('{')) continue;
      const json = JSON.parse(fetched.text) as { d?: ImdbSuggestEntry[] };
      const entries = json.d || [];

      let best: { score: number; entry: ImdbSuggestEntry } | null = null;
      for (const item of entries.slice(0, 10)) {
        if (!item?.id || !/^tt\d+$/i.test(item.id) || !item.i?.imageUrl) continue;
        const qid = (item.qid || '').toLowerCase();
        if (kind === 'movie' && qid && !['movie', 'feature', 'tvmovie', 'short', 'video'].includes(qid)) {
          continue;
        }
        if (kind === 'series' && qid && !['tvseries', 'tvminiseries'].includes(qid)) {
          continue;
        }

        if (isDirectId && item.id.toLowerCase() === cleanQ.toLowerCase()) {
          best = { score: 2, entry: item };
          break;
        }

        const check = scoreExternalTitleMatch({
          queryTitle: title,
          englishTitle,
          expectedYear: year,
          expectedYearExplicit: Boolean(year && year !== '2026'),
          candidateTitles: [item.l],
          candidateYear: item.y ? String(item.y) : undefined,
        });
        if (check.matched && (!best || check.score > best.score)) {
          best = { score: check.score, entry: item };
        }
      }

      if (best?.entry?.id && best.entry.i?.imageUrl) {
        const posterUrl = upgradeKnownImageUrl(best.entry.i.imageUrl);
        return {
          imdbId: best.entry.id,
          poster: posterUrl,
          pw: best.entry.i.width || 0,
          ph: best.entry.i.height || 0,
          source: 'imdb',
        };
      }
    } catch {
      // Ignore IMDb suggestion errors and try next query
    }
  }
  return null;
}

async function queryCinemetaImagesInBrowser(params: {
  queries: string[];
  imdbId?: string;
  title: string;
  englishTitle: string;
  year: string;
  kind: MediaKind;
}): Promise<OfficialExternalMatch | null> {
  const { queries, imdbId = '', title, englishTitle, year, kind } = params;
  const cmType = kind === 'series' ? 'series' : 'movie';

  const resolveFromImdbId = async (ttId: string): Promise<OfficialExternalMatch | null> => {
    try {
      const metaRes = await fetchWithCompatTimeout(
        `https://v3-cinemeta.strem.io/meta/${cmType}/${encodeURIComponent(ttId)}.json`,
        6000
      );
      let metaPoster = '';
      let metaBackdrop = '';
      if (metaRes.ok) {
        const metaJson = (await metaRes.json()) as {
          meta?: { poster?: string; background?: string };
        };
        metaPoster = metaJson.meta?.poster || '';
        metaBackdrop = metaJson.meta?.background || '';
      }
      const largePoster = `https://images.metahub.space/poster/large/${ttId}/img`;
      const largeBackdrop = `https://images.metahub.space/background/large/${ttId}/img`;

      const [pLargeProbe, bLargeProbe] = await Promise.all([
        probeImageDimensionsInBrowser(largePoster, 5500),
        probeImageDimensionsInBrowser(largeBackdrop, 5500),
      ]);

      let chosenPoster = '';
      let pw = 0;
      let ph = 0;
      if (pLargeProbe.ok && pLargeProbe.height >= pLargeProbe.width) {
        chosenPoster = largePoster;
        pw = pLargeProbe.width;
        ph = pLargeProbe.height;
      } else if (metaPoster) {
        const pMetaProbe = await probeImageDimensionsInBrowser(metaPoster, 5000);
        if (pMetaProbe.ok && pMetaProbe.height >= pMetaProbe.width) {
          chosenPoster = metaPoster;
          pw = pMetaProbe.width;
          ph = pMetaProbe.height;
        }
      }

      let chosenBackdrop = '';
      let bw = 0;
      let bh = 0;
      if (bLargeProbe.ok && bLargeProbe.width > bLargeProbe.height) {
        chosenBackdrop = largeBackdrop;
        bw = bLargeProbe.width;
        bh = bLargeProbe.height;
      } else if (metaBackdrop) {
        const bMetaProbe = await probeImageDimensionsInBrowser(metaBackdrop, 5000);
        if (bMetaProbe.ok && bMetaProbe.width > bMetaProbe.height) {
          chosenBackdrop = metaBackdrop;
          bw = bMetaProbe.width;
          bh = bMetaProbe.height;
        }
      }

      if (!chosenPoster && !chosenBackdrop) return null;
      return {
        imdbId: ttId,
        poster: chosenPoster,
        backdrop: chosenBackdrop,
        pw,
        ph,
        bw,
        bh,
        source: chosenBackdrop ? 'cinemeta' : 'metahub',
      };
    } catch {
      return null;
    }
  };

  if (imdbId && /^tt\d{6,10}$/i.test(imdbId)) {
    const byId = await resolveFromImdbId(imdbId);
    if (byId) return byId;
  }

  for (const q of queries.slice(0, 3)) {
    try {
      const searchRes = await fetchWithCompatTimeout(
        `https://v3-cinemeta.strem.io/catalog/${cmType}/top/search=${encodeURIComponent(q)}.json`,
        6500
      );
      if (!searchRes.ok) continue;
      const json = (await searchRes.json()) as {
        metas?: Array<{ id?: string; name?: string; releaseInfo?: string; year?: string | number }>;
      };
      let bestTtId = '';
      let bestScore = 0;
      for (const m of (json.metas || []).slice(0, 10)) {
        if (!m?.id || !/^tt\d+$/i.test(m.id) || !m.name) continue;
        const candYear = String(m.year || m.releaseInfo || '').slice(0, 4);
        const check = scoreExternalTitleMatch({
          queryTitle: title,
          englishTitle,
          expectedYear: year,
          expectedYearExplicit: Boolean(year && year !== '2026'),
          candidateTitles: [m.name],
          candidateYear: candYear,
        });
        if (check.matched && check.score > bestScore) {
          bestScore = check.score;
          bestTtId = m.id;
        }
      }
      if (bestTtId) {
        const resolved = await resolveFromImdbId(bestTtId);
        if (resolved) return resolved;
      }
    } catch {
      // ignore Cinemeta search error
    }
  }
  return null;
}

/**
 * Resolves independent high-res 2:3 Portrait Poster & 16:9 Landscape Backdrop with measured pixel verification.
 * Uses server /api/images/resolve (TMDB + IMDb + Cinemeta/Metahub + Wikidata + binary dimension probing) when available,
 * and seamlessly resolves client-side via IMDb Suggestion + Cinemeta/Metahub + Wikidata + TVmaze + iTunes.
 */
export async function resolveHighResImagesClient(params: {
  title: string;
  englishTitle?: string;
  year?: string;
  kind?: MediaKind;
  imdbId?: string;
  currentPoster?: string;
  currentBackdrop?: string;
  preferOfficial?: boolean;
}): Promise<ResolvedImageBundle> {
  const {
    title,
    englishTitle = '',
    year = '',
    kind = 'movie',
    imdbId = '',
    currentPoster = '',
    currentBackdrop = '',
    preferOfficial = false,
  } = params;

  const sanitizedCurrentPoster = isJunkImageCandidate(currentPoster) ? '' : currentPoster;
  const sanitizedCurrentBackdrop = isJunkImageCandidate(currentBackdrop) ? '' : currentBackdrop;

  // 1. Prefer server-side resolution (TMDB API key kept strictly server-side + binary dimension check)
  if (!shouldSkipBackendApiCalls()) {
    try {
      const response = await fetch(resolveApiEndpoint('/api/images/resolve'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          englishTitle,
          year,
          kind,
          imdbId,
          currentPoster: sanitizedCurrentPoster,
          currentBackdrop: sanitizedCurrentBackdrop,
          preferOfficial,
        }),
      });
      const ct = response.headers.get('content-type') || '';
      if (response.ok && ct.includes('application/json')) {
        const json = (await response.json()) as {
          ok?: boolean;
          result?: ResolvedImageBundle;
        };
        if (json.ok && json.result) {
          return json.result;
        }
      }
    } catch {
      // Static deploy or server unavailable -> fallback seamlessly below
    }
  }

  // 2. Client fallback: upgrade known CDN URLs & query strictly-verified official public metadata sources
  const notes: string[] = [];
  let posterUrl = sanitizedCurrentPoster ? upgradeKnownImageUrl(sanitizedCurrentPoster) : '';
  let backdropUrl =
    sanitizedCurrentBackdrop && sanitizedCurrentBackdrop !== sanitizedCurrentPoster
      ? upgradeKnownImageUrl(sanitizedCurrentBackdrop)
      : '';
  let imageSource = posterUrl ? 'upgraded_url' : 'none';

  const [posterProbeInitial, backdropProbeInitial] = await Promise.all([
    posterUrl ? probeImageDimensionsInBrowser(posterUrl) : Promise.resolve(null),
    backdropUrl ? probeImageDimensionsInBrowser(backdropUrl) : Promise.resolve(null),
  ]);

  let pw = posterProbeInitial?.ok ? posterProbeInitial.width : 0;
  let ph = posterProbeInitial?.ok ? posterProbeInitial.height : 0;
  let bw =
    backdropProbeInitial?.ok && backdropProbeInitial.width > backdropProbeInitial.height
      ? backdropProbeInitial.width
      : 0;
  let bh =
    backdropProbeInitial?.ok && backdropProbeInitial.width > backdropProbeInitial.height
      ? backdropProbeInitial.height
      : 0;

  if (backdropProbeInitial?.ok && backdropProbeInitial.width <= backdropProbeInitial.height) {
    backdropUrl = '';
    notes.push('تم رفض الخلفية الحالية لأنها طولية وليست 16:9 أفقية');
  }

  const posterIsLandscape = pw > 0 && ph > 0 && pw > ph * 1.05;
  const posterIsLowTrust = isLowTrustScrapedPosterUrl(posterUrl) || posterIsLandscape;
  if (posterIsLandscape) {
    notes.push(`تم رصد بوستر أفقي غير قياسي (${pw}×${ph}) وسيتم البحث عن البوستر العمودي الأصلي`);
  }

  const queries = buildCandidateSearchQueries(title, englishTitle);
  const needsOfficialPoster =
    preferOfficial || !posterUrl || pw === 0 || pw < 900 || posterIsLowTrust;
  const needsOfficialBackdrop = !backdropUrl || bw < 1200;

  let resolvedImdbId = imdbId;
  let extraEngTitle = '';
  let extraYear = year;

  // 2a. If query has Arabic script (or no Latin letters), check Wikidata first to get English title + IMDb ID
  const hasArabicOnlyQuery =
    queries.length > 0 &&
    queries.every((q) => /[\u0600-\u06FF]/.test(q) && !/[A-Za-z]{2,}/.test(q));

  if (!resolvedImdbId && hasArabicOnlyQuery && (needsOfficialPoster || needsOfficialBackdrop)) {
    const wikiRes = await queryWikidataBridgeInBrowser({
      queries,
      title,
      englishTitle,
      year,
      kind,
    });
    if (wikiRes) {
      resolvedImdbId = wikiRes.imdbId;
      extraEngTitle = wikiRes.englishTitle;
      if (!year && wikiRes.year) extraYear = wikiRes.year;
    }
  }

  const expandedQueries = buildCandidateSearchQueries(title, englishTitle, extraEngTitle);
  const searchTitle = title;
  const searchEng = extraEngTitle || englishTitle;

  const tryAcceptOfficialPoster = async (
    candidateUrl: string,
    knownW: number,
    knownH: number,
    sourceLabel: string
  ): Promise<boolean> => {
    if (!candidateUrl) return false;
    let cw = knownW;
    let ch = knownH;
    if (!cw || !ch) {
      const pTest = await probeImageDimensionsInBrowser(candidateUrl);
      if (!pTest.ok) return false;
      cw = pTest.width;
      ch = pTest.height;
    }
    // Official posters must be portrait or near-portrait (height >= width) and at least 500px wide
    if (ch < cw || cw < 500) return false;

    const currentIsAlreadyOfficial =
      imageSource === 'tmdb' || imageSource === 'imdb' || imageSource === 'cinemeta' || imageSource === 'metahub';

    const shouldReplace =
      !posterUrl ||
      posterIsLowTrust ||
      pw === 0 ||
      (preferOfficial && !currentIsAlreadyOfficial) ||
      cw > pw;

    if (shouldReplace) {
      posterUrl = candidateUrl;
      pw = cw;
      ph = ch;
      imageSource = sourceLabel;
      return true;
    }
    return false;
  };

  const tryAcceptOfficialBackdrop = (
    candidateUrl: string,
    cw: number,
    ch: number,
    sourceLabel: string
  ): boolean => {
    if (!candidateUrl || cw <= ch || cw < 960) return false;
    if (!backdropUrl || cw > bw) {
      backdropUrl = candidateUrl;
      bw = cw;
      bh = ch;
      if (imageSource === 'none' || imageSource === 'upgraded_url') {
        imageSource = sourceLabel;
      }
      return true;
    }
    return false;
  };

  // 2b. IMDb Suggestion API (original studio poster CDN + IMDb ID)
  if ((needsOfficialPoster || needsOfficialBackdrop) && (expandedQueries.length > 0 || resolvedImdbId)) {
    const imdbRes = await queryImdbSuggestionInBrowser({
      queries: expandedQueries,
      imdbId: resolvedImdbId,
      title: searchTitle,
      englishTitle: searchEng,
      year: extraYear,
      kind,
    });
    if (imdbRes) {
      if (imdbRes.imdbId && !resolvedImdbId) resolvedImdbId = imdbRes.imdbId;
      if (imdbRes.poster) {
        await tryAcceptOfficialPoster(imdbRes.poster, imdbRes.pw || 0, imdbRes.ph || 0, 'imdb');
      }
    }
  }

  // 2c. If still no IMDb ID (e.g. non-Latin match failed on IMDb Suggestion), try Wikidata bridge as general fallback
  if (!resolvedImdbId && expandedQueries.length > 0 && (needsOfficialPoster || needsOfficialBackdrop)) {
    const wikiRes = await queryWikidataBridgeInBrowser({
      queries: expandedQueries,
      title: searchTitle,
      englishTitle: searchEng,
      year: extraYear,
      kind,
    });
    if (wikiRes?.imdbId) {
      resolvedImdbId = wikiRes.imdbId;
      if (wikiRes.englishTitle) extraEngTitle = wikiRes.englishTitle;
      if (!posterUrl || posterIsLowTrust || (preferOfficial && imageSource !== 'imdb')) {
        const imdbByWikiId = await queryImdbSuggestionInBrowser({
          queries: [],
          imdbId: resolvedImdbId,
          title: searchTitle,
          englishTitle: extraEngTitle || searchEng,
          year: extraYear,
          kind,
        });
        if (imdbByWikiId?.poster) {
          await tryAcceptOfficialPoster(
            imdbByWikiId.poster,
            imdbByWikiId.pw || 0,
            imdbByWikiId.ph || 0,
            'imdb'
          );
        }
      }
    }
  }

  // 2d. Cinemeta + Metahub (CORS-open, delivers verified 16:9 Backdrops + Official Posters)
  if ((needsOfficialPoster || needsOfficialBackdrop) && (resolvedImdbId || expandedQueries.length > 0)) {
    const cmRes = await queryCinemetaImagesInBrowser({
      queries: buildCandidateSearchQueries(searchTitle, searchEng, extraEngTitle),
      imdbId: resolvedImdbId,
      title: searchTitle,
      englishTitle: searchEng,
      year: extraYear,
      kind,
    });
    if (cmRes) {
      if (cmRes.poster && (preferOfficial || posterIsLowTrust || !posterUrl || pw < 700)) {
        await tryAcceptOfficialPoster(cmRes.poster, cmRes.pw || 0, cmRes.ph || 0, cmRes.source);
      }
      if (cmRes.backdrop && cmRes.bw && cmRes.bh) {
        tryAcceptOfficialBackdrop(cmRes.backdrop, cmRes.bw, cmRes.bh, cmRes.source);
      }
    }
  }

  // 2e. TVmaze fallback ONLY for TV series when still missing high-res poster or backdrop
  const primaryQuery = expandedQueries[0] || '';
  if (primaryQuery && kind === 'series' && (!backdropUrl || pw < 800 || posterIsLowTrust)) {
    const tvm = await queryTvmazeImagesInBrowser({
      query: primaryQuery,
      title: searchTitle,
      englishTitle: searchEng,
      year: extraYear,
    });
    if (tvm) {
      if (tvm.poster) {
        await tryAcceptOfficialPoster(tvm.poster, tvm.pw || 0, tvm.ph || 0, 'tvmaze');
      }
      if (tvm.backdrop) {
        const bTest = await probeImageDimensionsInBrowser(tvm.backdrop);
        if (bTest.ok) {
          tryAcceptOfficialBackdrop(tvm.backdrop, bTest.width, bTest.height, 'tvmaze');
        }
      }
    }
  }

  // 2f. iTunes fallback ONLY for movies when no IMDb/Cinemeta poster succeeded
  if (primaryQuery && kind === 'movie' && (pw < 800 || posterIsLowTrust) && imageSource !== 'imdb') {
    const itunesMatch = await queryItunesPosterInBrowser({
      query: primaryQuery,
      title: searchTitle,
      englishTitle: searchEng,
      year: extraYear,
      kind,
    });
    if (itunesMatch?.url) {
      await tryAcceptOfficialPoster(itunesMatch.url, 0, 0, 'itunes');
    }
  }

  if (!posterUrl && sanitizedCurrentPoster) {
    posterUrl = sanitizedCurrentPoster;
  }

  const qualityStatus = evaluateImageQuality({
    posterUrl,
    backdropUrl,
    posterWidth: pw,
    posterHeight: ph,
    backdropWidth: bw,
    backdropHeight: bh,
  });

  return {
    poster_url: posterUrl,
    poster_width: pw,
    poster_height: ph,
    backdrop_url: backdropUrl,
    backdrop_width: bw,
    backdrop_height: bh,
    image_source: imageSource,
    image_quality_status: qualityStatus,
    notes,
  };
}
