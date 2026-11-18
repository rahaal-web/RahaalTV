import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAdapterIdFromDomain,
  createDefaultScraperAdapter,
  exportAdaptersBundleJson,
  matchAdapterForUrl,
  normalizeAdapterDomain,
  parseImportedAdaptersJson,
} from '../src/lib/scraperAdapterUtils';
import {
  analyzeSiteStructure,
  BaselineParseFn,
  detectProtectionChallenge,
  executeAdapterScrape,
  isBlockedHostEnhanced,
  testAdapterCandidate,
} from '../server/scraperAdapterEngine';

const makeMockBaselineParse: (overrides?: {
  baselineServers?: { id: string; name: string; url: string }[];
  baselineEpisodeCount?: number;
}) => BaselineParseFn =
  (overrides) =>
  (_html, sourceUrl) => {
    const epCount = overrides?.baselineEpisodeCount ?? 0;
    const episodes = Array.from({ length: epCount }, (_, i) => ({
      number: i + 1,
      title: `الحلقة ${i + 1}`,
      duration: '42 دقيقة',
      quality: 'HD',
      watchUrl: `${sourceUrl}`,
      servers: [],
    }));
    const srvs = (overrides?.baselineServers || []).map((s) => ({
      id: s.id,
      name: s.name,
      mode: 'url' as const,
      url: s.url,
      embedCode: '',
      quality: '1080p',
      speed: 'سريع',
      tag: 'HD',
    }));

    return {
      media: {
        title: 'مسلسل تجريبي متعدد المواسم',
        englishTitle: 'Multi Season Test Series',
        kind: epCount > 0 ? 'series' : 'movie',
        categories: ['مسلسلات'],
        genres: ['دراما', 'إثارة'],
        year: '2026',
        country: 'الولايات المتحدة',
        language: 'مترجم للعربية',
        quality: '1080p',
        duration: '45 دقيقة',
        imdb: 8.2,
        poster: 'https://cdn.example.com/poster.jpg',
        backdrop: '',
        story: 'قصة تجريبية لاختبار محرك تحليل المصادر واستخراج المواسم والحلقات.',
        sourceUrl,
        trailerUrl: '',
        cast: [],
        servers: srvs,
        downloads: [],
        seasons:
          episodes.length > 0
            ? [{ seasonNumber: 1, label: 'الموسم 1', year: '2026', episodes }]
            : [],
      },
      hints: {
        ajaxEmbedIds: [],
        candidateOrigins: [],
      },
    };
  };

const FFOSTA_STYLE_HTML = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <title>مشاهدة مسلسل الإمبراطورية - ffosta-tv.baby</title>
  <meta name="description" content="قصة المسلسل الكاملة" />
</head>
<body>
  <div class="pm-ads-banner">
    <a class="btnDowns" href="https://ffosta-tv.baby/watch.php?vid=70C19e669">تحميل مباشر إعلان</a>
  </div>

  <a class="xtgo" href="https://ffosta-tv.baby/play.php?vid=374905744">شاهد الآن</a>

  <ul class="WatchList">
    <li class="active" data-embed-url="https://1vid.examplecdn.net/embed-a111.html">1vid</li>
    <li data-embed-url="https://vk.com/video_ext.php?oid=1&id=2">Vk</li>
    <li data-embed-url="https://ok.ru/videoembed/987654321">Ok</li>
    <li data-embed-url="https://vidmoly.to/embed-z999.html">Vidmoly</li>
  </ul>

  <iframe src="https://1vid.examplecdn.net/embed-a111.html" allowfullscreen></iframe>

  <div class="SeasonsList">
    <button class="tablinks active" data-season="1">الموسم الأول</button>
    <button class="tablinks" data-season="2">الموسم الثاني</button>
    <button class="tablinks" data-season="3">الموسم الثالث</button>
  </div>

  <div id="Season1" class="tabcontent">
    ${Array.from({ length: 7 }, (_, i) => `<a href="https://ffosta-tv.baby/play.php?vid=10${i + 1}">${i + 1}حلقة</a>`).join('\n')}
  </div>
  <div id="Season2" class="tabcontent">
    ${Array.from({ length: 7 }, (_, i) => `<a href="https://ffosta-tv.baby/play.php?vid=20${i + 1}">${i + 1}حلقة</a>`).join('\n')}
  </div>
  <div id="Season3" class="tabcontent">
    ${Array.from({ length: 7 }, (_, i) => `<a href="https://ffosta-tv.baby/play.php?vid=30${i + 1}">${i + 1}حلقة</a>`).join('\n')}
  </div>
</body>
</html>`;

async function withMockedFetch<T>(
  mockFn: (url: string) => { ok?: boolean; status?: number; body: string },
  run: () => Promise<T>
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const targetUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const res = mockFn(targetUrl);
    return new Response(res.body, {
      status: res.status ?? (res.ok === false ? 500 : 200),
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }) as typeof fetch;

  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('Domain normalization, ID generation, matching & JSON export/import roundtrip work accurately', () => {
  assert.equal(normalizeAdapterDomain('https://WWW.FFOSTA-TV.baby/play.php?vid=123'), 'ffosta-tv.baby');
  assert.equal(buildAdapterIdFromDomain('ffosta-tv.baby'), 'ffosta-tv-baby');

  const active = createDefaultScraperAdapter('ffosta-tv.baby', 'https://ffosta-tv.baby/play.php?vid=1');
  active.domainAliases = ['mirror.ffosta-tv.org'];
  active.status = 'supported';
  active.enabled = true;

  const disabled = createDefaultScraperAdapter('blocked.example.com');
  disabled.enabled = false;

  assert.equal(matchAdapterForUrl('https://sub.ffosta-tv.baby/watch.php?vid=9', [active, disabled])?.id, active.id);
  assert.equal(matchAdapterForUrl('https://mirror.ffosta-tv.org/play.php?vid=9', [active, disabled])?.id, active.id);
  assert.equal(matchAdapterForUrl('https://blocked.example.com/movie/1', [active, disabled]), null);
  assert.equal(
    matchAdapterForUrl('https://blocked.example.com/movie/1', [active, disabled], { includeDisabled: true })?.id,
    disabled.id
  );

  const json = exportAdaptersBundleJson([active, disabled]);
  const parsed = parseImportedAdaptersJson(json);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.adapters.length, 2);
  assert.equal(parsed.adapters[0].domain, 'ffosta-tv.baby');
  assert.deepEqual(parsed.adapters[0].domainAliases, ['mirror.ffosta-tv.org']);
});

test('SSRF guard and protection detector block private IPs and detect challenges without bypassing', () => {
  for (const host of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.25', '172.16.0.1', '::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isBlockedHostEnhanced(host), true, `Expected ${host} to be blocked`);
  }
  for (const host of ['ffosta-tv.baby', 'vidmoly.to', '1.1.1.1']) {
    assert.equal(isBlockedHostEnhanced(host), false, `Expected ${host} to be allowed`);
  }

  const cf = detectProtectionChallenge(403, '<html><title>Just a moment...</title><div class="cf-turnstile"></div></html>');
  assert.equal(cf.isProtected, true);

  const loginWall = detectProtectionChallenge(401, '<html><body><form>تسجيل الدخول <input type="password"/></form></body></html>');
  assert.equal(loginWall.isProtected, true);

  const drm = detectProtectionChallenge(200, '<script>navigator.requestMediaKeySystemAccess("com.widevine.alpha", [])</script>');
  assert.equal(drm.isProtected, true);

  const clean = detectProtectionChallenge(200, '<html><title>Movie</title><body><iframe src="https://vidmoly.to/e/1"></iframe></body></html>');
  assert.equal(clean.isProtected, false);
});

test('analyzeSiteStructure diagnoses multi-season PHP Melody HTML and discovers real server names', async () => {
  const report = await analyzeSiteStructure({
    url: 'https://ffosta-tv.baby/play.php?vid=374905744',
    rawHtml: FFOSTA_STYLE_HTML,
    contentTypeHint: 'series',
    baselineParseFn: makeMockBaselineParse({
      baselineServers: [{ id: 's1', name: 'سيرفر 1', url: 'https://1vid.examplecdn.net/embed-a111.html' }],
      baselineEpisodeCount: 7,
    }),
  });

  assert.equal(report.ok, true);
  assert.equal(report.domain, 'ffosta-tv.baby');
  assert.equal(report.signals.cmsFingerprint, 'PHP Melody Streaming');
  assert.equal(report.signals.hasTabsForServers, true);
  assert.equal(report.signals.hasSeasonTabs, true);
  assert.equal(report.signals.visibleServerCount, 4);
  assert.equal(report.signals.visibleEpisodeCount, 21);
  assert.deepEqual(report.signals.sampleServerNames, ['1vid', 'Vk', 'Ok', 'Vidmoly']);

  const codes = new Set(report.diagnostics.map((d) => d.code));
  assert.ok(codes.has('episode_count_mismatch_or_capped'));
  assert.ok(codes.has('missing_servers_per_episode'));
  assert.ok(codes.has('episodes_in_separate_pages_or_seasons'));
  assert.ok(codes.has('servers_inside_tabs'));
  assert.ok(codes.has('site_specific_server_pattern_or_names'));
});

test('executeAdapterScrape & testAdapterCandidate extract all 21 episodes across 3 seasons and preserve real server names', async () => {
  await withMockedFetch(
    () => ({ ok: true, status: 200, body: FFOSTA_STYLE_HTML }),
    async () => {
      const report = await analyzeSiteStructure({
        url: 'https://ffosta-tv.baby/play.php?vid=374905744',
        rawHtml: FFOSTA_STYLE_HTML,
        contentTypeHint: 'series',
        baselineParseFn: makeMockBaselineParse({
          baselineServers: [{ id: 's1', name: 'سيرفر 1', url: 'https://1vid.examplecdn.net/embed-a111.html' }],
          baselineEpisodeCount: 7,
        }),
      });

      const candidate = {
        ...report.proposedAdapter,
        siteSettings: {
          ...report.proposedAdapter.siteSettings,
          requestDelayMs: 0,
          verifyMode: 'none' as const,
        },
      };

      const testResult = await testAdapterCandidate({
        url: 'https://ffosta-tv.baby/play.php?vid=374905744',
        rawHtml: FFOSTA_STYLE_HTML,
        adapter: candidate,
        contentTypeHint: 'series',
        baselineParseFn: makeMockBaselineParse({
          baselineServers: [{ id: 's1', name: 'سيرفر 1', url: 'https://1vid.examplecdn.net/embed-a111.html' }],
          baselineEpisodeCount: 7,
        }),
      });

      assert.equal(testResult.ok, true);
      assert.equal(testResult.seasonsDiscovered, 3);
      assert.equal(testResult.episodesDiscovered, 21);
      assert.equal(testResult.rootServersCount, 4);
      assert.deepEqual(testResult.extractedServerNames, ['1vid', 'Vk', 'Ok', 'Vidmoly']);
      assert.equal(testResult.missingEpisodes.length, 0);
      assert.equal(
        testResult.extractedPreview?.servers.some((s) => s.url.includes('70C19e669')),
        false
      );
      assert.equal(testResult.visibleComparison.completenessVerdict, 'complete');
      assert.equal(testResult.recommendedStatus, 'supported');
    }
  );
});

test('Pre-save test honesty gate flags missing episode gaps and prevents supported status', async () => {
  const gappedHtml = `<!doctype html><html><head><title>Gapped Series</title></head><body>
    <ul class="WatchList">
      <li data-embed-url="https://ok.ru/videoembed/12345">Ok</li>
    </ul>
    <div class="episodes-list">
      <a href="/watch.php?vid=1">الحلقة 1</a>
      <a href="/watch.php?vid=2">الحلقة 2</a>
      <a href="/watch.php?vid=4">الحلقة 4</a>
      <a href="/watch.php?vid=5">الحلقة 5</a>
    </div>
  </body></html>`;

  await withMockedFetch(
    () => ({ ok: true, status: 200, body: gappedHtml }),
    async () => {
      const adapter = createDefaultScraperAdapter('gap-series.example.com', 'https://gap-series.example.com/s1');
      adapter.siteSettings.verifyMode = 'none';
      adapter.siteSettings.requestDelayMs = 0;
      adapter.serverRules.itemSelector = '.WatchList li';
      adapter.episodeRules.containerSelector = '.episodes-list';

      const result = await testAdapterCandidate({
        url: 'https://gap-series.example.com/s1',
        rawHtml: gappedHtml,
        adapter,
        contentTypeHint: 'series',
        baselineParseFn: makeMockBaselineParse(),
      });

      assert.equal(result.episodesDiscovered, 4);
      assert.equal(result.missingEpisodes.length, 1);
      assert.equal(result.missingEpisodes[0].episodeNumber, 3);
      assert.notEqual(result.recommendedStatus, 'supported');
      assert.equal(result.recommendedStatus, 'needs_fix');
    }
  );
});

test('Old vs New comparisonDiff measures improvements over an earlier incomplete adapter', async () => {
  await withMockedFetch(
    () => ({ ok: true, status: 200, body: FFOSTA_STYLE_HTML }),
    async () => {
      const prevV1 = createDefaultScraperAdapter('ffosta-tv.baby', 'https://ffosta-tv.baby/play.php?vid=374905744');
      prevV1.version = 1;
      prevV1.siteSettings.verifyMode = 'none';
      prevV1.siteSettings.requestDelayMs = 0;
      prevV1.episodeRules.maxEpisodes = 5;
      prevV1.episodeRules.containerSelector = '.non-existent-box';
      prevV1.serverRules.itemSelector = '.non-existent-servers';
      prevV1.lastTestSummary = {
        testedUrl: 'https://ffosta-tv.baby/play.php?vid=374905744',
        contentTypeTested: 'series',
        testedAt: '2026-11-18T00:00:00.000Z',
        episodesDiscovered: 5,
        totalServersExtracted: 1,
        avgServersPerEpisode: 1,
        minServersPerEpisode: 1,
        maxServersPerEpisode: 1,
        missingEpisodesCount: 16,
        failedServersCount: 0,
        visibleEpisodesHint: 21,
        visibleServersHint: 4,
        recommendedStatus: 'needs_fix',
        summaryText: 'v1 partial',
      };

      const candidateV2 = createDefaultScraperAdapter('ffosta-tv.baby', 'https://ffosta-tv.baby/play.php?vid=374905744');
      candidateV2.version = 2;
      candidateV2.siteSettings.verifyMode = 'none';
      candidateV2.siteSettings.requestDelayMs = 0;
      candidateV2.episodeRules.containerSelector = '.tabcontent';
      candidateV2.episodeRules.seasonTabSelector = '.tablinks';
      candidateV2.episodeRules.seasonPanelSelector = '.tabcontent';
      candidateV2.episodeRules.preserveMultiSeason = true;
      candidateV2.serverRules.itemSelector = '.WatchList li';

      const execCheck = await executeAdapterScrape({
        url: 'https://ffosta-tv.baby/play.php?vid=374905744',
        rawHtml: FFOSTA_STYLE_HTML,
        adapter: candidateV2,
        baselineParseFn: makeMockBaselineParse(),
        contentTypeHint: 'series',
        deepEpisodeCrawl: false,
      });
      assert.equal(execCheck.media.seasons.length, 3);

      const testResult = await testAdapterCandidate({
        url: 'https://ffosta-tv.baby/play.php?vid=374905744',
        rawHtml: FFOSTA_STYLE_HTML,
        adapter: candidateV2,
        previousAdapter: prevV1,
        contentTypeHint: 'series',
        baselineParseFn: makeMockBaselineParse(),
      });

      assert.ok(testResult.comparisonDiff);
      assert.equal(testResult.comparisonDiff.previousVersion, 1);
      assert.equal(testResult.comparisonDiff.candidateVersion, 2);
      assert.equal(testResult.comparisonDiff.episodesDelta, 16);
      assert.ok(testResult.comparisonDiff.serversDelta > 0);
    }
  );
});
