import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import test from 'node:test';

registerHooks({
  load(url, context, nextLoad) {
    if (/\.(jpg|jpeg|png|webp|svg)$/i.test(url)) {
      return {
        format: 'module',
        shortCircuit: true,
        source: `export default ${JSON.stringify(url)};`,
      };
    }
    return nextLoad(url, context);
  },
});

import {
  buildSlotSrcSet,
  clearFailedImageUrl,
  clearFailedImageUrls,
  clearLoadedImageUrls,
  getFailedImageUrlCacheSize,
  getSlotSizesAttr,
  isImageUrlCachedSuccess,
  isImageUrlFailed,
  isTmdbImageUrl,
  isTmdbRelativePath,
  markImageUrlFailed,
  markImageUrlLoaded,
  normalizeTmdbUrl,
  optimizeImageUrl,
  resolveImageForSlot,
  TMDB_IMAGE_CONFIG,
} from '../src/lib/imageOptimizer';
import {
  buildPlaceholderSurfaceBackground,
  DEFAULT_IMAGE_PLACEHOLDER_CONFIG,
  normalizeImagePlaceholderConfig,
  resolveEffectivePlaceholderForSlot,
  sanitizePlaceholderConfigForFirestore,
} from '../src/lib/placeholderConfig';
import { computeScaledDimensions, sanitizeSvgContent } from '../src/lib/imageCompressor';
import type { MediaItem } from '../src/types/media';

const {
  buildBackdropSrcSet,
  buildPosterSrcSet,
  getBackdropUrl,
  getHeroThumbUrl,
  getPosterUrl,
  optimizeTmdbUrl,
} = await import('../src/lib/mediaImages');

test('TMDB optimizer converts relative paths and /original/ URLs into real TMDB configuration sizes', () => {
  assert.equal(isTmdbRelativePath('/abc123XYZ.jpg'), true);
  assert.equal(isTmdbRelativePath('/assets/images/poster.jpg'), false);
  assert.equal(isTmdbImageUrl('/abc123XYZ.jpg'), true);

  assert.equal(
    normalizeTmdbUrl('/abc123XYZ.jpg', 'w342'),
    'https://image.tmdb.org/t/p/w342/abc123XYZ.jpg'
  );
  assert.equal(
    normalizeTmdbUrl('http://image.tmdb.org/t/p/original/abc123XYZ.jpg', 'w500'),
    'https://image.tmdb.org/t/p/w500/abc123XYZ.jpg'
  );

  // Never emits /original/ across any frontend display slot
  const slots = [
    'card_small',
    'card_grid',
    'detail_poster',
    'slider_backdrop',
    'backdrop_card',
    'backdrop_detail',
    'hero_thumb',
    'episode_thumb',
    'cast_avatar',
    'admin_thumb',
  ] as const;
  for (const slot of slots) {
    const resolved = resolveImageForSlot('https://image.tmdb.org/t/p/original/demo.jpg', slot);
    assert.equal(resolved.includes('/original/'), false, `Slot ${slot} leaked /original/`);
  }

  // Matches official TMDB config arrays
  assert.equal(TMDB_IMAGE_CONFIG.posterSizes.includes('w342'), true);
  assert.equal(TMDB_IMAGE_CONFIG.backdropSizes.includes('w1280'), true);
  assert.equal(TMDB_IMAGE_CONFIG.stillSizes.includes('w300'), true);
  assert.equal(TMDB_IMAGE_CONFIG.profileSizes.includes('w185'), true);
});

test('TMDB optimizer preserves non-TMDB assets, data URLs, and local uploads untouched', () => {
  const customCdn = 'https://cdn.example.com/posters/movie-original.jpg';
  const localUpload = '/uploads/posters/custom_123.webp';
  const dataUri = 'data:image/webp;base64,UklGRh4AAABXRUJQ';

  assert.equal(optimizeImageUrl(customCdn, 'card_grid'), customCdn);
  assert.equal(optimizeImageUrl(localUpload, 'detail_poster'), localUpload);
  assert.equal(optimizeImageUrl(dataUri, 'cast_avatar'), dataUri);
  assert.equal(buildSlotSrcSet(customCdn, 'card_grid'), undefined);
  assert.equal(buildSlotSrcSet(localUpload, 'backdrop_detail'), undefined);
});

test('srcSet and sizes builders produce responsive TMDB candidates without /original/', () => {
  const srcSet = buildSlotSrcSet('https://image.tmdb.org/t/p/original/poster.jpg', 'card_grid');
  assert.ok(srcSet);
  assert.equal(srcSet.includes('w185/poster.jpg 185w'), true);
  assert.equal(srcSet.includes('w342/poster.jpg 342w'), true);
  assert.equal(srcSet.includes('w500/poster.jpg 500w'), true);
  assert.equal(srcSet.includes('/original/'), false);

  const sizes = getSlotSizesAttr('card_grid');
  assert.ok(sizes.includes('46vw'));

  const media: MediaItem = {
    id: 'test-1',
    slug: 'test-1',
    title: 'فيلم تجريبي',
    englishTitle: 'Test Movie',
    kind: 'movie',
    categories: ['افلام'],
    genres: ['أكشن'],
    year: '2026',
    country: 'مصر',
    language: 'العربية',
    quality: '1080p',
    duration: '120د',
    imdb: 8.2,
    votes: '100',
    views: 100,
    likes: 10,
    pinned: false,
    isNew: true,
    comingSoon: false,
    poster: 'https://image.tmdb.org/t/p/original/p1.jpg',
    backdrop: 'https://image.tmdb.org/t/p/original/b1.jpg',
    tagline: '',
    story: 'قصة',
    shortUrl: '',
    trailerLabel: '',
    trailerDuration: '',
    cast: [],
    seasons: [],
    franchiseIds: [],
    servers: [],
    downloads: [],
  };

  assert.equal(getPosterUrl(media, 'card_grid'), 'https://image.tmdb.org/t/p/w342/p1.jpg');
  assert.equal(getPosterUrl(media, 'detail_poster'), 'https://image.tmdb.org/t/p/w500/p1.jpg');
  assert.equal(getHeroThumbUrl(media), 'https://image.tmdb.org/t/p/w185/p1.jpg');
  assert.equal(getBackdropUrl(media, 'slider_backdrop'), 'https://image.tmdb.org/t/p/w1280/b1.jpg');
  assert.equal(optimizeTmdbUrl(media.poster, 'w342'), 'https://image.tmdb.org/t/p/w342/p1.jpg');
  assert.ok(buildPosterSrcSet(media.poster, 'detail_poster')?.includes('500w'));
  assert.ok(buildBackdropSrcSet(media.backdrop, 'slider_backdrop')?.includes('1280w'));
});

test('FailedUrlCache stays bounded at 300 entries to prevent memory leaks', () => {
  clearFailedImageUrls();
  for (let i = 0; i < 360; i++) {
    markImageUrlFailed(`https://example.com/broken-${i}.jpg`);
  }
  assert.equal(getFailedImageUrlCacheSize(), 300);
  assert.equal(isImageUrlFailed('https://example.com/broken-0.jpg'), false);
  assert.equal(isImageUrlFailed('https://example.com/broken-359.jpg'), true);
  clearFailedImageUrls();
});

test('ImagePlaceholderConfig normalizes bounds, keeps loading vs error images independent, and sanitizes for Firestore', () => {
  const cfg = normalizeImagePlaceholderConfig({
    ...DEFAULT_IMAGE_PLACEHOLDER_CONFIG,
    mode: 'custom_image',
    primaryColor: '#abc',
    secondaryColor: 'invalid-color',
    gradientAngle: 999,
    logoOverlayOpacityPct: 2,
    backdropDimPct: 95,
    customImageUrl: '/uploads/loading-custom.webp',
    errorFallbackImageUrl: '/uploads/error-custom.webp',
    slotOverrides: {
      ...DEFAULT_IMAGE_PLACEHOLDER_CONFIG.slotOverrides,
      cast: {
        ...DEFAULT_IMAGE_PLACEHOLDER_CONFIG.slotOverrides.cast,
        enabled: true,
        mode: 'solid',
        primaryColor: '#112233',
        customImageUrl: 'local-image://cache_1',
        errorFallbackImageUrl: '/uploads/cast-fallback.webp',
      },
    },
  });

  assert.equal(cfg.primaryColor, '#aabbcc');
  assert.equal(cfg.secondaryColor, DEFAULT_IMAGE_PLACEHOLDER_CONFIG.secondaryColor);
  assert.equal(cfg.gradientAngle, 360);
  assert.equal(cfg.logoOverlayOpacityPct, 5);
  assert.equal(cfg.backdropDimPct, 85);
  assert.notEqual(cfg.customImageUrl, cfg.errorFallbackImageUrl);

  const castAppearance = resolveEffectivePlaceholderForSlot(cfg, 'cast_avatar');
  assert.equal(castAppearance.mode, 'solid');
  assert.equal(castAppearance.shimmerEnabled, false);
  assert.equal(castAppearance.errorFallbackImageUrl, '/uploads/cast-fallback.webp');
  assert.equal(buildPlaceholderSurfaceBackground(castAppearance), '#112233');

  const firestoreSafe = sanitizePlaceholderConfigForFirestore(cfg);
  assert.equal(firestoreSafe.slotOverrides.cast.customImageUrl, '');
  assert.equal(firestoreSafe.slotOverrides.cast.errorFallbackImageUrl, '/uploads/cast-fallback.webp');
});

test('Upload helpers sanitize dangerous SVG payloads and scale dimensions cleanly', () => {
  const dirtySvg =
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>evil()</script><rect width="10" height="10"/></svg>';
  const cleanSvg = sanitizeSvgContent(dirtySvg);
  assert.equal(/<script/i.test(cleanSvg), false);
  assert.equal(/onload\s*=/i.test(cleanSvg), false);
  assert.equal(cleanSvg.includes('<rect'), true);

  const scaled = computeScaledDimensions(3840, 2160, 1920, 1080);
  assert.equal(scaled.width, 1920);
  assert.equal(scaled.height, 1080);
  assert.equal(scaled.scaledDown, true);

  const alreadySmall = computeScaledDimensions(300, 450, 1000, 1500);
  assert.equal(alreadySmall.width, 300);
  assert.equal(alreadySmall.height, 450);
  assert.equal(alreadySmall.scaledDown, false);
});

test('Component audit: zero UI components render /t/p/original/ in src/components/', () => {
  const componentsDir = path.resolve(process.cwd(), 'src/components');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) files.push(full);
    }
  };
  walk(componentsDir);

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    // Ignore input placeholder example hint string in AdminDashboardView, verify no code uses /t/p/original/
    const lines = content.split('\n').filter((line) => !line.includes('placeholder='));
    const hasOriginalLeak = lines.some((line) => /\/t\/p\/original\//i.test(line));
    assert.equal(hasOriginalLeak, false, `Found /t/p/original/ leak in ${path.basename(file)}`);
  }
});

test('TMDB optimizer repairs malformed URLs, duplicated prefixes, protocol-relative URLs, and null literals', () => {
  assert.equal(
    normalizeTmdbUrl('//image.tmdb.org/t/p/original/poster99.jpg', 'w342'),
    'https://image.tmdb.org/t/p/w342/poster99.jpg'
  );
  assert.equal(
    normalizeTmdbUrl('https://www.themoviedb.org/t/p/w500//poster99.jpg', 'w342'),
    'https://image.tmdb.org/t/p/w342/poster99.jpg'
  );
  assert.equal(
    normalizeTmdbUrl(
      'https://image.tmdb.org/t/p/w500/https://image.tmdb.org/t/p/original/poster99.jpg',
      'w342'
    ),
    'https://image.tmdb.org/t/p/w342/poster99.jpg'
  );
  assert.equal(
    normalizeTmdbUrl('https://image.tmdb.org/t/p/poster99.jpg', 'w185'),
    'https://image.tmdb.org/t/p/w185/poster99.jpg'
  );
  assert.equal(normalizeTmdbUrl('null', 'w342'), '');
  assert.equal(normalizeTmdbUrl('undefined', 'w342'), '');
});

test('FailedUrlCache expires transient failures after TTL and LoadedUrlCache tracks verified URLs', () => {
  clearFailedImageUrls();
  clearLoadedImageUrls();

  const url = 'https://image.tmdb.org/t/p/w342/transient.jpg';
  const t0 = 1_000_000;
  markImageUrlFailed(url, t0);
  assert.equal(isImageUrlFailed(url, t0 + 10_000), true);
  // After 3-minute TTL passes, transient failure clears so URL can retry cleanly
  assert.equal(isImageUrlFailed(url, t0 + 4 * 60 * 1000), false);

  markImageUrlFailed(url, t0);
  clearFailedImageUrl(url);
  assert.equal(isImageUrlFailed(url, t0 + 1000), false);

  markImageUrlLoaded(url);
  assert.equal(isImageUrlCachedSuccess(url), true);
  markImageUrlFailed(url);
  assert.equal(isImageUrlCachedSuccess(url), false);

  clearFailedImageUrls();
  clearLoadedImageUrls();
});

test('OptimizedImage & useLazyImageInView implement cache detection, safe decode(), IO roots, retry, and no empty src', () => {
  const optImgPath = path.resolve(process.cwd(), 'src/components/OptimizedImage.tsx');
  const hookPath = path.resolve(process.cwd(), 'src/hooks/useLazyImageInView.ts');

  const optImgSource = fs.readFileSync(optImgPath, 'utf8');
  const hookSource = fs.readFileSync(hookPath, 'utf8');

  // Cache check via img.complete && naturalWidth > 0 + useLayoutEffect
  assert.equal(optImgSource.includes('useLayoutEffect'), true);
  assert.equal(optImgSource.includes('img.complete'), true);
  assert.equal(optImgSource.includes('img.naturalWidth > 0'), true);

  // Safe img.decode() with .catch fallback so decode errors never block valid loaded images
  assert.equal(optImgSource.includes('img.decode'), true);
  assert.equal(optImgSource.includes('.catch('), true);

  // Bounded retry + watchdog + error fallback guard
  assert.equal(optImgSource.includes('MAX_TRANSIENT_RETRIES'), true);
  assert.equal(optImgSource.includes('REMOTE_LOAD_TIMEOUT_MS'), true);
  assert.equal(optImgSource.includes('setErrorFallbackFailed(true)'), true);

  // Uses IntersectionObserver hook cleanly and never assigns empty src=""
  assert.equal(optImgSource.includes('useLazyImageInView'), true);
  assert.equal(optImgSource.includes('{shouldLoadImage ? ('), true);
  assert.equal(optImgSource.includes('src=""'), false);

  // Hook inspects horizontal/vertical scroll containers and disconnects on activation
  assert.equal(hookSource.includes('IntersectionObserver'), true);
  assert.equal(hookSource.includes('findScrollableRoots'), true);
  assert.equal(hookSource.includes('horizontalRoot'), true);
  assert.equal(hookSource.includes('verticalRoot'), true);
  assert.equal(hookSource.includes('disconnect()'), true);
});

