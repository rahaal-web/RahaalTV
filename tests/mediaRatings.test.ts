import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildExternalSearchQueries,
  inferEffectiveYear,
  extractCleanEnglishTitleCandidate,
  scoreExternalTitleMatch,
} from '../src/lib/imageMatching';

test('rating lookup preserves full compound English titles when englishTitle was truncated', () => {
  const fullFromTitle = extractCleanEnglishTitleCandidate('فيلم Jess + Moss 2011 HD مترجم');
  assert.equal(fullFromTitle, 'Jess + Moss');

  const inferred = inferEffectiveYear('فيلم Jess + Moss 2011 HD مترجم', '2026');
  assert.deepEqual(inferred, { year: '2011', explicit: true });

  const exactMatch = scoreExternalTitleMatch({
    queryTitle: 'فيلم Jess + Moss 2011 HD مترجم',
    englishTitle: 'Jess',
    expectedYear: inferred.year,
    expectedYearExplicit: inferred.explicit,
    candidateTitles: ['Jess + Moss'],
    candidateYear: '2011',
  });
  assert.equal(exactMatch.matched, true);
});

test('rating lookup matches movies whose title carries real year while stored year is 2026', () => {
  const inferred = inferEffectiveYear("فيلم It's Complicated 2009 1080p WEB-DL", '2026');
  assert.deepEqual(inferred, { year: '2009', explicit: true });

  const match = scoreExternalTitleMatch({
    queryTitle: "فيلم It's Complicated 2009 1080p WEB-DL",
    englishTitle: "It's Complicated",
    expectedYear: inferred.year,
    expectedYearExplicit: inferred.explicit,
    candidateTitles: ["It's Complicated"],
    candidateYear: '2009',
  });
  assert.equal(match.matched, true);
});

test('rating lookup handles Arabic subtitles, feminine noise tags, WWE, Latin diacritics, and multi-season series years', () => {
  const hareefaQueries = buildExternalSearchQueries('فيلم الحريفة 2: الريمونتادا 2024', '');
  assert.ok(hareefaQueries.includes('الحريفة 2: الريمونتادا'));
  assert.ok(hareefaQueries.includes('الحريفة 2'));

  const wweQueries = buildExternalSearchQueries('عرض WWE Raw 2025 مترجمة', '');
  assert.ok(wweQueries.includes('WWE Raw'));

  const kurulusMatch = scoreExternalTitleMatch({
    queryTitle: 'مسلسل المؤسس عثمان الموسم السادس',
    englishTitle: 'Kurulus Osman',
    expectedYear: '2024',
    expectedYearExplicit: true,
    kind: 'series',
    candidateTitles: ['Kuruluş: Osman'],
    candidateYear: '2019',
  });
  assert.equal(kurulusMatch.matched, true);

  const shogunMatch = scoreExternalTitleMatch({
    queryTitle: 'مسلسل Shogun 2024',
    englishTitle: 'Shogun',
    expectedYear: '2024',
    expectedYearExplicit: true,
    kind: 'series',
    candidateTitles: ['Shōgun'],
    candidateYear: '2024',
  });
  assert.equal(shogunMatch.matched, true);

  const arabicOrdinalMatch = scoreExternalTitleMatch({
    queryTitle: 'فيلم ولاد رزق الجزء الثالث 2024',
    englishTitle: '',
    expectedYear: '2024',
    expectedYearExplicit: true,
    kind: 'movie',
    candidateTitles: ['ولاد رزق 3'],
    candidateYear: '2024',
  });
  assert.equal(arabicOrdinalMatch.matched, true);
});

