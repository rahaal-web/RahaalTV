import { ImageQualityStatus, MediaItem, MediaKind } from '../types/media';
import {
  resolveApiEndpoint,
  shouldSkipBackendApiCalls,
} from './clientScraper';
import {
  cleanExternalSearchTitle,
  isJunkImageCandidate,
  scoreExternalTitleMatch,
} from './imageMatching';
import { FALLBACK_BACKDROP, FALLBACK_POSTER, resolveMediaAssetUrl } from './mediaFilters';

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
    const searchRes = await fetch(
      `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(6000) }
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

    const showRes = await fetch(
      `https://api.tvmaze.com/shows/${bestId}?embed=images`,
      { signal: AbortSignal.timeout(6000) }
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
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=movie&entity=movie&limit=8`,
      { signal: AbortSignal.timeout(6000) }
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

/**
 * Resolves independent high-res 2:3 Portrait Poster & 16:9 Landscape Backdrop with measured pixel verification.
 * Uses server /api/images/resolve (TMDB + public metadata + binary dimension probing) when available,
 * and safely falls back to browser-native dimension probing + strictly-verified TVmaze / iTunes + URL upgrades.
 */
export async function resolveHighResImagesClient(params: {
  title: string;
  englishTitle?: string;
  year?: string;
  kind?: MediaKind;
  currentPoster?: string;
  currentBackdrop?: string;
}): Promise<ResolvedImageBundle> {
  const {
    title,
    englishTitle = '',
    year = '',
    kind = 'movie',
    currentPoster = '',
    currentBackdrop = '',
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
          currentPoster: sanitizedCurrentPoster,
          currentBackdrop: sanitizedCurrentBackdrop,
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

  // 2. Client fallback: upgrade known CDN URLs & query strictly-verified public metadata sources
  const notes: string[] = [];
  let posterUrl = sanitizedCurrentPoster ? upgradeKnownImageUrl(sanitizedCurrentPoster) : '';
  let backdropUrl =
    sanitizedCurrentBackdrop && sanitizedCurrentBackdrop !== sanitizedCurrentPoster
      ? upgradeKnownImageUrl(sanitizedCurrentBackdrop)
      : '';
  let imageSource = posterUrl ? 'upgraded_url' : 'none';

  const cleanQuery = cleanExternalSearchTitle(title, englishTitle);

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

  const hasValidUnmeasuredScrapedPoster = Boolean(posterUrl && !posterProbeInitial?.ok);

  // TVmaze fallback ONLY for series/TV shows, verified strictly against title & year
  if (cleanQuery && kind === 'series' && (!backdropUrl || pw < 800)) {
    const tvm = await queryTvmazeImagesInBrowser({
      query: cleanQuery,
      title,
      englishTitle,
      year,
    });
    if (tvm) {
      if (tvm.poster) {
        const pTest = await probeImageDimensionsInBrowser(tvm.poster);
        const minAcceptWidth = hasValidUnmeasuredScrapedPoster ? 600 : Math.max(400, pw);
        if (pTest.ok && pTest.height >= pTest.width && pTest.width >= minAcceptWidth) {
          posterUrl = tvm.poster;
          pw = pTest.width;
          ph = pTest.height;
          imageSource = 'tvmaze';
        }
      }
      if (tvm.backdrop) {
        const bTest = await probeImageDimensionsInBrowser(tvm.backdrop);
        if (bTest.ok && bTest.width > bTest.height && bTest.width >= Math.max(1000, bw)) {
          backdropUrl = tvm.backdrop;
          bw = bTest.width;
          bh = bTest.height;
          if (imageSource === 'none' || imageSource === 'upgraded_url') {
            imageSource = 'tvmaze';
          }
        }
      }
    }
  }

  // iTunes fallback ONLY for movies, verified strictly against movie title & year (never overwrite an unmeasured scraped poster unless >=600px portrait match)
  if (cleanQuery && kind === 'movie' && pw < 800) {
    const itunesMatch = await queryItunesPosterInBrowser({
      query: cleanQuery,
      title,
      englishTitle,
      year,
      kind,
    });
    if (itunesMatch?.url) {
      const itProbe = await probeImageDimensionsInBrowser(itunesMatch.url);
      const minAcceptWidth = hasValidUnmeasuredScrapedPoster ? 600 : pw + 1;
      if (itProbe.ok && itProbe.height >= itProbe.width && itProbe.width >= minAcceptWidth) {
        posterUrl = itunesMatch.url;
        pw = itProbe.width;
        ph = itProbe.height;
        if (imageSource === 'none' || imageSource === 'upgraded_url') {
          imageSource = 'itunes';
        }
      }
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
