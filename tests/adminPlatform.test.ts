import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_NAV_GROUPS,
  getAllAdminNavItems,
  isTabAccessible,
} from '../src/components/admin/adminNavigation';
import { DEFAULT_MODERATOR_SUB_PERMS } from '../src/lib/adminPreferences';
import { runCatalogContentAudit } from '../src/lib/contentAudit';
import { createSiteBackupPayload, validateBackupJson } from '../src/lib/backupRestore';
import { createTimeoutSignal, detectClientCapabilities } from '../src/lib/browserCompat';
import { isLikelyNonVideoWebsiteUrl } from '../src/lib/clientScraper';
import type { MediaItem, SiteSettings } from '../src/types/media';

function makeSampleItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 'item-1',
    slug: 'sample-movie',
    title: 'فيلم تجريبي',
    englishTitle: 'Sample Movie',
    kind: 'movie',
    categories: ['افلام'],
    genres: ['اكشن'],
    year: '2026',
    country: 'مصر',
    language: 'العربية',
    quality: '1080p',
    duration: '120 دقيقة',
    imdb: 8.2,
    votes: '1,200',
    views: 500,
    likes: 40,
    pinned: false,
    isNew: true,
    comingSoon: false,
    poster: 'https://cdn.example.com/poster.jpg',
    poster_url: 'https://cdn.example.com/poster.jpg',
    backdrop: 'https://cdn.example.com/backdrop.jpg',
    backdrop_url: 'https://cdn.example.com/backdrop.jpg',
    tagline: 'وصف مختصر',
    story: 'قصة تفصيلية واضحة تتجاوز عشرين حرفاً للاختبار.',
    shortUrl: 'https://rahal.tv/watch/item-1',
    trailerUrl: '',
    trailerLabel: 'التريلر',
    trailerDuration: '02:00',
    cast: [],
    seasons: [],
    franchiseIds: [],
    servers: [
      {
        id: 'srv-1',
        name: 'سيرفر 1',
        mode: 'url',
        url: 'https://cdn.example.com/embed/video-12345',
        quality: '1080p',
        speed: 'سريع',
        tag: 'HD',
      },
    ],
    downloads: [],
    ...overrides,
  };
}

const SAMPLE_SETTINGS: SiteSettings = {
  siteName: 'RahaL TV',
  tagline: 'منصة بث سينمائي',
  announcementText: '',
  tickerEnabled: false,
  maintenanceMode: false,
  maintenanceMessage: '',
  featuredLimit: 5,
};

describe('RahaL TV Admin Navigation & RBAC', () => {
  it('defines exactly 9 navigation groups and 27 unique admin tabs', () => {
    assert.equal(ADMIN_NAV_GROUPS.length, 9);
    const items = getAllAdminNavItems();
    assert.equal(items.length, 27);
    const uniqueIds = new Set(items.map((item) => item.id));
    assert.equal(uniqueIds.size, 27);
  });

  it('enforces ownerOnly restrictions and granular moderator permissions', () => {
    assert.equal(isTabAccessible('overview', true, DEFAULT_MODERATOR_SUB_PERMS), true);
    assert.equal(isTabAccessible('overview', false, DEFAULT_MODERATOR_SUB_PERMS), false);
    assert.equal(isTabAccessible('database_manager', true, DEFAULT_MODERATOR_SUB_PERMS), true);
    assert.equal(isTabAccessible('database_manager', false, DEFAULT_MODERATOR_SUB_PERMS), false);
    assert.equal(isTabAccessible('settings', false, DEFAULT_MODERATOR_SUB_PERMS), false);
    assert.equal(isTabAccessible('security_rules', false, DEFAULT_MODERATOR_SUB_PERMS), false);
    assert.equal(isTabAccessible('users', false, DEFAULT_MODERATOR_SUB_PERMS), false);

    assert.equal(isTabAccessible('catalog', false, DEFAULT_MODERATOR_SUB_PERMS), true);
    assert.equal(isTabAccessible('bulk_editor', false, DEFAULT_MODERATOR_SUB_PERMS), true);

    const restricted = {
      ...DEFAULT_MODERATOR_SUB_PERMS,
      allowBulkEditor: false,
      allowWatchServers: false,
      allowSiteScraper: false,
    };
    assert.equal(isTabAccessible('bulk_editor', false, restricted), false);
    assert.equal(isTabAccessible('categories', false, restricted), false);
    assert.equal(isTabAccessible('watch_servers', false, restricted), false);
    assert.equal(isTabAccessible('site_scraper', false, restricted), false);
    assert.equal(isTabAccessible('scraper', false, restricted), true);
  });
});

describe('Catalog Content Audit Engine', () => {
  it('detects duplicates, zero servers, suspicious URLs, incomplete episodes, and missing assets', () => {
    const items: MediaItem[] = [
      makeSampleItem({ id: 'm1', title: 'ماتريكس', englishTitle: 'Matrix', year: '1999' }),
      makeSampleItem({ id: 'm2', title: 'ماتريكس', englishTitle: 'Matrix', year: '1999' }),
      makeSampleItem({
        id: 'm3',
        title: 'بدون سيرفر',
        servers: [],
        poster: '',
        poster_url: '',
        backdrop: '',
        backdrop_url: '',
        story: '',
      }),
      makeSampleItem({
        id: 'm4',
        title: 'رابط مشبوه',
        servers: [
          {
            id: 's1',
            name: 'سيرفر',
            mode: 'url',
            url: 'https://example.com/',
            quality: '720p',
            speed: 'سريع',
            tag: 'HD',
          },
        ],
      }),
      makeSampleItem({
        id: 's1',
        title: 'مسلسل ناقص',
        kind: 'series',
        servers: [],
        seasons: [
          {
            seasonNumber: 1,
            label: 'الموسم الأول',
            year: '2026',
            episodes: [
              { number: 1, title: 'الحلقة 1', duration: '40د', quality: 'HD', servers: [] },
              { number: 3, title: 'الحلقة 3', duration: '40د', quality: 'HD', servers: [] },
            ],
          },
        ],
      }),
    ];

    const report = runCatalogContentAudit(items);
    assert.equal(report.scannedCount, 5);
    assert.ok(report.countsByCategory.duplicate >= 2);
    assert.ok(report.countsByCategory.zero_servers >= 1);
    assert.ok(report.countsByCategory.suspicious_server_url >= 1);
    assert.ok(report.countsByCategory.incomplete_episodes >= 1);
    assert.ok(report.countsByCategory.missing_media_assets >= 1);
  });
});

describe('Backup Payload & Integrity Validation', () => {
  it('creates signed backup JSON, warns on tampered checksums, and rejects malformed payloads', () => {
    const media = [makeSampleItem()];
    const payload = createSiteBackupPayload({
      settings: SAMPLE_SETTINGS,
      media,
      adapters: [],
      requests: [],
    });

    const json = JSON.stringify(payload);
    const validResult = validateBackupJson(json, []);
    assert.equal(validResult.valid, true);
    assert.equal(validResult.errors.length, 0);
    assert.equal(validResult.diff?.newItemsCount, 1);

    const tampered = { ...payload, checksum: 'fnv1a_deadbeef' };
    const tamperedResult = validateBackupJson(JSON.stringify(tampered), media);
    assert.equal(tamperedResult.valid, true);
    assert.ok(tamperedResult.warnings.length > 0);
    assert.equal(tamperedResult.diff?.updatedItemsCount, 1);

    const brokenResult = validateBackupJson('{"schemaVersion":2,"data":{}}', media);
    assert.equal(brokenResult.valid, false);
    assert.ok(brokenResult.errors.length > 0);
  });
});

describe('Browser Compatibility & URL Sanitization Helpers', () => {
  it('detects client capabilities safely in non-DOM runtimes and creates AbortSignals', () => {
    const caps = detectClientCapabilities();
    assert.equal(typeof caps.baselineSupported, 'boolean');
    assert.equal(typeof caps.browserName, 'string');

    const { signal, cleanup } = createTimeoutSignal(500);
    assert.equal(signal.aborted, false);
    cleanup();
  });

  it('flags portal/website root URLs while allowing genuine embed/stream URLs', () => {
    assert.equal(isLikelyNonVideoWebsiteUrl('https://example.com/'), true);
    assert.equal(isLikelyNonVideoWebsiteUrl('https://vidstream.example.com/embed-abc123.html'), false);
    assert.equal(isLikelyNonVideoWebsiteUrl('https://cdn.example.com/hls/master.m3u8'), false);
  });
});
