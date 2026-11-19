/**
 * Shared Pure Helpers for HTML Poster Candidate Filtering, Title Cleaning,
 * and Strict Title+Year Verification against External Image APIs (TMDB / TVmaze / iTunes).
 * Zero DOM or Node-only dependencies so both server.ts and client browser modules share identical rules.
 */

const PLACEHOLDER_TITLES = new Set([
  'imported title',
  'عمل مستورد',
  'عمل مستورد جديد',
  'untitled',
  'بدون عنوان',
]);

const NOISE_ENGLISH_TOKENS = new Set([
  'web',
  'webdl',
  'web-dl',
  'webrip',
  'bluray',
  'blu-ray',
  'bdrip',
  'brrip',
  'hdrip',
  'hdtv',
  'dvdrip',
  'dvdscr',
  'hdcam',
  'cam',
  'hdts',
  'ts',
  'telesync',
  'full',
  'fullhd',
  'hd',
  'fhd',
  'uhd',
  '4k',
  '2160p',
  '1080p',
  '720p',
  '480p',
  '360p',
  'x264',
  'x265',
  'hevc',
  'h264',
  'h265',
  'aac',
  'ac3',
  'ddp',
  'ddp5',
  'atmos',
  'nf',
  'netflix',
  'amzn',
  'hulu',
  'dsnp',
  'atvp',
  'hmax',
  'sub',
  'subbed',
  'dub',
  'dubbed',
  'ar',
  'arb',
  'eng',
  'online',
  'watch',
  'download',
  'free',
  'movie',
  'series',
  'film',
  'episode',
  'season',
  'mycima',
  'wecima',
  'akwam',
  'faselhd',
  'egybest',
  'cima4u',
  'cimanow',
  'arabseed',
  'larooza',
  'shahed4u',
  'shahid4u',
  'shahid',
  'imdb',
  'mp4',
  'mkv',
]);

export function normalizeArabicDigitsShared(text: string): string {
  return String(text || '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

export function isJunkImageCandidate(rawUrl: string | undefined | null, hintText = ''): boolean {
  const url = String(rawUrl || '').trim();
  if (!url) return true;
  const lower = url.toLowerCase();

  if (
    lower.startsWith('data:') ||
    lower.startsWith('blob:') ||
    lower.startsWith('javascript:') ||
    lower.startsWith('about:') ||
    lower.includes('[object object]')
  ) {
    return true;
  }

  // Strip query string only for filename checks, still inspect full URL for ad/sprite paths
  const withoutQuery = lower.split('#')[0].split('?')[0];

  if (
    /\/(?:favicon|favicons|emoji|emojis|smiles|smilies|flags|ads|adserver|doubleclick|googlesyndication)\//i.test(
      withoutQuery
    ) ||
    /(?:^|[/._-])(?:favicon|sprite|blank|spacer|placeholder|spinner|preloader|loading|loader|avatar|gravatar|no[-_]?image|no[-_]?poster|default[-_]?poster|1x1|pixel)(?:[/._-]|\.(?:gif|png|svg|jpg|webp)|$)/i.test(
      withoutQuery
    ) ||
    /(?:^|[/._-])(?:site[-_]?logo|header[-_]?logo|brand[-_]?logo|footer[-_]?logo|main[-_]?logo)(?:[/._-]|\.(?:png|svg|jpg|webp)|$)/i.test(
      withoutQuery
    )
  ) {
    return true;
  }

  // Check element hints (class/alt/id) for UI icons/logos unless it clearly states poster/cover/thumb
  const cleanHint = String(hintText || '').toLowerCase();
  if (
    cleanHint &&
    !/poster|cover|thumb|backdrop|artwork|بوستر|صورة الفيلم|صورة المسلسل/.test(cleanHint) &&
    /\b(?:logo|favicon|avatar|emoji|flag|spinner|loading|placeholder|badge|icon|brand)\b/.test(
      cleanHint
    )
  ) {
    return true;
  }

  // Reject auto-generated social share cards with embedded play-icon stamps (never clean movie posters)
  if (/\/social-thumb\.php/i.test(withoutQuery)) {
    return true;
  }

  // Reject tiny `.ico` files
  if (/\.ico$/i.test(withoutQuery)) return true;

  return false;
}

/**
 * Identifies low-trust site video-frame thumbnails (/uploads/thumbs/, /thumbs/, YouTube frame thumbs)
 * that may still be shown as a last-resort scraped fallback but should always be replaced by official posters.
 */
export function isLowTrustScrapedPosterUrl(rawUrl: string | undefined | null): boolean {
  const url = String(rawUrl || '').trim().toLowerCase();
  if (!url) return true;
  if (isJunkImageCandidate(url)) return true;
  return (
    /\/(?:uploads\/thumbs|thumbs|video[-_]?thumbs)\//i.test(url) ||
    /\/social-thumb\.php/i.test(url) ||
    /(?:i\.ytimg\.com|img\.youtube\.com)\/vi\//i.test(url)
  );
}

/**
 * Extracts an explicit IMDb title ID (tt1234567) from HTML links, JSON-LD sameAs, or raw metadata.
 */
export function extractImdbIdFromText(rawText: string | undefined | null): string {
  const text = String(rawText || '');
  if (!text) return '';
  const urlMatch = text.match(/imdb\.com\/title\/(tt\d{6,10})\b/i);
  if (urlMatch?.[1]) return urlMatch[1].toLowerCase();
  const fieldMatch = text.match(/["']?(?:imdb[_-]?id|imdbId)["']?\s*[:=]\s*["']?(tt\d{6,10})\b/i);
  if (fieldMatch?.[1]) return fieldMatch[1].toLowerCase();
  return '';
}

export function extractBackgroundImageUrl(styleAttr: string | undefined | null): string {
  const style = String(styleAttr || '').trim();
  if (!style) return '';
  const match = style.match(/url\(\s*(['"]?)(.*?)\1\s*\)/i);
  return match?.[2] ? match[2].trim() : '';
}

export function parseSrcsetBestUrl(srcset: string | undefined | null): string {
  const raw = String(srcset || '').trim();
  if (!raw) return '';

  // Match "url [descriptor]" pairs cleanly even if CDN URLs contain commas inside transformation paths when separated cleanly by descriptor
  const parts = raw
    .split(/,(?=\s*(?:https?:|\/\/|\/|\.\.?\/))/i)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) return '';

  let bestUrl = '';
  let bestScore = -1;

  for (let i = 0; i < parts.length; i++) {
    const tokens = parts[i].split(/\s+/).filter(Boolean);
    const candidateUrl = tokens[0] || '';
    if (!candidateUrl || candidateUrl.startsWith('data:')) continue;

    let score = i; // slight preference for later items if no descriptor
    const desc = tokens[1] || '';
    const wMatch = desc.match(/^(\d+)w$/i);
    const xMatch = desc.match(/^(\d+(?:\.\d+)?)x$/i);
    if (wMatch) {
      score = parseInt(wMatch[1], 10);
    } else if (xMatch) {
      score = Math.round(parseFloat(xMatch[1]) * 1000);
    }

    if (score > bestScore) {
      bestScore = score;
      bestUrl = candidateUrl;
    }
  }

  return bestUrl;
}

export function extractJsonLdNodes(rawJsonText: string): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];
  if (!rawJsonText || !rawJsonText.trim()) return results;

  try {
    const parsed = JSON.parse(rawJsonText);
    const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];

    while (queue.length > 0) {
      const node = queue.shift();
      if (!node || typeof node !== 'object') continue;
      const obj = node as Record<string, unknown>;
      results.push(obj);
      if (Array.isArray(obj['@graph'])) {
        queue.push(...obj['@graph']);
      }
    }
  } catch {
    // Ignore invalid JSON-LD
  }

  return results;
}

export function extractJsonLdImageUrl(imageField: unknown): string {
  if (!imageField) return '';
  if (typeof imageField === 'string') {
    const trimmed = imageField.trim();
    return isJunkImageCandidate(trimmed) ? '' : trimmed;
  }
  if (Array.isArray(imageField)) {
    for (const item of imageField) {
      const candidate = extractJsonLdImageUrl(item);
      if (candidate) return candidate;
    }
    return '';
  }
  if (typeof imageField === 'object') {
    const obj = imageField as Record<string, unknown>;
    for (const key of ['url', 'contentUrl', 'thumbnailUrl', '@id']) {
      if (typeof obj[key] === 'string') {
        const val = String(obj[key]).trim();
        if (/^https?:\/\/|^\/\//i.test(val) && !isJunkImageCandidate(val)) {
          return val;
        }
      }
    }
  }
  return '';
}

function stripNoiseFromTitle(raw: string): string {
  let text = normalizeArabicDigitsShared(String(raw || ''))
    .replace(/\u200f|\u200e|\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return '';

  // Remove common Arabic release & site wrappers (respecting boundaries!)
  const arabicNoisePatterns = [
    /(?:^|\s)(?:مشاهدة|تحميل|شاهد|تنزيل|حصريا|حصرياً|مباشرة|مباشر)(?=$|\s)/g,
    /(?:^|\s)(?:فيلم|مسلسل|انمي|أنمي|كارتون|كرتون|برنامج|مسرحية|عرض)(?=$|\s)/g,
    /(?:^|\s)(?:مترجم|مترجمه|مترجمة|مدبلج|مدبلجه|مدبلجة|بالعربية|بالعربي|للعربية|كامل|الكامل|كاملة|كامله|اون\s*لاين|أون\s*لاين|اونلاين|أونلاين)(?=$|\s)/g,
    /(?:^|\s)(?:بجودة\s*عالية|بجودة|جودة\s*عالية|عالية|النسخة\s*الأصلية|النسخه\s*الاصليه|النسخة|نسخة|الاصلية|الأصلية|بدون\s*إعلانات|بدون\s*اعلانات|بدون\s*حذف)(?=$|\s)/g,
    /(?:^|\s)(?:الموسم\s*(?:\d+|الأول|الاول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)|موسم\s*\d+)(?=$|\s)/g,
    /(?:^|\s)(?:الحلقات|حلقات|الحلقة\s*\d+|حلقة\s*\d+|الاخيرة|الأخيرة|الاخيره)(?=$|\s)/g,
    /(?:^|\s)(?:ماي\s*سيما|وي\s*سيما|فاصل\s*إعلاني|فاصل\s*اعلاني|ايجي\s*بست|ايجي\s*بيست|إيجي\s*بست|إيجي\s*بيست|اكوام|أكوام|سيما\s*فور\s*يو|سيما\s*ناو|سيما\s*كلوب|عرب\s*سيد|لاروزا|شاهد\s*فور\s*يو|توب\s*سيما|موفيز\s*لاند|تورنت)(?=$|\s)/g,
  ];
  for (const pat of arabicNoisePatterns) {
    text = text.replace(pat, ' ');
  }

  // Strip English release tags using explicit word boundaries so "Shahd" or "Richard" is never damaged
  text = text
    .replace(
      /(?:^|[\s\-–|:\[\]().])(S\d{1,2}E\d{1,3}|S\d{1,2}|E\d{1,3}|Season\s*\d+|Episode\s*\d+|Ep\.?\s*\d+)(?=$|[\s\-–|:\[\]().])/gi,
      ' '
    )
    .replace(
      /(?:^|[\s\-–|:\[\]().])(WEB-?DL|WEBRip|Blu-?Ray|BDRip|BRRip|HDRip|HDTV|DVDRip|DVDScr|HDCAM|HDTS|CAM|Full\s*HD|FHD|UHD|HD|4K|2160p|1080p|720p|480p|360p|x264|x265|HEVC|H\.?264|H\.?265|AAC|AC3|DDP\d?|NF|AMZN|DSNP|ATVP|HMAX|Subbed|Dubbed|Online|Download|Watch|Free|MyCima|WeCima|Akwam|FaselHD|EgyBest|Cima4u|CimaNow|ArabSeed|Larooza|Shahed4u|Shahid4u)(?=$|[\s\-–|:\[\]().])/gi,
      ' '
    )
    .replace(/\b(19\d{2}|20[0-3]\d)\b/g, ' ')
    .replace(/[()[\]{}|–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

/**
 * Extracts a genuine English/Latin title segment from a mixed Arabic+English page title,
 * ignoring technical quality tags (WEB-DL, 1080p, HD, BluRay) and site names (MyCima, FaselHD).
 */
export function extractCleanEnglishTitleCandidate(rawTitle: string): string {
  const input = String(rawTitle || '');
  const segments = input.match(/[A-Za-z0-9][A-Za-z0-9\s:'’.!&+/,\-]*/g) || [];
  let best = '';

  for (const seg of segments) {
    const cleaned = stripNoiseFromTitle(seg).replace(/^[-–+:.,\s]+|[-–+:.,\s]+$/g, '').trim();
    if (!cleaned) continue;
    const words = cleaned
      .split(/\s+/)
      .filter((w) => w && !NOISE_ENGLISH_TOKENS.has(w.toLowerCase().replace(/[^a-z0-9-]/g, '')));
    const meaningful = words.join(' ').trim();
    const letterCount = (meaningful.match(/[A-Za-z]/g) || []).length;
    if (letterCount < 2) continue;
    if (PLACEHOLDER_TITLES.has(meaningful.toLowerCase())) continue;

    if (meaningful.length > best.length) {
      best = meaningful;
    }
  }

  return best;
}

export function cleanExternalSearchTitle(title: string, englishTitle = ''): string {
  const cleanEng = englishTitle.trim();
  const useEng =
    cleanEng &&
    !PLACEHOLDER_TITLES.has(cleanEng.toLowerCase()) &&
    stripNoiseFromTitle(cleanEng).length >= 2;

  const rawSource = useEng ? cleanEng : title;
  if (!rawSource || PLACEHOLDER_TITLES.has(rawSource.trim().toLowerCase())) {
    return '';
  }

  const cleaned = stripNoiseFromTitle(rawSource)
    .replace(/^[-–:.\s]+|[-–:.\s]+$/g, '')
    .trim();

  // Reject single-char or punctuation-only garbage queries
  const meaningfulChars = cleaned.replace(/[^A-Za-z0-9\u0600-\u06FF]/g, '');
  if (meaningfulChars.length < 2) return '';

  return cleaned;
}

export function buildExternalSearchQueries(
  title: string,
  englishTitle = '',
  extraTitle?: string
): string[] {
  const cleanedFromTitleEng = extractCleanEnglishTitleCandidate(title);
  const cleanedFromTitle = cleanExternalSearchTitle(title, '');
  const cleanedFromEnglish = cleanExternalSearchTitle('', englishTitle);
  const cleanedExtra = extraTitle ? cleanExternalSearchTitle(extraTitle, extraTitle) : '';

  const primaryList: string[] = [];
  if (
    cleanedFromTitleEng &&
    cleanedFromEnglish &&
    cleanedFromTitleEng.length > cleanedFromEnglish.length + 2 &&
    cleanedFromTitleEng.toLowerCase().startsWith(cleanedFromEnglish.toLowerCase())
  ) {
    primaryList.push(cleanedFromTitleEng, cleanedFromEnglish);
  } else {
    primaryList.push(cleanedFromEnglish, cleanedFromTitleEng);
  }
  if (cleanedExtra) primaryList.push(cleanedExtra);
  if (cleanedFromTitle) primaryList.push(cleanedFromTitle);

  // Add colon/dash subtitle-stripped base queries at the end as high-recall fallbacks
  // (e.g. "الحريفة 2: الريمونتادا" -> "الحريفة 2", "ولاد رزق 3: القاضية" -> "ولاد رزق 3")
  const baseVariants: string[] = [];
  for (const item of primaryList) {
    const clean = item.trim();
    if (!clean) continue;
    if (clean.includes(':')) {
      baseVariants.push(clean.replace(/:\s*/g, ' ').replace(/\s+/g, ' ').trim());
    }
    const splitMatch = clean.match(/^(.{3,}?)\s*(?::|–|—|\s+-\s+)\s*(.+)$/);
    if (splitMatch?.[1]) {
      const prefix = splitMatch[1].trim();
      const alnumCount = prefix.replace(/[^A-Za-z0-9\u0600-\u06FF]/g, '').length;
      if (alnumCount >= 3) {
        baseVariants.push(prefix);
      }
    }
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of [...primaryList, ...baseVariants]) {
    const clean = q.trim();
    const key = clean.toLowerCase();
    const alnumCount = clean.replace(/[^A-Za-z0-9\u0600-\u06FF]/g, '').length;
    if (alnumCount >= 2 && !seen.has(key)) {
      seen.add(key);
      out.push(clean);
    }
  }
  return out;
}

const ARABIC_STOPWORDS = new Set(['من', 'في', 'على', 'عن', 'الى', 'مع', 'و', 'ال']);
const LATIN_STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'at', 'to', 'for']);

export function normalizeTitleForComparison(value: string): string {
  const stripped = stripNoiseFromTitle(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ç/g, 'c')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ß/g, 'ss')
    .replace(/ł/g, 'l')
    .replace(/đ/g, 'd')
    .replace(/&/g, ' and ')
    .replace(/['’`":;,.!?/\\\-–—_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return stripped;
}

function tokenizeNormalizedTitle(norm: string): string[] {
  if (!norm) return [];
  return norm.split(' ').filter(Boolean);
}

const SEQUEL_WORD_TO_DIGIT: Record<string, string> = {
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  second: '2',
  third: '3',
  fourth: '4',
  fifth: '5',
  الاول: '1',
  الثاني: '2',
  ثاني: '2',
  الثالث: '3',
  ثالث: '3',
  الرابع: '4',
  رابع: '4',
  الخامس: '5',
  خامس: '5',
  السادس: '6',
  سادس: '6',
  السابع: '7',
  سابع: '7',
  الثامن: '8',
  ثامن: '8',
  التاسع: '9',
  تاسع: '9',
  العاشر: '10',
  عاشر: '10',
};

const SEQUEL_CONNECTOR_WORDS = new Set(['part', 'pt', 'chapter', 'vol', 'volume', 'الجزء', 'جزء']);

function extractTrailingOrStandaloneNumbers(tokens: string[]): string[] {
  const nums: string[] = [];
  for (const t of tokens) {
    if (/^\d{1,2}$/.test(t) && t !== '1') {
      nums.push(t);
    } else if (SEQUEL_WORD_TO_DIGIT[t]) {
      nums.push(SEQUEL_WORD_TO_DIGIT[t]);
    }
  }
  return nums;
}

function canonicalizeComparisonTokens(tokens: string[]): string[] {
  const result: string[] = [];
  for (const t of tokens) {
    if (SEQUEL_CONNECTOR_WORDS.has(t)) continue;
    if (SEQUEL_WORD_TO_DIGIT[t]) {
      result.push(SEQUEL_WORD_TO_DIGIT[t]);
    } else {
      result.push(t);
    }
  }
  return result.length > 0 ? result : tokens;
}

function scorePair(
  queryNorm: string,
  candidateNorm: string,
  expectedYearNum: number,
  candidateYearNum: number,
  expectedYearExplicit: boolean,
  isSeriesLike: boolean
): { score: number; reason: string } {
  if (!queryNorm || !candidateNorm) {
    return { score: 0, reason: 'empty' };
  }

  if (queryNorm === candidateNorm) {
    let score = 1.0;
    if (expectedYearNum > 0 && candidateYearNum > 0) {
      const diff = Math.abs(expectedYearNum - candidateYearNum);
      if (diff === 0) score += 0.1;
      else if (diff <= 1) score += 0.04;
      else if (isSeriesLike && candidateYearNum < expectedYearNum) {
        // Multi-season series/programs often list latest season year while IMDb lists premiere year
        if (diff >= 4) score -= 0.06;
      } else if (expectedYearExplicit && diff >= 4) score -= 0.35;
      else if (!expectedYearExplicit && diff >= 12) score -= 0.2;
    }
    return { score, reason: 'exact' };
  }

  const qTokens = tokenizeNormalizedTitle(queryNorm);
  const cTokens = tokenizeNormalizedTitle(candidateNorm);
  if (qTokens.length === 0 || cTokens.length === 0) {
    return { score: 0, reason: 'no_tokens' };
  }

  // Check if either title is pure Arabic while the other is pure Latin (cannot verify string equivalence reliably across scripts without external transliteration)
  const qHasArabic = /[\u0600-\u06FF]/.test(queryNorm);
  const cHasArabic = /[\u0600-\u06FF]/.test(candidateNorm);
  if (qHasArabic !== cHasArabic && !/[a-z]/.test(queryNorm)) {
    return { score: 0, reason: 'script_mismatch' };
  }

  const qCanon = canonicalizeComparisonTokens(qTokens);
  const cCanon = canonicalizeComparisonTokens(cTokens);

  const cSet = new Set(cCanon);
  const qSet = new Set(qCanon);

  let overlapCount = 0;
  for (const t of qSet) {
    if (cSet.has(t)) overlapCount++;
  }

  // Also check meaningful (non-stopword) token overlap
  const qMeaningful = qCanon.filter((t) => !ARABIC_STOPWORDS.has(t) && !LATIN_STOPWORDS.has(t));
  const cMeaningful = cCanon.filter((t) => !ARABIC_STOPWORDS.has(t) && !LATIN_STOPWORDS.has(t));
  const qMSet = new Set(qMeaningful.length ? qMeaningful : qCanon);
  const cMSet = new Set(cMeaningful.length ? cMeaningful : cCanon);

  let mOverlap = 0;
  for (const t of qMSet) {
    if (cMSet.has(t)) mOverlap++;
  }

  if (mOverlap === 0) {
    return { score: 0, reason: 'zero_overlap' };
  }

  const precision = overlapCount / Math.max(1, cSet.size);
  const recall = overlapCount / Math.max(1, qSet.size);
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const mPrecision = mOverlap / Math.max(1, cMSet.size);
  const mRecall = mOverlap / Math.max(1, qMSet.size);
  const mF1 = mPrecision + mRecall > 0 ? (2 * mPrecision * mRecall) / (mPrecision + mRecall) : 0;

  let score = Math.max(f1, mF1);

  // Sequel number safety: e.g. "Mononoke 3" vs "Mononoke" or "John Wick 4" vs "John Wick 2"
  const qNums = extractTrailingOrStandaloneNumbers(qTokens);
  const cNums = extractTrailingOrStandaloneNumbers(cTokens);
  const sequelMismatch = qNums.join(',') !== cNums.join(',');
  if (sequelMismatch) {
    score -= 0.4;
  }

  // Exact contiguous subtitle phrase boost when sequel numbers match and year aligns (e.g. "The Headless Horror" -> "Detective Kien: The Headless Horror")
  const qPhrase = qMeaningful.join(' ');
  const cPhrase = cMeaningful.join(' ');
  const isContiguousSubtitleMatch =
    !sequelMismatch &&
    qMeaningful.length >= 2 &&
    cMeaningful.length > qMeaningful.length &&
    cPhrase.includes(qPhrase) &&
    expectedYearNum > 0 &&
    candidateYearNum > 0 &&
    Math.abs(expectedYearNum - candidateYearNum) <= 1;

  if (isContiguousSubtitleMatch) {
    score = Math.max(score, 0.78);
  }

  // Reject partial matches where one side misses too many words (like "Mononoke" vs "Mononoke 3 The Curse of the Serpent")
  if (!isContiguousSubtitleMatch && Math.min(precision, recall) < 0.45 && Math.min(mPrecision, mRecall) < 0.5) {
    score = Math.min(score, 0.45);
  }

  if (expectedYearNum > 0 && candidateYearNum > 0) {
    const diff = Math.abs(expectedYearNum - candidateYearNum);
    if (diff === 0) score += 0.08;
    else if (diff === 1) score += 0.03;
    else if (isSeriesLike && candidateYearNum < expectedYearNum) {
      if (diff >= 3) score -= 0.08;
    } else if (expectedYearExplicit && diff >= 3) score -= 0.35;
    else if (diff >= 10) score -= 0.3;
  }

  return { score, reason: `f1=${f1.toFixed(2)}` };
}

export function extractValidYearNumber(value: string | undefined | null): number {
  const m = normalizeArabicDigitsShared(String(value || '')).match(/\b(19\d{2}|20[0-3]\d)\b/);
  return m ? parseInt(m[1], 10) : 0;
}

export function scoreExternalTitleMatch(params: {
  queryTitle: string;
  englishTitle?: string;
  expectedYear?: string;
  expectedYearExplicit?: boolean;
  kind?: string;
  candidateTitles: Array<string | undefined | null>;
  candidateYear?: string | undefined | null;
}): { matched: boolean; score: number; reason: string } {
  const queryForms = Array.from(
    new Set(
      [
        normalizeTitleForComparison(params.englishTitle || ''),
        normalizeTitleForComparison(params.queryTitle || ''),
      ].filter((q) => q.length >= 2 && !PLACEHOLDER_TITLES.has(q))
    )
  );

  const candidateForms = Array.from(
    new Set(
      (params.candidateTitles || [])
        .map((t) => normalizeTitleForComparison(t || ''))
        .filter((c) => c.length >= 2)
    )
  );

  if (queryForms.length === 0 || candidateForms.length === 0) {
    return { matched: false, score: 0, reason: 'missing_title_forms' };
  }

  const expectedYearNum = extractValidYearNumber(params.expectedYear);
  const candidateYearNum = extractValidYearNumber(params.candidateYear);
  const expectedYearExplicit = Boolean(params.expectedYearExplicit);
  const isSeriesLike =
    params.kind === 'series' || params.kind === 'tv' || params.kind === 'wrestling';

  let bestScore = 0;
  let bestReason = 'mismatch';

  for (const qNorm of queryForms) {
    for (const cNorm of candidateForms) {
      const res = scorePair(
        qNorm,
        cNorm,
        expectedYearNum,
        candidateYearNum,
        expectedYearExplicit,
        isSeriesLike
      );
      if (res.score > bestScore) {
        bestScore = res.score;
        bestReason = res.reason;
      }
    }
  }

  return {
    matched: bestScore >= 0.72,
    score: Number(bestScore.toFixed(3)),
    reason: bestReason,
  };
}

export function inferEffectiveYear(title: string, year?: string): { year: string; explicit: boolean } {
  const cleanYear = normalizeArabicDigitsShared(String(year || '')).trim();
  const fromTitle = normalizeArabicDigitsShared(String(title || '')).match(/\b(19\d{2}|20[0-2]\d)\b/)?.[1] || '';

  if (/^\d{4}$/.test(cleanYear) && cleanYear !== '2026') {
    return { year: cleanYear, explicit: true };
  }
  if (fromTitle && fromTitle !== '2026') {
    return { year: fromTitle, explicit: true };
  }
  if (/^\d{4}$/.test(cleanYear)) {
    return { year: cleanYear, explicit: false };
  }
  return { year: fromTitle || '', explicit: false };
}
