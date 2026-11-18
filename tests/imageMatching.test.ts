import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanExternalSearchTitle,
  extractBackgroundImageUrl,
  extractCleanEnglishTitleCandidate,
  extractImdbIdFromText,
  extractJsonLdImageUrl,
  extractJsonLdNodes,
  isJunkImageCandidate,
  isLowTrustScrapedPosterUrl,
  parseSrcsetBestUrl,
  scoreExternalTitleMatch,
} from '../src/lib/imageMatching';

test('extractCleanEnglishTitleCandidate ignores release tags and streaming site noise', () => {
  assert.equal(
    extractCleanEnglishTitleCandidate('فيلم مشروع إكس 2025 WEB-DL 1080p MyCima اون لاين'),
    ''
  );
  assert.equal(
    extractCleanEnglishTitleCandidate('فيلم Mononoke 3 The Curse of the Serpent 2026 مترجم'),
    'Mononoke 3 The Curse of the Serpent'
  );
  assert.equal(
    extractCleanEnglishTitleCandidate('مسلسل Stranger Things الموسم الرابع FaselHD BluRay'),
    'Stranger Things'
  );
});

test('cleanExternalSearchTitle uses word boundaries so normal words like Shahd or Ahmad stay intact', () => {
  assert.equal(cleanExternalSearchTitle('فيلم شهد Shahd 2025 HD مترجم', 'Shahd'), 'Shahd');
  assert.equal(cleanExternalSearchTitle('فيلم ولاد رزق 3 القاضية 2024', ''), 'ولاد رزق 3 القاضية');
  assert.equal(cleanExternalSearchTitle('Imported Title', 'WEB-DL 1080p'), '');
});

test('scoreExternalTitleMatch rejects false positives that used to overwrite real posters', () => {
  const mononokeMismatch = scoreExternalTitleMatch({
    queryTitle: 'فيلم Mononoke 3 The Curse of the Serpent 2026 مترجم',
    englishTitle: 'Mononoke 3 The Curse of the Serpent',
    expectedYear: '2026',
    expectedYearExplicit: true,
    candidateTitles: ['Mononoke'],
    candidateYear: '2007',
  });
  assert.equal(mononokeMismatch.matched, false);

  const sequelMismatch = scoreExternalTitleMatch({
    queryTitle: 'John Wick 4',
    englishTitle: 'John Wick 4',
    expectedYear: '2023',
    expectedYearExplicit: true,
    candidateTitles: ['John Wick: Chapter 2'],
    candidateYear: '2017',
  });
  assert.equal(sequelMismatch.matched, false);

  const remakeYearMismatch = scoreExternalTitleMatch({
    queryTitle: 'Dune',
    englishTitle: 'Dune',
    expectedYear: '2021',
    expectedYearExplicit: true,
    candidateTitles: ['Dune'],
    candidateYear: '1984',
  });
  assert.equal(remakeYearMismatch.matched, false);

  const arabicVsWrongEnglish = scoreExternalTitleMatch({
    queryTitle: 'ولاد رزق 3 القاضية',
    englishTitle: 'ولاد رزق 3 القاضية',
    expectedYear: '2024',
    expectedYearExplicit: true,
    candidateTitles: ['The Rookie'],
    candidateYear: '2018',
  });
  assert.equal(arabicVsWrongEnglish.matched, false);
});

test('scoreExternalTitleMatch accepts exact and punctuation-normalized titles', () => {
  const exactSeries = scoreExternalTitleMatch({
    queryTitle: 'مسلسل Stranger Things الموسم الرابع',
    englishTitle: 'Stranger Things',
    expectedYear: '2022',
    expectedYearExplicit: false,
    candidateTitles: ['Stranger Things'],
    candidateYear: '2016',
  });
  assert.equal(exactSeries.matched, true);

  const movieColon = scoreExternalTitleMatch({
    queryTitle: 'فيلم Spider-Man No Way Home 2021 مترجم',
    englishTitle: 'Spider-Man No Way Home',
    expectedYear: '2021',
    expectedYearExplicit: true,
    candidateTitles: ['Spider-Man: No Way Home'],
    candidateYear: '2021',
  });
  assert.equal(movieColon.matched, true);

  const arabicExact = scoreExternalTitleMatch({
    queryTitle: 'فيلم المشروع X 2025',
    englishTitle: 'المشروع X',
    expectedYear: '2025',
    expectedYearExplicit: true,
    candidateTitles: ['المشروع X'],
    candidateYear: '2025',
  });
  assert.equal(arabicExact.matched, true);
});

test('HTML & JSON-LD image helpers parse srcset, CSS backgrounds, @graph, and reject junk', () => {
  assert.equal(isJunkImageCandidate('data:image/svg+xml;base64,PHN2Zz4='), true);
  assert.equal(isJunkImageCandidate('https://site.com/wp-content/themes/x/blank.gif'), true);
  assert.equal(isJunkImageCandidate('https://site.com/favicon.ico'), true);
  assert.equal(isJunkImageCandidate('https://cdn.example.com/posters/dune-2024.jpg'), false);

  assert.equal(
    extractBackgroundImageUrl("background-image: url('https://cdn.example.com/p/123.jpg');"),
    'https://cdn.example.com/p/123.jpg'
  );

  assert.equal(
    parseSrcsetBestUrl(
      'https://cdn.example.com/small.jpg 300w, https://cdn.example.com/large.jpg 1000w, https://cdn.example.com/med.jpg 600w'
    ),
    'https://cdn.example.com/large.jpg'
  );

  const rawJsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: 'Cinema' },
      {
        '@type': 'Movie',
        name: 'Example Movie',
        image: [{ '@type': 'ImageObject', url: 'https://cdn.example.com/poster-real.jpg' }],
      },
    ],
  });
  const nodes = extractJsonLdNodes(rawJsonLd);
  const movieNode = nodes.find((n) => n['@type'] === 'Movie');
  assert.ok(movieNode);
  assert.equal(extractJsonLdImageUrl(movieNode.image), 'https://cdn.example.com/poster-real.jpg');
});

test('sequel/subtitle matching and low-trust thumbnail detection handle Dune 3, Headless Horror, and qfilm thumbs', () => {
  const dune3Match = scoreExternalTitleMatch({
    queryTitle: 'فيلم Dune 3 2026 مترجم',
    englishTitle: 'Dune 3',
    expectedYear: '2026',
    expectedYearExplicit: true,
    candidateTitles: ['Dune: Part Three'],
    candidateYear: '2026',
  });
  assert.equal(dune3Match.matched, true);

  const headlessHorrorMatch = scoreExternalTitleMatch({
    queryTitle: 'فيلم The Headless Horror 2025 مترجم',
    englishTitle: 'The Headless Horror',
    expectedYear: '2025',
    expectedYearExplicit: true,
    candidateTitles: ['Detective Kien: The Headless Horror'],
    candidateYear: '2025',
  });
  assert.equal(headlessHorrorMatch.matched, true);

  assert.equal(isJunkImageCandidate('https://a.qfilm.tv/social-thumb.php?vid=2cc3cd47c'), true);
  assert.equal(isLowTrustScrapedPosterUrl('https://a.qfilm.tv/uploads/thumbs/82019e14d-1.jpg'), true);
  assert.equal(isLowTrustScrapedPosterUrl('https://image.tmdb.org/t/p/original/abc123.jpg'), false);

  assert.equal(
    extractImdbIdFromText('https://www.imdb.com/title/tt31378509/?ref_=fn_al_tt_1'),
    'tt31378509'
  );
  assert.equal(extractImdbIdFromText('no imdb id here'), '');
});

import { inferEffectiveYear } from '../src/lib/imageMatching';

test('inferEffectiveYear recovers embedded release year when stored year defaulted to 2026', () => {
  assert.deepEqual(inferEffectiveYear("فيلم It's Complicated 2009 HD مترجم", '2026'), {
    year: '2009',
    explicit: true,
  });
  assert.deepEqual(inferEffectiveYear('فيلم Mayhem 2017 BluRay', '2026'), {
    year: '2017',
    explicit: true,
  });
  assert.deepEqual(inferEffectiveYear('فيلم جديد بدون سنة', '2026'), {
    year: '2026',
    explicit: false,
  });
  assert.deepEqual(inferEffectiveYear('فيلم قديم', '2018'), {
    year: '2018',
    explicit: true,
  });

  const jessMismatch = scoreExternalTitleMatch({
    queryTitle: 'فيلم Jess + Moss 2011 HD مترجم',
    englishTitle: 'Jess',
    expectedYear: '2011',
    expectedYearExplicit: true,
    candidateTitles: ['Jessabelle'],
    candidateYear: '2014',
  });
  assert.equal(jessMismatch.matched, false);
});

