import type { ImageSlotType } from '../types/media';

/**
 * Official TMDB image CDN configuration sizes available per asset type.
 * Note: 'original' is strictly excluded from frontend display/card presets.
 */
export const TMDB_IMAGE_CONFIG = {
  secureBaseUrl: 'https://image.tmdb.org/t/p/',
  posterSizes: ['w92', 'w154', 'w185', 'w342', 'w500', 'w780'] as const,
  backdropSizes: ['w300', 'w780', 'w1280'] as const,
  stillSizes: ['w92', 'w185', 'w300'] as const,
  profileSizes: ['w45', 'w185', 'h632'] as const,
} as const;

export type TmdbDisplaySize =
  | 'w45'
  | 'w92'
  | 'w154'
  | 'w185'
  | 'w300'
  | 'w342'
  | 'w500'
  | 'w780'
  | 'w1280'
  | 'h632';

export interface SlotOptimizationSpec {
  defaultSize: TmdbDisplaySize;
  srcSetSizes: readonly TmdbDisplaySize[];
  widthDescriptorMap: Partial<Record<TmdbDisplaySize, number>>;
  sizesAttr: string;
  defaultFallbackWidth: number;
  defaultFallbackHeight: number;
}

export const IMAGE_SLOT_SPECS: Record<ImageSlotType, SlotOptimizationSpec> = {
  card_small: {
    defaultSize: 'w185',
    srcSetSizes: ['w154', 'w185', 'w342'],
    widthDescriptorMap: { w154: 154, w185: 185, w342: 342 },
    sizesAttr: '(max-width: 640px) 72px, 96px',
    defaultFallbackWidth: 185,
    defaultFallbackHeight: 278,
  },
  card_grid: {
    defaultSize: 'w342',
    srcSetSizes: ['w185', 'w342', 'w500'],
    widthDescriptorMap: { w185: 185, w342: 342, w500: 500 },
    sizesAttr:
      '(max-width: 639px) 46vw, (max-width: 1023px) 30vw, (max-width: 1279px) 22vw, 240px',
    defaultFallbackWidth: 342,
    defaultFallbackHeight: 513,
  },
  detail_poster: {
    defaultSize: 'w500',
    srcSetSizes: ['w342', 'w500', 'w780'],
    widthDescriptorMap: { w342: 342, w500: 500, w780: 780 },
    sizesAttr: '(max-width: 639px) 176px, (max-width: 1023px) 224px, 320px',
    defaultFallbackWidth: 500,
    defaultFallbackHeight: 750,
  },
  slider_backdrop: {
    defaultSize: 'w1280',
    srcSetSizes: ['w300', 'w780', 'w1280'],
    widthDescriptorMap: { w300: 300, w780: 780, w1280: 1280 },
    sizesAttr: '(max-width: 640px) 100vw, (max-width: 1280px) 96vw, 1280px',
    defaultFallbackWidth: 1280,
    defaultFallbackHeight: 720,
  },
  backdrop_card: {
    defaultSize: 'w780',
    srcSetSizes: ['w300', 'w780'],
    widthDescriptorMap: { w300: 300, w780: 780 },
    sizesAttr: '(max-width: 640px) 92vw, 780px',
    defaultFallbackWidth: 780,
    defaultFallbackHeight: 439,
  },
  backdrop_detail: {
    defaultSize: 'w1280',
    srcSetSizes: ['w780', 'w1280'],
    widthDescriptorMap: { w780: 780, w1280: 1280 },
    sizesAttr: '(max-width: 768px) 100vw, 1280px',
    defaultFallbackWidth: 1280,
    defaultFallbackHeight: 720,
  },
  hero_thumb: {
    defaultSize: 'w185',
    srcSetSizes: ['w92', 'w154', 'w185'],
    widthDescriptorMap: { w92: 92, w154: 154, w185: 185 },
    sizesAttr: '72px',
    defaultFallbackWidth: 185,
    defaultFallbackHeight: 278,
  },
  episode_thumb: {
    defaultSize: 'w300',
    srcSetSizes: ['w185', 'w300'],
    widthDescriptorMap: { w185: 185, w300: 300 },
    sizesAttr: '(max-width: 640px) 45vw, 300px',
    defaultFallbackWidth: 300,
    defaultFallbackHeight: 169,
  },
  cast_avatar: {
    defaultSize: 'w185',
    srcSetSizes: ['w45', 'w185'],
    widthDescriptorMap: { w45: 45, w185: 185 },
    sizesAttr: '96px',
    defaultFallbackWidth: 185,
    defaultFallbackHeight: 278,
  },
  admin_thumb: {
    defaultSize: 'w185',
    srcSetSizes: ['w92', 'w185'],
    widthDescriptorMap: { w92: 92, w185: 185 },
    sizesAttr: '72px',
    defaultFallbackWidth: 185,
    defaultFallbackHeight: 278,
  },
};

const TMDB_PATH_ONLY_REGEX = /^\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/i;
const TMDB_HOST_REGEX = /^https?:\/\/(?:image\.tmdb\.org|www\.themoviedb\.org)\/t\/p\//i;
const TMDB_SEGMENT_REGEX = /\/t\/p\/(?:w\d+|h\d+|original)\//i;

export function isTmdbRelativePath(rawUrl?: string | null): boolean {
  const clean = String(rawUrl || '').trim();
  if (!clean) return false;
  if (
    clean.startsWith('/src/') ||
    clean.startsWith('/assets/') ||
    clean.startsWith('/uploads/') ||
    clean.startsWith('/public/')
  ) {
    return false;
  }
  return TMDB_PATH_ONLY_REGEX.test(clean);
}

export function isTmdbImageUrl(rawUrl?: string | null): boolean {
  const clean = String(rawUrl || '').trim();
  if (!clean) return false;
  return TMDB_HOST_REGEX.test(clean) || isTmdbRelativePath(clean);
}

/**
 * Safely transforms a TMDB absolute URL or relative path to the desired TMDB configuration size.
 * Non-TMDB URLs (local assets, /uploads, data URIs, custom hosts) are returned completely untouched.
 */
export function normalizeTmdbUrl(rawUrl?: string | null, size: TmdbDisplaySize = 'w342'): string {
  const clean = String(rawUrl || '').trim();
  if (!clean) return '';

  if (isTmdbRelativePath(clean)) {
    return `${TMDB_IMAGE_CONFIG.secureBaseUrl}${size}${clean}`;
  }

  if (TMDB_HOST_REGEX.test(clean)) {
    const httpsClean = clean.replace(/^http:\/\//i, 'https://');
    if (TMDB_SEGMENT_REGEX.test(httpsClean)) {
      return httpsClean.replace(TMDB_SEGMENT_REGEX, `/t/p/${size}/`);
    }
    return httpsClean;
  }

  return clean;
}

/**
 * Resolves a single optimized URL for a specific display slot.
 * Never returns /t/p/original/ for frontend display slots.
 */
export function resolveImageForSlot(rawUrl?: string | null, slot: ImageSlotType = 'card_grid'): string {
  const spec = IMAGE_SLOT_SPECS[slot] || IMAGE_SLOT_SPECS.card_grid;
  return normalizeTmdbUrl(rawUrl, spec.defaultSize);
}

/**
 * Builds an HTML srcset attribute exclusively using validated TMDB configuration sizes.
 * Returns undefined for non-TMDB assets so browsers do not double-fetch identical URLs.
 */
export function buildSlotSrcSet(
  rawUrl?: string | null,
  slot: ImageSlotType = 'card_grid'
): string | undefined {
  const clean = String(rawUrl || '').trim();
  if (!isTmdbImageUrl(clean)) return undefined;

  const spec = IMAGE_SLOT_SPECS[slot] || IMAGE_SLOT_SPECS.card_grid;
  const entries: string[] = [];
  const seen = new Set<string>();

  for (const sz of spec.srcSetSizes) {
    const widthDesc = spec.widthDescriptorMap[sz];
    if (!widthDesc) continue;
    const url = normalizeTmdbUrl(clean, sz);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    entries.push(`${url} ${widthDesc}w`);
  }

  return entries.length > 0 ? entries.join(', ') : undefined;
}

export function getSlotSizesAttr(slot: ImageSlotType = 'card_grid'): string {
  return (IMAGE_SLOT_SPECS[slot] || IMAGE_SLOT_SPECS.card_grid).sizesAttr;
}

/**
 * Central entrypoint matching either a slot key or explicit TMDB display size.
 */
export function optimizeImageUrl(
  rawUrl?: string | null,
  slotOrSize: ImageSlotType | TmdbDisplaySize = 'card_grid'
): string {
  if (slotOrSize in IMAGE_SLOT_SPECS) {
    return resolveImageForSlot(rawUrl, slotOrSize as ImageSlotType);
  }
  return normalizeTmdbUrl(rawUrl, slotOrSize as TmdbDisplaySize);
}

/* ---------------- Bounded Failed Image URL Cache (No Infinite Retry Loops) ---------------- */
const MAX_FAILED_URL_CACHE = 300;
const failedImageUrlCache = new Map<string, number>();

export function isImageUrlFailed(url?: string | null): boolean {
  const key = String(url || '').trim();
  if (!key) return false;
  return failedImageUrlCache.has(key);
}

export function markImageUrlFailed(url?: string | null): void {
  const key = String(url || '').trim();
  if (!key) return;
  if (failedImageUrlCache.has(key)) {
    failedImageUrlCache.delete(key);
  } else if (failedImageUrlCache.size >= MAX_FAILED_URL_CACHE) {
    const oldestKey = failedImageUrlCache.keys().next().value;
    if (oldestKey) failedImageUrlCache.delete(oldestKey);
  }
  failedImageUrlCache.set(key, Date.now());
}

export function clearFailedImageUrls(): void {
  failedImageUrlCache.clear();
}

export function getFailedImageUrlCacheSize(): number {
  return failedImageUrlCache.size;
}
