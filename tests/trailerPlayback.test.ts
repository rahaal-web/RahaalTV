import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  buildTrailerSearchQueryUrl,
  extractYouTubeVideoId,
  parseTrailerPlaybackUrl,
} from '../src/lib/trailerUtils';

test('extractYouTubeVideoId and parseTrailerPlaybackUrl handle all YouTube formats', () => {
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch?v=t8Qa4vUQs9E'), 't8Qa4vUQs9E');
  assert.equal(
    extractYouTubeVideoId('https://m.youtube.com/watch?feature=shared&v=xBhXiktP-CA&t=12s'),
    'xBhXiktP-CA'
  );
  assert.equal(extractYouTubeVideoId('https://youtu.be/aBJICCgUCXg?si=abc123'), 'aBJICCgUCXg');
  assert.equal(
    extractYouTubeVideoId('https://www.youtube.com/embed/f5y-cziwmMw?autoplay=0'),
    'f5y-cziwmMw'
  );
  assert.equal(
    extractYouTubeVideoId('https://www.youtube-nocookie.com/embed/cctvSNDaaYs'),
    'cctvSNDaaYs'
  );
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/shorts/CJh6qIvxOoc'), 'CJh6qIvxOoc');
  assert.equal(extractYouTubeVideoId('//www.youtube.com/live/nTOf1FIsBcs'), 'nTOf1FIsBcs');

  const watchParsed = parseTrailerPlaybackUrl('https://www.youtube.com/watch?v=t8Qa4vUQs9E');
  assert.deepEqual(watchParsed, {
    kind: 'iframe',
    src: 'https://www.youtube.com/embed/t8Qa4vUQs9E?autoplay=1&rel=0',
    watchUrl: 'https://www.youtube.com/watch?v=t8Qa4vUQs9E',
    isYouTube: true,
    youtubeId: 't8Qa4vUQs9E',
  });

  const directVideo = parseTrailerPlaybackUrl('https://cdn.example.com/trailers/promo.mp4?token=1');
  assert.deepEqual(directVideo, {
    kind: 'video',
    src: 'https://cdn.example.com/trailers/promo.mp4?token=1',
    watchUrl: 'https://cdn.example.com/trailers/promo.mp4?token=1',
    isYouTube: false,
  });

  assert.equal(parseTrailerPlaybackUrl(''), null);
  assert.equal(parseTrailerPlaybackUrl('javascript:alert(1)'), null);
});

test('buildTrailerSearchQueryUrl strips quality noise and constructs safe YouTube search link', () => {
  const arUrl = buildTrailerSearchQueryUrl({
    title: 'فيلم فاميلي بيزنس (2026) HD',
    year: '2026',
    kind: 'movie',
  });
  const decodedAr = decodeURIComponent(arUrl);
  assert.equal(arUrl.startsWith('https://www.youtube.com/results?search_query='), true);
  assert.equal(decodedAr.includes('فاميلي بيزنس'), true);
  assert.equal(decodedAr.includes('HD'), false);

  const enSeriesUrl = buildTrailerSearchQueryUrl({
    title: 'مسلسل باب السرايا',
    englishTitle: 'Bab Al Saraya',
    year: '2026',
    kind: 'series',
  });
  const decodedEn = decodeURIComponent(enSeriesUrl);
  assert.equal(decodedEn.includes('Bab Al Saraya 2026 series official trailer'), true);
});

test('SingleDetailView keeps trailer buttons layered above OptimizedImage and gradient scrim', () => {
  const optimizedImgSrc = fs.readFileSync(
    path.resolve('src/components/OptimizedImage.tsx'),
    'utf8'
  );
  assert.equal(
    optimizedImgSrc.includes('relative isolate overflow-hidden'),
    true,
    'OptimizedImage root must isolate stacking context so internal z-10 img does not cover sibling overlays'
  );

  const detailSrc = fs.readFileSync(
    path.resolve('src/components/SingleDetailView.tsx'),
    'utf8'
  );
  const trailerBtns = detailSrc.match(/onClick=\{\(\) => onOpenTrailer\(item\)\}/g) || [];
  assert.equal(
    trailerBtns.length >= 3,
    true,
    'SingleDetailView should render poster play button, poster pill button, and action card trailer button'
  );
  assert.equal(
    detailSrc.includes('inset-0 z-20 m-auto'),
    true,
    'Centered poster trailer button must have z-20 above the z-10 gradient overlay'
  );
  assert.equal(
    detailSrc.includes('bottom-3 left-1/2 z-20 -translate-x-1/2'),
    true,
    'Bottom poster trailer pill button must have z-20 above the z-10 gradient overlay'
  );
});

test('TrailerModal supports automatic fallback lookup and safe YouTube embed referrer policy', () => {
  const modalsSrc = fs.readFileSync(path.resolve('src/components/Modals.tsx'), 'utf8');
  assert.equal(modalsSrc.includes('parseTrailerPlaybackUrl('), true);
  assert.equal(modalsSrc.includes('findTrailerInBrowser('), true);
  assert.equal(modalsSrc.includes('referrerPolicy="strict-origin-when-cross-origin"'), true);
});
