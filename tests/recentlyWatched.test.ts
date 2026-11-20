import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  buildRecentlyWatchedId,
  buildRecentlyWatchedPayload,
  clearAllRecentlyWatchedEntries,
  formatRelativeArabicTime,
  listRecentlyWatchedItems,
  recordRecentlyWatchedPlayback,
  removeRecentlyWatchedEntry,
} from '../src/lib/recentlyWatched';
import type { MediaItem } from '../src/types/media';

function createMockMedia(id: string, title: string, kind: MediaItem['kind'] = 'movie'): MediaItem {
  return {
    id,
    slug: id,
    title,
    englishTitle: `Title ${id}`,
    kind,
    categories: ['افلام'],
    genres: ['أكشن'],
    year: '2026',
    country: 'مصر',
    language: 'العربية',
    quality: '1080p',
    duration: '120د',
    imdb: 8.5,
    votes: '250',
    views: 500,
    likes: 40,
    pinned: false,
    isNew: true,
    comingSoon: false,
    poster: 'https://image.tmdb.org/t/p/w342/sample.jpg',
    backdrop: 'https://image.tmdb.org/t/p/w780/sample-bg.jpg',
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
}

test('Recently Watched records playback, deduplicates by mediaId, and promotes re-watched item to top', async () => {
  await clearAllRecentlyWatchedEntries({ userId: 'guest', isSignedIn: false });

  const movieA = createMockMedia('movie-a', 'الفيلم الأول', 'movie');
  const seriesB = createMockMedia('series-b', 'المسلسل الثاني', 'series');

  await recordRecentlyWatchedPlayback({
    userId: 'guest',
    isSignedIn: false,
    media: movieA,
    positionSec: 120,
    durationSec: 600,
    lastServerIndex: 0,
    reason: 'start',
  });

  // Small delay ensures monotonically greater timestamp for seriesB
  await new Promise((r) => setTimeout(r, 8));

  await recordRecentlyWatchedPlayback({
    userId: 'guest',
    isSignedIn: false,
    media: seriesB,
    seasonNumber: 1,
    episodeNumber: 3,
    episodeTitle: 'الحلقة الثالثة',
    positionSec: 300,
    durationSec: 2400,
    lastServerIndex: 1,
    reason: 'start',
  });

  let items = listRecentlyWatchedItems({ userId: 'guest', isSignedIn: false });
  assert.equal(items.length, 2);
  assert.equal(items[0].mediaId, 'series-b');
  assert.equal(items[0].episodeNumber, 3);
  assert.equal(items[1].mediaId, 'movie-a');

  await new Promise((r) => setTimeout(r, 8));

  // Re-watching movie-a updates it without creating duplicate rows and moves it to top
  await recordRecentlyWatchedPlayback({
    userId: 'guest',
    isSignedIn: false,
    media: movieA,
    positionSec: 590,
    durationSec: 600,
    lastServerIndex: 2,
    reason: 'heartbeat',
  });

  items = listRecentlyWatchedItems({ userId: 'guest', isSignedIn: false });
  assert.equal(items.length, 2);
  assert.equal(items[0].mediaId, 'movie-a');
  assert.equal(items[0].completed, true);
  assert.equal(items[0].lastServerIndex, 2);

  // Hide completed filters out movie-a
  const incompleteOnly = listRecentlyWatchedItems({
    userId: 'guest',
    isSignedIn: false,
    hideCompleted: true,
  });
  assert.equal(incompleteOnly.length, 1);
  assert.equal(incompleteOnly[0].mediaId, 'series-b');

  // Remove single item cleanly
  await removeRecentlyWatchedEntry({ mediaId: 'series-b', userId: 'guest', isSignedIn: false });
  const afterRemove = listRecentlyWatchedItems({ userId: 'guest', isSignedIn: false });
  assert.equal(afterRemove.length, 1);
  assert.equal(afterRemove[0].mediaId, 'movie-a');

  await clearAllRecentlyWatchedEntries({ userId: 'guest', isSignedIn: false });
  assert.equal(listRecentlyWatchedItems({ userId: 'guest', isSignedIn: false }).length, 0);
});

test('Recently Watched builds deterministic IDs and signed-in listing respects strict user isolation', async () => {
  await clearAllRecentlyWatchedEntries({ userId: 'user_A', isSignedIn: false });

  assert.equal(buildRecentlyWatchedId({ userId: 'user_A', mediaId: 'film_1' }), 'user_A__film_1');

  const payload = buildRecentlyWatchedPayload({
    userId: 'user_A',
    media: createMockMedia('film_1', 'عمل'),
    positionSec: 950,
    durationSec: 1000,
  });
  assert.equal(payload.progressPct, 95);
  assert.equal(payload.completed, true);

  const cloudA = buildRecentlyWatchedPayload({
    userId: 'user_A',
    media: createMockMedia('film_a', 'عمل المستخدم A'),
  });
  const cloudB = buildRecentlyWatchedPayload({
    userId: 'user_B',
    media: createMockMedia('film_b', 'عمل المستخدم B'),
  });

  const visibleToA = listRecentlyWatchedItems({
    userId: 'user_A',
    isSignedIn: true,
    cloudRecords: [cloudA, cloudB],
  });
  assert.equal(visibleToA.length, 1);
  assert.equal(visibleToA[0].mediaId, 'film_a');

  assert.equal(formatRelativeArabicTime(Date.now()), 'منذ لحظات');
});

test('Opening details page (SingleDetailView) NEVER records into Recently Watched', () => {
  const detailPath = path.resolve(process.cwd(), 'src/components/SingleDetailView.tsx');
  const detailSource = fs.readFileSync(detailPath, 'utf8');
  assert.equal(detailSource.includes('recordRecentlyWatchedPlayback'), false);

  const playerPath = path.resolve(process.cwd(), 'src/components/Modals.tsx');
  const playerSource = fs.readFileSync(playerPath, 'utf8');
  assert.equal(playerSource.includes('recordRecentlyWatchedPlayback'), true);
});
