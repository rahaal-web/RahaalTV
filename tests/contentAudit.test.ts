import test from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicateGroups, scoreMediaCompleteness } from '../src/lib/contentAudit';
import { MediaItem } from '../src/types/media';

function makeMedia(overrides: Partial<MediaItem>): MediaItem {
  return {
    id: 'item-1',
    slug: 'item-1',
    title: 'فيلم تجريبي',
    englishTitle: 'Test Movie',
    kind: 'movie',
    categories: ['افلام'],
    genres: ['دراما'],
    year: '2025',
    country: 'الولايات المتحدة',
    language: 'مترجم',
    quality: '1080p',
    duration: '120 دقيقة',
    imdb: 7.5,
    votes: '100',
    views: 500,
    likes: 20,
    pinned: false,
    isNew: true,
    comingSoon: false,
    poster: 'https://example.com/poster.jpg',
    backdrop: 'https://example.com/backdrop.jpg',
    tagline: '',
    story: 'قصة طويلة بما يكفي لتجاوز عشرين حرفاً في الاختبار.',
    shortUrl: '',
    trailerUrl: '',
    trailerLabel: '',
    trailerDuration: '',
    cast: [],
    seasons: [],
    franchiseIds: [],
    servers: [],
    downloads: [],
    ...overrides,
  };
}

test('findDuplicateGroups detects duplicate items and marks the most complete version to keep', () => {
  const weakCopy = makeMedia({
    id: 'dup-weak',
    title: 'الهروب الكبير',
    englishTitle: 'The Great Escape',
    year: '2025',
    servers: [],
    views: 100,
  });
  const strongCopy = makeMedia({
    id: 'dup-strong',
    title: 'الهروب  الكبير!',
    englishTitle: 'The Great Escape',
    year: '2025',
    servers: [
      {
        id: 's1',
        name: 'سيرفر 1',
        mode: 'url',
        url: 'https://cdn.example.com/video.mp4',
        quality: '1080p',
        speed: 'سريع',
        tag: 'HD',
      },
      {
        id: 's2',
        name: 'سيرفر 2',
        mode: 'url',
        url: 'https://cdn.example.com/video2.mp4',
        quality: '720p',
        speed: 'سريع',
        tag: 'HD',
      },
    ],
    views: 2500,
  });
  const uniqueItem = makeMedia({
    id: 'unique-1',
    title: 'عمل مختلف تماماً',
    englishTitle: 'Another Film',
    year: '2025',
  });

  const groups = findDuplicateGroups([weakCopy, strongCopy, uniqueItem]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].keepId, 'dup-strong');
  assert.deepEqual(groups[0].extraIds, ['dup-weak']);
  assert.ok(scoreMediaCompleteness(strongCopy) > scoreMediaCompleteness(weakCopy));
});

test('findDuplicateGroups respects ignoreYear option for cross-year title matches', () => {
  const copy2024 = makeMedia({
    id: 'copy-2024',
    title: 'مسلسل الرحلة',
    englishTitle: 'The Journey',
    kind: 'series',
    year: '2024',
  });
  const copy2026 = makeMedia({
    id: 'copy-2026',
    title: 'مسلسل الرحلة',
    englishTitle: 'The Journey',
    kind: 'series',
    year: '2026',
  });

  assert.equal(findDuplicateGroups([copy2024, copy2026], { ignoreYear: false }).length, 0);
  const crossYear = findDuplicateGroups([copy2024, copy2026], { ignoreYear: true });
  assert.equal(crossYear.length, 1);
  assert.equal(crossYear[0].matchReason, 'title_cross_year');
});
