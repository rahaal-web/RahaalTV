import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExecutionPreviewPlan,
  parseArabicAdminCommand,
} from '../src/lib/localAdminNlp';
import { MediaItem } from '../src/types/media';

function makeMedia(overrides: Partial<MediaItem>): MediaItem {
  return {
    id: 'm-default',
    slug: 'm-default',
    title: 'عنوان افتراضي',
    englishTitle: 'Default Title',
    kind: 'movie',
    categories: ['افلام', 'افلام اجنبية'],
    genres: ['أكشن', 'دراما'],
    year: '2026',
    country: 'الولايات المتحدة',
    language: 'مترجم للعربية',
    quality: '1080p',
    duration: '120 دقيقة',
    imdb: 7.5,
    votes: '1,200',
    views: 5000,
    likes: 300,
    pinned: false,
    isNew: false,
    comingSoon: false,
    poster: 'https://example.com/poster.jpg',
    backdrop: 'https://example.com/backdrop.jpg',
    tagline: 'شعار افتراضي',
    story: 'قصة فيلم مشوق تدور أحداثها في إطار من الإثارة والغموض.',
    shortUrl: 'https://rahaltv.com/?watch=m-default',
    trailerUrl: '',
    trailerLabel: 'الإعلان الرسمي',
    trailerDuration: '02:00',
    cast: [],
    seasons: [],
    servers: [],
    downloads: [],
    createdAtMs: 1700000000000,
    updatedAtMs: 1700000000000,
    ...overrides,
  };
}

const SAMPLE_CATALOG: MediaItem[] = [
  makeMedia({
    id: 'mov-1',
    title: 'فيلم الرجل الهارب 2026 مترجم اون لاين',
    englishTitle: 'The Running Man',
    kind: 'movie',
    year: '2026',
    imdb: 8.6,
    updatedAtMs: 1700000050000,
  }),
  makeMedia({
    id: 'mov-2',
    title: 'فيلم صدى المحيط',
    englishTitle: 'Ocean Echo',
    kind: 'movie',
    year: '2025',
    imdb: 7.9,
    updatedAtMs: 1700000040000,
  }),
  makeMedia({
    id: 'mov-3',
    title: 'الساموراي الأخير',
    englishTitle: 'Last Samurai',
    kind: 'movie',
    year: '2024',
    poster: '',
    imdb: 9.1,
    updatedAtMs: 1700000030000,
  }),
  makeMedia({
    id: 'ser-1',
    title: 'مسلسل السرايا الكبير',
    englishTitle: 'Al Saraya',
    kind: 'series',
    categories: ['مسلسلات', 'رمضان 2026'],
    story: 'مسلسل درامي تاريخي حصري عن صراع العائلات القديمة في القاهرة.',
    year: '2026',
    seasons: [
      {
        seasonNumber: 1,
        label: 'الموسم 01',
        year: '2026',
        episodes: [
          { number: 1, title: 'الحلقة 01', duration: '45 دقيقة', quality: '720p' },
          { number: 2, title: 'الحلقة 02', duration: '45 دقيقة', quality: '720p' },
        ],
      },
    ],
    updatedAtMs: 1700000060000,
  }),
  makeMedia({
    id: 'ser-2',
    title: 'مسلسل تجريبي محذوف قريبا',
    englishTitle: 'Test Series',
    kind: 'series',
    categories: ['مسلسلات'],
    story: 'عمل تجريبي للاختبار فقط حصري.',
    year: '2025',
    updatedAtMs: 1700000010000,
  }),
];

describe('Local Arabic NLP Admin Engine', () => {
  it('1. Removes word "فيلم" from movie titles across multiple Arabic phrasings', () => {
    const commands = [
      'احذف كلمة فيلم من عناوين الأفلام.',
      'شيل كلمة فيلم من كل أسماء الأفلام.',
      'امسح كلمة فيلم من العناوين.',
    ];

    for (const raw of commands) {
      const cmd = parseArabicAdminCommand(raw, 'all');
      assert.equal(cmd.operationType, 'bulk_remove_text', `Failed on: ${raw}`);
      assert.equal(cmd.isReadOnly, false);
      assert.equal(cmd.isSingleTarget, false);
      assert.ok(cmd.targetFields.includes('title'));
      assert.ok(cmd.removeTerms.some((t) => t.includes('فيلم')));

      const plan = buildExecutionPreviewPlan(cmd, SAMPLE_CATALOG);
      assert.ok(plan.proposals.length >= 2, `Expected >=2 proposals for "${raw}"`);
      const mov1 = plan.proposals.find((p) => p.original.id === 'mov-1');
      assert.ok(mov1);
      assert.equal(mov1.updated.title, 'الرجل الهارب 2026 مترجم اون لاين');
      const mov2 = plan.proposals.find((p) => p.original.id === 'mov-2');
      assert.ok(mov2);
      assert.equal(mov2.updated.title, 'صدى المحيط');
      // Must NOT touch series when scope is movie (or if movie-less series)
      assert.equal(
        plan.proposals.some((p) => p.original.kind === 'series'),
        false
      );
    }
  });

  it('2. Distinguishes single movie rename vs bulk title modification', () => {
    // Single movie rename
    const singleCmd = parseArabicAdminCommand(
      'غير اسم الفيلم من "فيلم صدى المحيط" إلى "نداء الأعماق"',
      'all'
    );
    assert.equal(singleCmd.operationType, 'single_rename');
    assert.equal(singleCmd.isSingleTarget, true);
    assert.equal(singleCmd.targetItemTitle, 'فيلم صدى المحيط');
    assert.equal(singleCmd.newTitle, 'نداء الأعماق');

    const singlePlan = buildExecutionPreviewPlan(singleCmd, SAMPLE_CATALOG);
    assert.equal(singlePlan.proposals.length, 1);
    assert.equal(singlePlan.proposals[0].original.id, 'mov-2');
    assert.equal(singlePlan.proposals[0].updated.title, 'نداء الأعماق');

    // Unquoted single rename phrasing: "غير اسم الفيلم من كذا إلى كذا"
    const unquotedSingle = parseArabicAdminCommand(
      'غير اسم الفيلم من الساموراي الأخير إلى سيف الساموراي',
      'all'
    );
    assert.equal(unquotedSingle.operationType, 'single_rename');
    assert.equal(unquotedSingle.isSingleTarget, true);
    const unquotedPlan = buildExecutionPreviewPlan(unquotedSingle, SAMPLE_CATALOG);
    assert.equal(unquotedPlan.proposals.length, 1);
    assert.equal(unquotedPlan.proposals[0].original.id, 'mov-3');
    assert.equal(unquotedPlan.proposals[0].updated.title, 'سيف الساموراي');

    // Bulk replace across all movie titles
    const bulkCmd = parseArabicAdminCommand(
      'غير كلمة فيلم إلى حكاية في جميع عناوين الأفلام',
      'all'
    );
    assert.equal(bulkCmd.operationType, 'bulk_replace_text');
    assert.equal(bulkCmd.isSingleTarget, false);
    const bulkPlan = buildExecutionPreviewPlan(bulkCmd, SAMPLE_CATALOG);
    assert.equal(bulkPlan.proposals.length, 2);
  });

  it('3. Handles single item delete vs conditional bulk delete, and blocks unsafe unconditioned delete', () => {
    // Single delete
    const singleDel = parseArabicAdminCommand('احذف الفيلم اللي اسمه الساموراي الأخير', 'all');
    assert.equal(singleDel.operationType, 'delete_items');
    assert.equal(singleDel.isDestructive, true);
    assert.equal(singleDel.isSingleTarget, true);
    const singlePlan = buildExecutionPreviewPlan(singleDel, SAMPLE_CATALOG);
    assert.equal(singlePlan.proposals.length, 1);
    assert.equal(singlePlan.proposals[0].original.id, 'mov-3');

    // Conditional bulk delete
    const bulkDel = parseArabicAdminCommand(
      'احذف جميع المسلسلات التي تحتوي على كلمة تجريبي',
      'all'
    );
    assert.equal(bulkDel.operationType, 'delete_items');
    assert.equal(bulkDel.isDestructive, true);
    assert.equal(bulkDel.scopeKind, 'series');
    const bulkDelPlan = buildExecutionPreviewPlan(bulkDel, SAMPLE_CATALOG);
    assert.equal(bulkDelPlan.proposals.length, 1);
    assert.equal(bulkDelPlan.proposals[0].original.id, 'ser-2');

    // Safety guard: unconditioned bulk delete MUST be blocked
    const unsafeDel = parseArabicAdminCommand('احذف جميع المسلسلات', 'all');
    assert.equal(unsafeDel.operationType, 'delete_items');
    assert.ok(unsafeDel.blockedReason, 'Unconditioned bulk delete must be blocked');
    const unsafePlan = buildExecutionPreviewPlan(unsafeDel, SAMPLE_CATALOG);
    assert.equal(unsafePlan.proposals.length, 0);
  });

  it('4. Handles read-only queries: search, count, and latest N', () => {
    const searchCmd = parseArabicAdminCommand('ابحث عن فيلم اسمه الساموراي', 'all');
    assert.equal(searchCmd.operationType, 'query_search');
    assert.equal(searchCmd.isReadOnly, true);
    const searchPlan = buildExecutionPreviewPlan(searchCmd, SAMPLE_CATALOG);
    assert.equal(searchPlan.matchedItems.length, 1);
    assert.equal(searchPlan.matchedItems[0].id, 'mov-3');

    const countCmd = parseArabicAdminCommand('اعرض عدد الأفلام الموجودة', 'all');
    assert.equal(countCmd.operationType, 'query_count');
    assert.equal(countCmd.isReadOnly, true);
    const countPlan = buildExecutionPreviewPlan(countCmd, SAMPLE_CATALOG);
    assert.equal(countPlan.countSummary?.movies, 3);
    assert.equal(countPlan.countSummary?.series, 2);
    assert.equal(countPlan.affectedCount, 3);

    const latestCmd = parseArabicAdminCommand('اعرض أحدث 2 أفلام', 'all');
    assert.equal(latestCmd.operationType, 'query_latest');
    assert.equal(latestCmd.isReadOnly, true);
    assert.equal(latestCmd.limitCount, 2);
    assert.equal(latestCmd.scopeKind, 'movie');
    const latestPlan = buildExecutionPreviewPlan(latestCmd, SAMPLE_CATALOG);
    assert.equal(latestPlan.matchedItems.length, 2);
    assert.equal(latestPlan.matchedItems[0].id, 'mov-1');
  });

  it('5. Removes a specific word from series descriptions (story)', () => {
    const cmd = parseArabicAdminCommand('احذف كلمة "حصري" من أوصاف المسلسلات', 'all');
    assert.equal(cmd.operationType, 'bulk_remove_text');
    assert.equal(cmd.scopeKind, 'series');
    assert.ok(cmd.targetFields.includes('story'));

    const plan = buildExecutionPreviewPlan(cmd, SAMPLE_CATALOG);
    assert.equal(plan.proposals.length, 2);
    assert.ok(!plan.proposals[0].updated.story.includes('حصري'));
    assert.ok(!plan.proposals[1].updated.story.includes('حصري'));
  });

  it('6. Supports seasons, episodes, categories, quality, flags, and promotional fluff cleanup', () => {
    // Clean promotional fluff
    const fluffCmd = parseArabicAdminCommand(
      'أزل العبارات الترويجية الزائدة من العناوين مثل "مترجم اون لاين"',
      'all'
    );
    assert.equal(fluffCmd.operationType, 'bulk_clean_fluff');
    const fluffPlan = buildExecutionPreviewPlan(fluffCmd, SAMPLE_CATALOG);
    const cleanedMov1 = fluffPlan.proposals.find((p) => p.original.id === 'mov-1');
    assert.ok(cleanedMov1);
    assert.equal(cleanedMov1.updated.title, 'فيلم الرجل الهارب 2026');

    // Add episode to series
    const addEpCmd = parseArabicAdminCommand('أضف حلقة جديدة لمسلسل السرايا الكبير', 'all');
    assert.equal(addEpCmd.operationType, 'manage_seasons_episodes');
    assert.equal(addEpCmd.seasonAction, 'add_episode');
    const epPlan = buildExecutionPreviewPlan(addEpCmd, SAMPLE_CATALOG);
    assert.equal(epPlan.proposals.length, 1);
    assert.equal(epPlan.proposals[0].updated.seasons?.[0].episodes.length, 3);

    // Add category
    const catCmd = parseArabicAdminCommand('أضف تصنيف "سينما 2026" للأفلام سنة 2026', 'all');
    assert.equal(catCmd.operationType, 'bulk_tag_change');
    assert.equal(catCmd.tagAction, 'add');
    const catPlan = buildExecutionPreviewPlan(catCmd, SAMPLE_CATALOG);
    assert.equal(catPlan.proposals.length, 1);
    assert.ok(catPlan.proposals[0].updated.categories.includes('سينما 2026'));

    // Set isNew for 2026
    const flagCmd = parseArabicAdminCommand(
      'اجعل حقل isNew يساوي true لجميع الأعمال الصادرة في سنة 2026',
      'all'
    );
    assert.equal(flagCmd.operationType, 'bulk_update_field');
    assert.equal(flagCmd.fieldToSet, 'isNew');
    assert.equal(flagCmd.fieldValue, true);
    const flagPlan = buildExecutionPreviewPlan(flagCmd, SAMPLE_CATALOG);
    assert.equal(flagPlan.proposals.length, 2); // mov-1 & ser-1
  });
});
