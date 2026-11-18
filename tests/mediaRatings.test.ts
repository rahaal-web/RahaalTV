import assert from 'node:assert/strict';
import test from 'node:test';
import { inferEffectiveYear, extractCleanEnglishTitleCandidate, scoreExternalTitleMatch } from '../src/lib/imageMatching';

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
