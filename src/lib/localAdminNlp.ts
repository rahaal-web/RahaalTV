import { EpisodeItem, MediaItem, MediaKind, SeasonItem } from '../types/media';

export type AssistantOperationType =
  | 'query_count'
  | 'query_latest'
  | 'query_search'
  | 'single_rename'
  | 'bulk_replace_text'
  | 'bulk_remove_text'
  | 'bulk_clean_fluff'
  | 'bulk_polish_story'
  | 'bulk_normalize_meta'
  | 'bulk_update_field'
  | 'bulk_tag_change'
  | 'manage_seasons_episodes'
  | 'delete_items'
  | 'unknown';

export type TargetTextField =
  | 'title'
  | 'englishTitle'
  | 'story'
  | 'tagline'
  | 'quality'
  | 'year'
  | 'country'
  | 'language'
  | 'duration'
  | 'poster'
  | 'backdrop';

export interface ParsedAdminCommand {
  rawInput: string;
  normalizedInput: string;
  operationType: AssistantOperationType;
  operationLabel: string;
  understoodCommand: string;
  isReadOnly: boolean;
  isDestructive: boolean;
  requiresConfirmation: boolean;
  isSingleTarget: boolean;
  scopeKind: 'all' | MediaKind;
  targetFields: TargetTextField[];
  searchTerms: string[];
  removeTerms: string[];
  replaceFrom?: string;
  replaceTo?: string;
  targetItemTitle?: string;
  newTitle?: string;
  fieldToSet?:
    | 'quality'
    | 'year'
    | 'country'
    | 'language'
    | 'duration'
    | 'poster'
    | 'backdrop'
    | 'story'
    | 'tagline'
    | 'pinned'
    | 'isNew'
    | 'comingSoon';
  fieldValue?: string | boolean;
  tagAction?: 'add' | 'remove';
  tagTarget?: 'categories' | 'genres';
  tagValue?: string;
  seasonAction?:
    | 'add_season'
    | 'remove_season'
    | 'add_episode'
    | 'remove_episode'
    | 'update_episodes_quality';
  seasonNumber?: number;
  episodeNumber?: number;
  episodeQuality?: string;
  filterYear?: string;
  filterCategory?: string;
  filterContains?: string;
  filterMissingField?: 'poster' | 'servers' | 'trailerUrl' | 'story';
  limitCount?: number;
  sortBy?: 'latest' | 'imdb' | 'views' | 'year';
  blockedReason?: string;
}

export interface DiffFieldEntry {
  key: string;
  label: string;
  before: string;
  after: string;
}

export interface CommandProposalEntry {
  original: MediaItem;
  updated: MediaItem;
  changedFields: DiffFieldEntry[];
  selected: boolean;
}

export interface ExecutionPreviewPlan {
  planId: string;
  command: ParsedAdminCommand;
  scannedCount: number;
  affectedCount: number;
  proposals: CommandProposalEntry[];
  matchedItems: MediaItem[];
  countSummary?: {
    total: number;
    movies: number;
    series: number;
    tv: number;
    wrestling: number;
    filteredCount?: number;
    filteredLabel?: string;
  };
  noChangeReason?: string;
}

const KIND_LABELS: Record<MediaKind, string> = {
  movie: 'فيلم',
  series: 'مسلسل',
  tv: 'برنامج / مسرحية',
  wrestling: 'مصارعة حرة',
};

const SCOPE_KIND_LABELS: Record<'all' | MediaKind, string> = {
  all: 'جميع الأعمال',
  movie: 'الأفلام',
  series: 'المسلسلات',
  tv: 'البرامج والمسرحيات',
  wrestling: 'المصارعة الحرة',
};

const FIELD_LABELS: Record<string, string> = {
  title: 'العنوان',
  englishTitle: 'الاسم الإنجليزي',
  kind: 'نوع القسم',
  categories: 'التصنيفات',
  genres: 'الأنواع',
  year: 'السنة',
  country: 'البلد',
  language: 'اللغة',
  quality: 'الجودة',
  duration: 'المدة',
  poster: 'صورة البوستر',
  backdrop: 'صورة الخلفية',
  tagline: 'الشعار الترويجي',
  story: 'القصة والوصف',
  pinned: 'مثبت بالسلايدر',
  isNew: 'شارة جديد',
  comingSoon: 'قريباً',
  seasons: 'المواسم والحلقات',
};

/**
 * Unicode-safe word boundary check (handles Arabic & Latin properly unlike `\b`).
 */
function hasWord(text: string, groupPattern: string): boolean {
  const rx = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${groupPattern})(?![\\p{L}\\p{N}_])`, 'iu');
  return rx.test(text);
}

export function normalizeArabic(text: string): string {
  return String(text || '')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTolerantArabicWordRegex(term: string, requireBoundary = true): RegExp {
  const clean = term
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .trim();

  let pattern = '';
  for (const ch of clean) {
    if (ch === 'ا' || ch === 'أ' || ch === 'إ' || ch === 'آ') {
      pattern += '[اأإآ]';
    } else if (ch === 'ه' || ch === 'ة') {
      pattern += '[هة]';
    } else if (ch === 'ي' || ch === 'ى') {
      pattern += '[يى]';
    } else if (/\s/.test(ch)) {
      pattern += '\\s+';
    } else {
      pattern += escapeRegex(ch);
    }
    if (!/\s/.test(ch)) {
      pattern += '[\\u064B-\\u065F\\u0670]*';
    }
  }

  if (!requireBoundary) {
    return new RegExp(pattern, 'giu');
  }

  return new RegExp(`(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`, 'giu');
}

function cleanupTextArtifacts(text: string): string {
  return text
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—|:،,]+/, '')
    .replace(/[\s\-–—|:،,]+$/, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/«\s*»/g, '')
    .replace(/\s+([،,.!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function removeTermFromText(originalText: string, term: string): string {
  const cleanTerm = term.trim();
  if (!cleanTerm || !originalText) return originalText;
  const rx = buildTolerantArabicWordRegex(cleanTerm, true);
  let next = originalText.replace(rx, ' ');
  if (next === originalText && cleanTerm.length >= 4 && /\s/.test(cleanTerm)) {
    const looseRx = buildTolerantArabicWordRegex(cleanTerm, false);
    next = originalText.replace(looseRx, ' ');
  }
  const cleaned = cleanupTextArtifacts(next);
  return cleaned || originalText;
}

export function replaceTermInText(originalText: string, fromTerm: string, toTerm: string): string {
  const cleanFrom = fromTerm.trim();
  if (!cleanFrom || !originalText) return originalText;
  const rx = buildTolerantArabicWordRegex(cleanFrom, true);
  let replaced = originalText.replace(rx, toTerm);
  if (replaced === originalText) {
    const looseRx = buildTolerantArabicWordRegex(cleanFrom, false);
    replaced = originalText.replace(looseRx, toTerm);
  }
  return cleanupTextArtifacts(replaced);
}

function extractQuotedValues(raw: string): string[] {
  const results: string[] = [];
  const rx = /["'«“]([^"'»”]{1,200})["'»”]/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(raw)) !== null) {
    const val = m[1].trim();
    if (val) results.push(val);
  }
  return results;
}

function detectScopeKind(norm: string, defaultScope: 'all' | MediaKind = 'all'): 'all' | MediaKind {
  const unquoted = norm.replace(/["'«“][^"'»”]*["'»”]/g, ' ');
  const withoutTargetWord = unquoted
    .replace(/(?<![\p{L}\p{N}_])(?:كلمه|عباره|لفظ|جمله)\s+\S+/gu, ' ')
    .trim();

  const checkScope = (txt: string): 'all' | MediaKind | null => {
    const m = hasWord(txt, 'فيلم|الفيلم|افلام|الافلام|للافلام|بالافلام');
    const s = hasWord(txt, 'مسلسل|المسلسل|مسلسلات|المسلسلات|للمسلسلات|بالمسلسلات');
    const t = hasWord(txt, 'برنامج|البرنامج|برامج|البرامج|مسرحيه|المسرحيه|مسرحيات|المسرحيات');
    const w = hasWord(txt, 'مصارعه|المصارعه|wwe');
    const hits = [m ? 'movie' : null, s ? 'series' : null, t ? 'tv' : null, w ? 'wrestling' : null].filter(
      Boolean
    ) as MediaKind[];
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return 'all';
    return null;
  };

  const fromStripped = checkScope(withoutTargetWord);
  if (fromStripped) return fromStripped;

  const fromUnquoted = checkScope(unquoted);
  if (fromUnquoted) return fromUnquoted;

  return defaultScope;
}

function detectTargetFields(norm: string): TargetTextField[] {
  const unquoted = norm.replace(/["'«“][^"'»”]*["'»”]/g, ' ');
  const fields: TargetTextField[] = [];

  if (hasWord(unquoted, 'كل المحتوي|جميع الحقول|كل الحقول|كافه الحقول|النصوص')) {
    return ['title', 'tagline', 'story'];
  }
  if (hasWord(unquoted, 'الاسم الانجليزي|العنوان الانجليزي|englishTitle')) {
    fields.push('englishTitle');
  }
  if (hasWord(unquoted, 'عنوان|عناوين|العنوان|العناوين|اسم|اسماء|الاسم|الاسماء|المسمي')) {
    fields.push('title');
  }
  if (hasWord(unquoted, 'وصف|اوصاف|الوصف|الاوصاف|قصه|قصص|القصه|القصص|نبذه|محتوي')) {
    fields.push('story');
  }
  if (hasWord(unquoted, 'شعار|الشعار|الشعار الترويجي|وصف مختصر|tagline')) {
    fields.push('tagline');
  }
  if (hasWord(unquoted, 'جوده|الجوده|دقه|quality')) {
    fields.push('quality');
  }
  if (hasWord(unquoted, 'سنه|السنه|عام|year')) {
    fields.push('year');
  }
  if (hasWord(unquoted, 'بلد|البلد|دوله|الدوله|country')) {
    fields.push('country');
  }
  if (hasWord(unquoted, 'لغه|اللغه|language')) {
    fields.push('language');
  }
  if (hasWord(unquoted, 'مده|المده|duration')) {
    fields.push('duration');
  }
  if (hasWord(unquoted, 'بوستر|البوستر|صوره|الصوره|غلاف|poster')) {
    fields.push('poster');
  }
  if (hasWord(unquoted, 'خلفيه|الخلفيه|backdrop')) {
    fields.push('backdrop');
  }

  return fields.length > 0 ? Array.from(new Set(fields)) : ['title'];
}

function cleanExtractedEntityName(raw: string): string {
  return raw
    .replace(/^["'«“(]+|["'»”)]+$/g, '')
    .replace(/^(?:اللي\s+اسمه|الذي\s+اسمه|بعنوان|اسمه[ا]?|المسمى|المسمي|كلمه|كلمة|عباره|عبارة)\s+/i, '')
    .replace(/\s*[.؟!]+$/, '')
    .trim();
}

function stripWrappingQuotes(raw: string): string {
  return raw
    .replace(/^["'«“]+|["'»”]+$/g, '')
    .replace(/\s*[.؟!]+$/, '')
    .trim();
}

function extractYearFilter(norm: string): string | undefined {
  const m = norm.match(
    /(?<![\p{L}\p{N}_])(?:سنه|عام|في|لـ|ل|من|الصادره\s+في\s+سنه)\s*(20[0-3]\d|19\d\d)(?![\p{L}\p{N}_])/u
  );
  if (m?.[1]) return m[1];
  const standalone = norm.match(/(?<![\p{L}\p{N}_])(202\d)(?![\p{L}\p{N}_])/u);
  if (standalone?.[1] && hasWord(norm, 'اعمال|افلام|مسلسلات|انتاج|سنه|عام')) {
    return standalone[1];
  }
  return undefined;
}

const PROMO_FLUFF_PATTERNS: RegExp[] = [
  /مشاهد[هة]\s*و?\s*تحميل/giu,
  /اون\s*لاين/giu,
  /أون\s*لاين/giu,
  /اونلاين/giu,
  /بجود[هة]\s*عالي[هة]/giu,
  /جود[هة]\s*عالي[هة]/giu,
  /بدون\s*تقطيع/giu,
  /مترجم[هة]?\s*للعربي[هة]?/giu,
  /(?<![\p{L}\p{N}_])مترجم[هة]?(?![\p{L}\p{N}_])/giu,
  /(?<![\p{L}\p{N}_])مدبلج[هة]?(?![\p{L}\p{N}_])/giu,
  /(?<![\p{L}\p{N}_])كامل[هة]?(?![\p{L}\p{N}_])/giu,
  /(?<![\p{L}\p{N}_])حصري[اً]?(?![\p{L}\p{N}_])/giu,
  /(?<![\p{L}\p{N}_])مشاهد[هة](?![\p{L}\p{N}_])/giu,
  /(?<![\p{L}\p{N}_])تحميل(?![\p{L}\p{N}_])/giu,
];

function cleanPromotionalFluff(text: string): string {
  let out = text;
  for (const rx of PROMO_FLUFF_PATTERNS) {
    out = out.replace(rx, ' ');
  }
  return cleanupTextArtifacts(out);
}

function polishStoryAndTagline(item: MediaItem): { story: string; tagline: string } {
  let story = cleanPromotionalFluff(item.story || item.title)
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/&nbsp;|&amp;|&quot;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!story) story = item.title;
  if (story.length > 20 && !/[.!؟]$/.test(story)) {
    story = `${story}.`;
  }

  let tagline = cleanPromotionalFluff(item.tagline || '');
  if (!tagline || tagline.length < 8) {
    const firstSentence = story.split(/[.!؟،]/)[0]?.trim() || story;
    tagline = firstSentence.slice(0, 120);
  }

  return { story, tagline };
}

function toTitleCaseEnglish(str: string): string {
  const minor = new Set(['of', 'the', 'and', 'in', 'on', 'at', 'to', 'a', 'an', 'for']);
  return str
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word, idx) => {
      if (!word) return '';
      if (/^[A-Z0-9]{2,4}$/.test(word)) return word;
      const lower = word.toLowerCase();
      if (idx > 0 && minor.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function normalizeCategoriesAndGenres(item: MediaItem): {
  englishTitle: string;
  categories: string[];
  genres: string[];
} {
  const englishTitle = item.englishTitle ? toTitleCaseEnglish(item.englishTitle) : item.title;
  const primaryCat =
    item.kind === 'series'
      ? 'مسلسلات'
      : item.kind === 'wrestling'
        ? 'مصارعة حرة'
        : item.kind === 'tv'
          ? 'عروض تلفزيونية'
          : 'افلام';

  const catSet = new Set<string>();
  catSet.add(primaryCat);
  for (const c of item.categories || []) {
    const cleaned = c.trim();
    if (cleaned) catSet.add(cleaned);
  }

  const genreSet = new Set<string>();
  for (const g of item.genres || []) {
    const cleaned = g.trim();
    if (cleaned) genreSet.add(cleaned);
  }
  if (genreSet.size === 0) genreSet.add('دراما');

  return {
    englishTitle,
    categories: Array.from(catSet).slice(0, 10),
    genres: Array.from(genreSet).slice(0, 10),
  };
}

/**
 * Main Rule-Based Arabic NLP Parser.
 * Parses free-form Arabic admin instructions into a deterministic, auditable command AST.
 */
export function parseArabicAdminCommand(
  rawInput: string,
  uiDefaultScope: 'all' | MediaKind = 'all'
): ParsedAdminCommand {
  const trimmedRaw = String(rawInput || '').trim();
  const norm = normalizeArabic(trimmedRaw);

  const base: ParsedAdminCommand = {
    rawInput: trimmedRaw,
    normalizedInput: norm,
    operationType: 'unknown',
    operationLabel: 'أمر غير محدد',
    understoodCommand: 'لم يتم التعرف على صيغة الأمر بشكل مؤكد.',
    isReadOnly: false,
    isDestructive: false,
    requiresConfirmation: true,
    isSingleTarget: false,
    scopeKind: uiDefaultScope,
    targetFields: ['title'],
    searchTerms: [],
    removeTerms: [],
  };

  if (!trimmedRaw || norm.length < 3) {
    return {
      ...base,
      blockedReason: 'يرجى كتابة أمر واضح باللغة العربية.',
    };
  }

  const quoted = extractQuotedValues(trimmedRaw);
  const scopeKind = detectScopeKind(norm, uiDefaultScope);
  const targetFields = detectTargetFields(norm);
  const filterYear = extractYearFilter(norm);

  // ---------------------------------------------------------------------------
  // 1. COUNT / STATS QUERIES ("اعرض عدد الأفلام الموجودة", "كم عدد المسلسلات")
  // ---------------------------------------------------------------------------
  if (
    /^(?:كم|ما|اعرض|عرض|احسب|اريد|هات|جيب|اظهر|اعطني|وريني)?\s*(?:عدد|اجمالي|مجموع|احصائيات|احصائيه)(?![\p{L}\p{N}_])/u.test(
      norm
    ) ||
    hasWord(norm, 'كم عدد|عدد افلام|عدد مسلسلات|عدد الاعمال|كم فيلم|كم مسلسل')
  ) {
    const scopeLabel = SCOPE_KIND_LABELS[scopeKind];
    return {
      ...base,
      operationType: 'query_count',
      operationLabel: 'استعلام إحصائيات وعدد',
      understoodCommand: `حساب وعرض عدد ${scopeLabel}${filterYear ? ` لسنة ${filterYear}` : ''} من قاعدة البيانات`,
      isReadOnly: true,
      requiresConfirmation: false,
      scopeKind,
      filterYear,
    };
  }

  // ---------------------------------------------------------------------------
  // 2. LATEST / TOP LIST QUERIES ("اعرض أحدث 10 أفلام", "أعلى 5 مسلسلات تقييماً")
  // ---------------------------------------------------------------------------
  const latestMatch = norm.match(
    /(?:^|[^\p{L}\p{N}_])(?:اعرض|عرض|هات|جيب|اظهر|وريني|قائمه)\s*(?:لي\s*)?(احدث|اخر|اجدد|افضل|اعلي|اكثر|اشهر)\s*(\d{1,3})?/u
  );
  if (latestMatch) {
    const keyword = latestMatch[1];
    const numMatch = norm.match(/(?<![\p{L}\p{N}_])(\d{1,3})(?![\p{L}\p{N}_])/u);
    const parsedNum = Number(latestMatch[2] || numMatch?.[1] || 10);
    const limitCount = Math.min(50, Math.max(1, Number.isFinite(parsedNum) ? parsedNum : 10));
    const sortBy: ParsedAdminCommand['sortBy'] = /افضل|اعلي/.test(keyword)
      ? 'imdb'
      : /اكثر|اشهر/.test(keyword)
        ? 'views'
        : 'latest';
    const scopeLabel = SCOPE_KIND_LABELS[scopeKind];
    return {
      ...base,
      operationType: 'query_latest',
      operationLabel: 'استعلام قائمة مرتبة',
      understoodCommand: `عرض ${sortBy === 'imdb' ? 'أعلى' : sortBy === 'views' ? 'أكثر' : 'أحدث'} ${limitCount} في ${scopeLabel}`,
      isReadOnly: true,
      requiresConfirmation: false,
      scopeKind,
      limitCount,
      sortBy,
      filterYear,
    };
  }

  // ---------------------------------------------------------------------------
  // 3. SEARCH / LIST BY CONDITION ("ابحث عن فيلم اسمه كذا", "اعرض الأفلام بدون بوستر")
  // ---------------------------------------------------------------------------
  if (
    /^(?:ابحث|بحث|دور|فتش|هات|جيب|اعرض|عرض|اظهر|وريني|هل يوجد)(?![\p{L}\p{N}_])/u.test(norm) &&
    !/^(?:عدل|غير|احذف|امسح|شيل|ازل|اضف|فعل|ثبت)(?![\p{L}\p{N}_])/u.test(norm)
  ) {
    let missingField: ParsedAdminCommand['filterMissingField'];
    if (hasWord(norm, '(?:بدون|بلا|ناقص|لا يوجد)\\s*(?:صوره|صور|بوستر|غلاف)')) {
      missingField = 'poster';
    } else if (hasWord(norm, '(?:بدون|بلا|ناقص|لا يوجد)\\s*(?:سيرفر|سيرفرات|روابط|مشاهده)')) {
      missingField = 'servers';
    } else if (hasWord(norm, '(?:بدون|بلا|ناقص|لا يوجد)\\s*(?:تريلر|اعلان|فيديو ترويجي)')) {
      missingField = 'trailerUrl';
    } else if (hasWord(norm, '(?:بدون|بلا|ناقص|لا يوجد)\\s*(?:قصه|وصف)')) {
      missingField = 'story';
    }

    let searchTerm = quoted[0] || '';
    if (!searchTerm && !missingField) {
      const m = trimmedRaw.match(
        /(?:تحتوي\s+على\s+(?:كلمة|عبارة)?|فيها\s+(?:كلمة|عبارة)?|اسمه[ا]?\s+|بعنوان\s+|عن\s+(?:الفيلم|فيلم|المسلسل|مسلسل|العمل|عمل)?\s*)(.+)$/i
      );
      if (m?.[1]) {
        searchTerm = cleanExtractedEntityName(m[1]);
      } else {
        searchTerm = cleanExtractedEntityName(
          trimmedRaw.replace(
            /^(?:ابحث|بحث|دور|فتش|اعرض|عرض|هات|جيب|اظهر|وريني)\s*(?:لي\s*)?(?:عن\s*)?(?:الفيلم|فيلم|المسلسل|مسلسل|الافلام|الأفلام|المسلسلات|العمل|الأعمال|الاعمال)?\s*/i,
            ''
          )
        );
      }
    }

    const scopeLabel = SCOPE_KIND_LABELS[scopeKind];
    return {
      ...base,
      operationType: 'query_search',
      operationLabel: 'بحث واستعلام في القاعدة',
      understoodCommand: missingField
        ? `عرض ${scopeLabel} التي ينقصها حقل (${FIELD_LABELS[missingField] || missingField})`
        : searchTerm
          ? `البحث في ${scopeLabel} عن: "${searchTerm}"`
          : `عرض ${scopeLabel}${filterYear ? ` لسنة ${filterYear}` : ''}`,
      isReadOnly: true,
      requiresConfirmation: false,
      scopeKind,
      searchTerms: searchTerm ? [searchTerm] : [],
      filterMissingField: missingField,
      filterYear,
    };
  }

  // ---------------------------------------------------------------------------
  // 4. SEASONS & EPISODES MANAGEMENT
  // ---------------------------------------------------------------------------
  if (hasWord(norm, 'موسم|الموسم|مواسم|حلقه|الحلقه|حلقات|الحلقات')) {
    const isDeleteOp = hasWord(norm, 'احذف|امسح|شيل|ازل|حذف');
    const isAddOp = hasWord(norm, 'اضف|اضافه|زود|انشئ|جديد|جديده');
    const isQualityOp = hasWord(norm, 'جوده|الجوده|دقه');

    const epNumMatch = norm.match(/(?<![\p{L}\p{N}_])(?:حلقه|الحلقه)\s*(?:رقم\s*)?(\d{1,3})(?![\p{L}\p{N}_])/u);
    const seasonNumMatch = norm.match(/(?<![\p{L}\p{N}_])(?:موسم|الموسم)\s*(?:رقم\s*)?(\d{1,2})(?![\p{L}\p{N}_])/u);
    const epNum = epNumMatch ? Number(epNumMatch[1]) : undefined;
    const seasonNum = seasonNumMatch ? Number(seasonNumMatch[1]) : 1;

    let seriesName = quoted[0] || '';
    if (!seriesName) {
      const m = trimmedRaw.match(
        /(?:ل?مسلسل|من\s+مسلسل|في\s+مسلسل|للمسلسل)\s+["'«]?([^"'»]+?)["'»]?(?:\s+(?:إلى|الى|بجودة|جودة)\s+.*)?$/i
      );
      if (m?.[1]) seriesName = cleanExtractedEntityName(m[1]);
    }

    if (isQualityOp) {
      const qMatch =
        quoted[1] ||
        trimmedRaw.match(/(?:إلى|الى|لـ|جودة)\s+([A-Za-z0-9\-\s]{2,25})$/i)?.[1]?.trim() ||
        '1080p';
      return {
        ...base,
        operationType: 'manage_seasons_episodes',
        operationLabel: 'تحديث جودة الحلقات',
        understoodCommand: seriesName
          ? `تحديث جودة حلقات مسلسل "${seriesName}" إلى "${qMatch}"`
          : `تحديث جودة حلقات المسلسلات إلى "${qMatch}"`,
        scopeKind: 'series',
        isSingleTarget: Boolean(seriesName),
        targetItemTitle: seriesName || undefined,
        seasonAction: 'update_episodes_quality',
        episodeQuality: qMatch,
      };
    }

    if (isDeleteOp && epNum) {
      return {
        ...base,
        operationType: 'manage_seasons_episodes',
        operationLabel: 'حذف حلقة من مسلسل',
        understoodCommand: `حذف الحلقة رقم ${epNum}${seasonNumMatch ? ` (الموسم ${seasonNum})` : ''} من مسلسل "${seriesName || 'المحدد'}"`,
        isDestructive: true,
        scopeKind: 'series',
        isSingleTarget: true,
        targetItemTitle: seriesName,
        seasonAction: 'remove_episode',
        seasonNumber: seasonNum,
        episodeNumber: epNum,
        blockedReason: !seriesName ? 'يرجى تحديد اسم المسلسل لحذف الحلقة منه بأمان.' : undefined,
      };
    }

    if (isDeleteOp && seasonNumMatch) {
      return {
        ...base,
        operationType: 'manage_seasons_episodes',
        operationLabel: 'حذف موسم من مسلسل',
        understoodCommand: `حذف الموسم رقم ${seasonNum} من مسلسل "${seriesName || 'المحدد'}"`,
        isDestructive: true,
        scopeKind: 'series',
        isSingleTarget: true,
        targetItemTitle: seriesName,
        seasonAction: 'remove_season',
        seasonNumber: seasonNum,
        blockedReason: !seriesName ? 'يرجى تحديد اسم المسلسل لحذف الموسم منه بأمان.' : undefined,
      };
    }

    if (isAddOp && hasWord(norm, 'موسم|الموسم') && !hasWord(norm, 'حلقه|الحلقه')) {
      return {
        ...base,
        operationType: 'manage_seasons_episodes',
        operationLabel: 'إضافة موسم جديد',
        understoodCommand: `إضافة الموسم ${seasonNumMatch ? seasonNum : 'الجديد'} إلى مسلسل "${seriesName || 'المحدد'}"`,
        scopeKind: 'series',
        isSingleTarget: true,
        targetItemTitle: seriesName,
        seasonAction: 'add_season',
        seasonNumber: seasonNumMatch ? seasonNum : undefined,
        blockedReason: !seriesName ? 'يرجى تحديد اسم المسلسل لإضافة الموسم إليه.' : undefined,
      };
    }

    if (isAddOp && hasWord(norm, 'حلقه|الحلقه')) {
      return {
        ...base,
        operationType: 'manage_seasons_episodes',
        operationLabel: 'إضافة حلقة جديدة',
        understoodCommand: `إضافة الحلقة ${epNum ?? 'التالية'}${seasonNumMatch ? ` في الموسم ${seasonNum}` : ''} لمسلسل "${seriesName || 'المحدد'}"`,
        scopeKind: 'series',
        isSingleTarget: true,
        targetItemTitle: seriesName,
        seasonAction: 'add_episode',
        seasonNumber: seasonNum,
        episodeNumber: epNum,
        blockedReason: !seriesName ? 'يرجى تحديد اسم المسلسل لإضافة الحلقة إليه.' : undefined,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // 5. CLEAN PROMOTIONAL FLUFF / POLISH STORY / NORMALIZE META PRESETS
  // ---------------------------------------------------------------------------
  if (
    hasWord(
      norm,
      'زوائد|العبارات الترويجيه|ترويجيه|تنظيف العناوين|الزائدة|اترك عنوان العمل النظيف'
    )
  ) {
    return {
      ...base,
      operationType: 'bulk_clean_fluff',
      operationLabel: 'تنظيف العناوين جماعياً',
      understoodCommand: `إزالة العبارات الترويجية الزائدة (مثل مترجم اون لاين، بجودة عالية، مشاهدة وتحميل) من ${SCOPE_KIND_LABELS[scopeKind]}`,
      scopeKind,
      targetFields: ['title'],
    };
  }

  if (
    hasWord(norm, 'اعد صياغه|صياغه القصه|تحسين القصه|الشعار الترويجي|tagline') &&
    hasWord(norm, 'قصه|القصه|story')
  ) {
    return {
      ...base,
      operationType: 'bulk_polish_story',
      operationLabel: 'تنظيف وتحسين القصة والشعار',
      understoodCommand: `تنظيف القصة والنبذة الترويجية من الروابط والزوائد في ${SCOPE_KIND_LABELS[scopeKind]}`,
      scopeKind,
      targetFields: ['story', 'tagline'],
    };
  }

  if (
    hasWord(norm, 'englishTitle|الاسم الانجليزي') &&
    hasWord(norm, 'اضبط|ضبط|نظم|تنظيم|متناسق')
  ) {
    return {
      ...base,
      operationType: 'bulk_normalize_meta',
      operationLabel: 'ضبط الاسم الإنجليزي والتصنيفات',
      understoodCommand: `تنسيق الاسم الإنجليزي وتوحيد التصنيفات والأنواع في ${SCOPE_KIND_LABELS[scopeKind]}`,
      scopeKind,
      targetFields: ['englishTitle'],
    };
  }

  // ---------------------------------------------------------------------------
  // 6. REMOVE TEXT FROM FIELD(S)
  // ---------------------------------------------------------------------------
  const isRemoveVerb = hasWord(norm, 'احذف|امسح|شيل|ازل|شطب|نظف|تخلص من|حذف|مسح|ازاله');
  const isRelativeContainsFilter = /(?:التي|اللي)\s+(?:تحتوي|تتضمن|فيها)\s+(?:علي\s+)?(?:كلمه|عباره)?/u.test(
    norm
  );
  const startsWithRemoveTextUnit =
    /(?<![\p{L}\p{N}_])(?:احذف|امسح|شيل|ازل|شطب|نظف|تخلص\s+من)\s+(?:كلمه|عباره|جمله|لفظ|نص|عبارات|كلمات)(?![\p{L}\p{N}_])/u.test(
      norm
    );
  const mentionsTextFieldTarget =
    /(?<![\p{L}\p{N}_])من\s+(?:كل\s+|جميع\s+|كافه\s+)?(?:بدايه\s+او\s+نص\s+(?:جميع\s+)?)?(?:عناوين|اسماء|عنوان|اسم|اوصاف|وصف|قصص|قصه|شعار|كل\s+المحتوي|المحتوي|الحقول|النصوص)(?![\p{L}\p{N}_])/u.test(
      norm
    );

  if (isRemoveVerb && !isRelativeContainsFilter && (startsWithRemoveTextUnit || mentionsTextFieldTarget)) {
    let removeTerms: string[] = [];

    if (quoted.length > 0) {
      removeTerms = quoted;
    } else {
      const m = trimmedRaw.match(
        /(?:احذف|امسح|شيل|أزل|ازل|شطب|نظف|تخلص\s+من)\s+(?:كلمة|عبارة|لفظ|جملة|نص)?\s*(.+?)\s+(?:من|في)\s+(?:بداية|نص|كل|جميع|كافة|عناوين|أسماء|اسماء|العناوين|الأسماء|الاسماء|أوصاف|اوصاف|الأوصاف|الاوصاف|قصص|قصة|الوصف|القصة|المحتوى|الشعار)/i
      );
      if (m?.[1]) {
        const candidate = cleanExtractedEntityName(m[1]);
        if (candidate) removeTerms.push(candidate);
      }
    }

    const fieldsLabel = targetFields.map((f) => FIELD_LABELS[f] || f).join(' و ');
    return {
      ...base,
      operationType: 'bulk_remove_text',
      operationLabel: 'حذف نص من الحقول (جماعي)',
      understoodCommand:
        removeTerms.length > 0
          ? `حذف "${removeTerms.join('، ')}" من (${fieldsLabel}) في ${SCOPE_KIND_LABELS[scopeKind]}`
          : `حذف نص محدد من (${fieldsLabel}) في ${SCOPE_KIND_LABELS[scopeKind]}`,
      scopeKind,
      targetFields,
      removeTerms,
      filterYear,
      blockedReason:
        removeTerms.length === 0
          ? 'لم يتم تحديد الكلمة أو العبارة المطلوب حذفها. مثال: احذف كلمة "فيلم" من عناوين الأفلام.'
          : undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // 7. TAG (CATEGORY / GENRE) ADD OR REMOVE
  // ---------------------------------------------------------------------------
  if (hasWord(norm, 'تصنيف|التصنيف|تصنيفات|قسم|نوع|النوع|انواع')) {
    const tagTarget: 'categories' | 'genres' = hasWord(norm, 'نوع|النوع|انواع')
      ? 'genres'
      : 'categories';
    const isTagRemove = hasWord(norm, 'احذف|امسح|شيل|ازل');
    const isTagAdd = hasWord(norm, 'اضف|زود|ضع|حط|انقل|ادرج');

    if (isTagRemove || isTagAdd) {
      let tagValue = quoted[0] || '';
      if (!tagValue) {
        const m = trimmedRaw.match(
          /(?:تصنيف|قسم|نوع)\s+(.+?)\s+(?:من|إلى|الى|لـ|ل|في|على|لجميع|لكل)/i
        );
        if (m?.[1]) tagValue = cleanExtractedEntityName(m[1]);
      }

      return {
        ...base,
        operationType: 'bulk_tag_change',
        operationLabel: isTagRemove ? 'إزالة تصنيف/نوع' : 'إضافة تصنيف/نوع',
        understoodCommand: `${isTagRemove ? 'إزالة' : 'إضافة'} ${tagTarget === 'categories' ? 'تصنيف' : 'نوع'} "${tagValue || '...'}" في ${SCOPE_KIND_LABELS[scopeKind]}`,
        scopeKind,
        tagAction: isTagRemove ? 'remove' : 'add',
        tagTarget,
        tagValue,
        filterYear,
        blockedReason: !tagValue ? 'يرجى تحديد اسم التصنيف أو النوع المطلوب.' : undefined,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // 8. DELETE ITEMS (Single vs Conditional Bulk)
  // ---------------------------------------------------------------------------
  if (isRemoveVerb) {
    const isBulkKeyword =
      hasWord(norm, 'جميع|كل|كافه|بدون') ||
      /(?:تحتوي\s+علي|اللي\s+فيها|فيها\s+كلمه|لسنه|سنه\s+\d{4})/u.test(norm);
    const unquotedNorm = norm.replace(/["'«“][^"'»”]*["'»”]/g, ' ');
    const isSingularEntity =
      hasWord(unquotedNorm, 'الفيلم|فيلم|المسلسل|مسلسل|العمل|عمل|البرنامج|برنامج|المسرحيه|مسرحيه') &&
      !hasWord(unquotedNorm, 'افلام|الافلام|مسلسلات|المسلسلات|الاعمال|اعمال|جميع|كل|كافه');

    if (!isBulkKeyword && (isSingularEntity || hasWord(norm, 'اسمه|بعنوان|اسمها'))) {
      let targetTitle = quoted[0] || '';
      if (!targetTitle) {
        const m = trimmedRaw.match(
          /(?:اللي\s+اسمه|الذي\s+اسمه|اسمه[ا]?|بعنوان|الفيلم|فيلم|المسلسل|مسلسل|العمل|عمل|البرنامج|برنامج)\s+(.+)$/i
        );
        if (m?.[1]) targetTitle = cleanExtractedEntityName(m[1]);
      }

      return {
        ...base,
        operationType: 'delete_items',
        operationLabel: 'حذف عمل محدد',
        understoodCommand: targetTitle
          ? `حذف ${scopeKind === 'all' ? 'العمل' : KIND_LABELS[scopeKind]} المطابق للاسم: "${targetTitle}"`
          : 'حذف عمل محدد (لم يتم ذكر الاسم)',
        isDestructive: true,
        isSingleTarget: true,
        scopeKind,
        targetItemTitle: targetTitle,
        blockedReason: !targetTitle
          ? 'لحذف عمل محدد بأمان، يرجى ذكر اسم الفيلم أو المسلسل.'
          : undefined,
      };
    }

    let filterContains = quoted[0] || '';
    if (!filterContains) {
      const m = trimmedRaw.match(
        /(?:تحتوي\s+على\s+(?:كلمة|عبارة)?|فيها\s+(?:كلمة|عبارة)?|تتضمن\s+(?:كلمة|عبارة)?|بعنوان\s+يحتوي)\s+(.+)$/i
      );
      if (m?.[1]) filterContains = cleanExtractedEntityName(m[1]);
    }

    const filterCategory = !filterContains
      ? trimmedRaw.match(/(?:من\s+تصنيف|في\s+تصنيف|بتصنيف)\s+["'«]?([^"'»]+)["'»]?/i)?.[1]?.trim()
      : undefined;

    const hasSafeCondition = Boolean(filterContains || filterYear || filterCategory);

    return {
      ...base,
      operationType: 'delete_items',
      operationLabel: 'حذف جماعي مشروط',
      understoodCommand: hasSafeCondition
        ? `حذف ${SCOPE_KIND_LABELS[scopeKind]}${filterContains ? ` التي تحتوي على "${filterContains}"` : ''}${filterYear ? ` لسنة ${filterYear}` : ''}${filterCategory ? ` في تصنيف "${filterCategory}"` : ''}`
        : `محاولة حذف جماعي في ${SCOPE_KIND_LABELS[scopeKind]} بدون شرط محدد`,
      isDestructive: true,
      isSingleTarget: false,
      scopeKind,
      filterContains: filterContains || undefined,
      filterYear,
      filterCategory,
      blockedReason: !hasSafeCondition
        ? 'حماية من الحذف العشوائي: يجب تحديد شرط واضح (مثل: كلمة تحتوي عليها، سنة محددة، أو اسم العمل).'
        : undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // 9. SINGLE RENAME vs BULK TEXT REPLACE vs FIELD UPDATES
  // ---------------------------------------------------------------------------
  const isModifyVerb = hasWord(
    norm,
    'غير|عدل|بدل|استبدل|حول|حدث|ضبط|اضبط|اجعل|خلي|فعل|شغل|ثبت|الغ|عطل|اوقف|ضع'
  );

  if (isModifyVerb) {
    // 9A: Boolean flag changes
    const mentionsFlag = hasWord(
      norm,
      'isnew|pinned|comingsoon|جديد|مثبت|تثبيت|السلايدر|قريبا|شاره جديد'
    );
    if (mentionsFlag) {
      let fieldToSet: ParsedAdminCommand['fieldToSet'] = 'isNew';
      if (hasWord(norm, 'pinned|مثبت|تثبيت|السلايدر')) fieldToSet = 'pinned';
      else if (hasWord(norm, 'comingsoon|قريبا')) fieldToSet = 'comingSoon';

      const turnOff = hasWord(norm, 'false|الغ|عطل|اوقف|ازل|احذف|لا|غير مفعل');
      const fieldValue = !turnOff;
      const isBulkFlag =
        hasWord(norm, 'جميع|كل|كافه|اعمال|افلام|مسلسلات|سنه') ||
        /(?<![\p{L}\p{N}_])20\d\d(?![\p{L}\p{N}_])/u.test(norm);
      const singleName = !isBulkFlag ? quoted[0] : undefined;

      return {
        ...base,
        operationType: 'bulk_update_field',
        operationLabel: singleName ? 'تحديث حالة عمل' : 'تحديث حالة/شارة جماعي',
        understoodCommand: `${fieldValue ? 'تفعيل' : 'إلغاء'} (${FIELD_LABELS[fieldToSet]}) ${singleName ? `للعمل "${singleName}"` : `في ${SCOPE_KIND_LABELS[scopeKind]}${filterYear ? ` لسنة ${filterYear}` : ''}`}`,
        scopeKind,
        isSingleTarget: Boolean(singleName),
        targetItemTitle: singleName,
        fieldToSet,
        fieldValue,
        filterYear,
      };
    }

    // 9B: Direct field updates (quality, year, country, language, poster, story, tagline)
    const explicitFieldSet =
      hasWord(
        norm,
        'جوده|الجوده|دقه|quality|سنه|السنه|بلد|البلد|دوله|لغه|اللغه|مده|المده|بوستر|البوستر|صوره|الصوره|خلفيه|الخلفيه|قصه|القصه|وصف|الوصف|شعار|الشعار'
      ) && !hasWord(norm, 'كلمه|عباره|عناوين|اسماء');

    if (explicitFieldSet) {
      let fieldToSet: ParsedAdminCommand['fieldToSet'] = 'quality';
      if (hasWord(norm, 'جوده|الجوده|دقه|quality')) fieldToSet = 'quality';
      else if (hasWord(norm, 'سنه|السنه')) fieldToSet = 'year';
      else if (hasWord(norm, 'بلد|البلد|دوله')) fieldToSet = 'country';
      else if (hasWord(norm, 'لغه|اللغه')) fieldToSet = 'language';
      else if (hasWord(norm, 'مده|المده')) fieldToSet = 'duration';
      else if (hasWord(norm, 'بوستر|البوستر|صوره|الصوره')) fieldToSet = 'poster';
      else if (hasWord(norm, 'خلفيه|الخلفيه')) fieldToSet = 'backdrop';
      else if (hasWord(norm, 'قصه|القصه|وصف|الوصف')) fieldToSet = 'story';
      else if (hasWord(norm, 'شعار|الشعار')) fieldToSet = 'tagline';

      const urlInText = trimmedRaw.match(/https?:\/\/\S+/i)?.[0];
      let newValue = urlInText || '';
      let targetItemTitle: string | undefined;

      const unquotedRaw = trimmedRaw.replace(/["'«“][^"'»”]*["'»”]/g, ' ');
      const isBulkField = hasWord(
        normalizeArabic(unquotedRaw),
        'جميع|كل|كافه|الافلام|افلام|المسلسلات|مسلسلات|الاعمال|اعمال'
      );

      if (quoted.length >= 2) {
        targetItemTitle = quoted[0];
        newValue = quoted[1];
      } else if (quoted.length === 1) {
        if (isBulkField || /(?:إلى|الى|لـ)\s*["'«“]/.test(trimmedRaw)) {
          newValue = quoted[0];
        } else {
          targetItemTitle = quoted[0];
        }
      }

      if (!newValue) {
        const toMatch = trimmedRaw.match(/\s+(?:إلى|الى|لـ|لتصبح|يساوي)\s+(.+)$/i);
        if (toMatch?.[1]) newValue = stripWrappingQuotes(toMatch[1]);
      }

      if (!targetItemTitle && !isBulkField) {
        const itemMatch = trimmedRaw.match(
          /(?:فيلم|الفيلم|مسلسل|المسلسل|عمل|العمل)\s+(.+?)\s+(?:إلى|الى|لـ)\s+/i
        );
        if (itemMatch?.[1]) {
          targetItemTitle = cleanExtractedEntityName(itemMatch[1]);
        }
      }

      return {
        ...base,
        operationType: 'bulk_update_field',
        operationLabel: targetItemTitle
          ? `تحديث ${FIELD_LABELS[fieldToSet]} لعمل محدد`
          : `تحديث ${FIELD_LABELS[fieldToSet]} جماعي`,
        understoodCommand: targetItemTitle
          ? `تحديث حقل (${FIELD_LABELS[fieldToSet]}) للعمل "${targetItemTitle}" إلى "${newValue}"`
          : `تحديث حقل (${FIELD_LABELS[fieldToSet]}) في ${SCOPE_KIND_LABELS[scopeKind]} إلى "${newValue}"`,
        scopeKind,
        isSingleTarget: Boolean(targetItemTitle),
        targetItemTitle,
        fieldToSet,
        fieldValue: newValue,
        filterYear,
        blockedReason: !newValue
          ? `يرجى تحديد القيمة الجديدة لحقل (${FIELD_LABELS[fieldToSet]}).`
          : undefined,
      };
    }

    // 9C: Single Item Rename vs Bulk Text Replace
    const unquotedNorm = norm.replace(/["'«“][^"'»”]*["'»”]/g, ' ');
    const hasExplicitBulkWord =
      hasWord(
        unquotedNorm,
        'جميع|كل|كافه|عناوين|اسماء|العناوين|الاسماء|اوصاف|الاوصاف|قصص|القصص|كلمه|عباره|لفظ|شامل|جماعي'
      ) || /(?:في\s+كل|من\s+كل)/.test(unquotedNorm);

    if (!hasExplicitBulkWord) {
      let fromTitle = '';
      let toTitle = '';

      if (quoted.length >= 2) {
        fromTitle = quoted[0];
        toTitle = quoted[1];
      } else {
        const fromToMatch = trimmedRaw.match(
          /(?:غير|عدل|بدل|حول)\s+(?:اسم|عنوان)\s+(?:الفيلم|فيلم|المسلسل|مسلسل|العمل|عمل)?\s*(?:من\s+)(.+?)\s+(?:إلى|الى|لـ)\s+(.+)$/i
        );
        const directToMatch = trimmedRaw.match(
          /(?:غير|عدل|بدل|حول)\s+(?:اسم|عنوان)\s+(?:الفيلم|فيلم|المسلسل|مسلسل|العمل|عمل)\s+(?:اللي\s+اسمه\s+|الذي\s+اسمه\s+)?(.+?)\s+(?:إلى|الى|لـ)\s+(.+)$/i
        );
        const m = fromToMatch || directToMatch;
        if (m) {
          fromTitle = cleanExtractedEntityName(m[1]);
          toTitle = stripWrappingQuotes(m[2]);
        }
      }

      if (fromTitle || toTitle) {
        return {
          ...base,
          operationType: 'single_rename',
          operationLabel: 'تعديل عنوان عمل واحد',
          understoodCommand: `تغيير اسم ${scopeKind === 'all' ? 'العمل' : KIND_LABELS[scopeKind]} من "${fromTitle}" إلى "${toTitle}"`,
          isSingleTarget: true,
          scopeKind,
          targetFields: ['title'],
          targetItemTitle: fromTitle,
          newTitle: toTitle,
          blockedReason:
            !fromTitle || !toTitle
              ? 'يرجى تحديد الاسم الحالي والاسم الجديد بوضوح، مثال: غير اسم الفيلم من "الاسم القديم" إلى "الاسم الجديد".'
              : undefined,
        };
      }
    }

    // Bulk text replace
    let replaceFrom = '';
    let replaceTo = '';
    if (quoted.length >= 2) {
      replaceFrom = quoted[0];
      replaceTo = quoted[1];
    } else {
      const m = trimmedRaw.match(
        /(?:استبدل|بدل|غير|عدل|حول)\s+(?:كلمة|عبارة|نص)?\s*(.+?)\s+(?:بـ\s*|ب\s+|إلى\s+|الى\s+)(.+?)(?:\s+(?:في|من)\s+(?:جميع|كل|كافة|عناوين|أسماء|أوصاف|قصص|الأفلام|المسلسلات|المحتوى).*)?$/i
      );
      if (m) {
        replaceFrom = cleanExtractedEntityName(m[1]);
        replaceTo = stripWrappingQuotes(m[2]);
      }
    }

    if (replaceFrom && replaceTo !== undefined) {
      const fieldsLabel = targetFields.map((f) => FIELD_LABELS[f] || f).join(' و ');
      return {
        ...base,
        operationType: 'bulk_replace_text',
        operationLabel: 'استبدال نص جماعي',
        understoodCommand: `استبدال "${replaceFrom}" بـ "${replaceTo}" في (${fieldsLabel}) ضمن ${SCOPE_KIND_LABELS[scopeKind]}`,
        scopeKind,
        targetFields,
        replaceFrom,
        replaceTo,
        filterYear,
      };
    }
  }

  return {
    ...base,
    blockedReason:
      'لم أتمكن من فهم الأمر بدقة. جرّب صياغة مثل: "احذف كلمة فيلم من عناوين الأفلام"، أو "غير اسم الفيلم من X إلى Y"، أو "اعرض أحدث 10 أفلام".',
  };
}

function titleMatchScore(item: MediaItem, queryRaw: string): number {
  const qNorm = normalizeArabic(queryRaw).toLowerCase();
  const tNorm = normalizeArabic(item.title).toLowerCase();
  const eNorm = normalizeArabic(item.englishTitle || '').toLowerCase();
  if (!qNorm) return 0;
  if (tNorm === qNorm || eNorm === qNorm) return 100;
  if (tNorm.startsWith(qNorm) || eNorm.startsWith(qNorm)) return 80;
  if (tNorm.includes(qNorm) || eNorm.includes(qNorm)) return 60;

  const qTokens = qNorm.split(/\s+/).filter((t) => t.length >= 2);
  if (qTokens.length === 0) return 0;
  const matchedTokens = qTokens.filter((tok) => tNorm.includes(tok) || eNorm.includes(tok));
  if (matchedTokens.length === qTokens.length) return 50;
  if (matchedTokens.length > 0 && matchedTokens.length >= Math.ceil(qTokens.length * 0.7)) return 30;
  return 0;
}

export function itemMatchesSearch(item: MediaItem, queryRaw: string): boolean {
  const qNorm = normalizeArabic(queryRaw).toLowerCase();
  if (!qNorm) return true;
  const haystack = normalizeArabic(
    [
      item.title,
      item.englishTitle,
      item.story,
      item.tagline,
      item.year,
      item.country,
      item.quality,
      ...(item.categories || []),
      ...(item.genres || []),
    ].join(' ')
  ).toLowerCase();

  if (haystack.includes(qNorm)) return true;
  const tokens = qNorm.split(/\s+/).filter((t) => t.length >= 2);
  return tokens.length > 0 && tokens.every((tok) => haystack.includes(tok));
}

function buildDiffFieldsForUpdate(original: MediaItem, updated: MediaItem): DiffFieldEntry[] {
  const diffs: DiffFieldEntry[] = [];
  if (updated.title !== original.title) {
    diffs.push({ key: 'title', label: FIELD_LABELS.title, before: original.title, after: updated.title });
  }
  if (updated.englishTitle !== original.englishTitle) {
    diffs.push({
      key: 'englishTitle',
      label: FIELD_LABELS.englishTitle,
      before: original.englishTitle,
      after: updated.englishTitle,
    });
  }
  if (updated.story !== original.story) {
    diffs.push({ key: 'story', label: FIELD_LABELS.story, before: original.story, after: updated.story });
  }
  if (updated.tagline !== original.tagline) {
    diffs.push({
      key: 'tagline',
      label: FIELD_LABELS.tagline,
      before: original.tagline || '—',
      after: updated.tagline || '—',
    });
  }
  if (updated.quality !== original.quality) {
    diffs.push({ key: 'quality', label: FIELD_LABELS.quality, before: original.quality, after: updated.quality });
  }
  if (updated.year !== original.year) {
    diffs.push({ key: 'year', label: FIELD_LABELS.year, before: original.year, after: updated.year });
  }
  if (updated.country !== original.country) {
    diffs.push({ key: 'country', label: FIELD_LABELS.country, before: original.country, after: updated.country });
  }
  if (updated.language !== original.language) {
    diffs.push({ key: 'language', label: FIELD_LABELS.language, before: original.language, after: updated.language });
  }
  if (updated.duration !== original.duration) {
    diffs.push({ key: 'duration', label: FIELD_LABELS.duration, before: original.duration, after: updated.duration });
  }
  if (updated.poster !== original.poster) {
    diffs.push({ key: 'poster', label: FIELD_LABELS.poster, before: original.poster, after: updated.poster });
  }
  if (updated.backdrop !== original.backdrop) {
    diffs.push({ key: 'backdrop', label: FIELD_LABELS.backdrop, before: original.backdrop, after: updated.backdrop });
  }
  if (Boolean(updated.pinned) !== Boolean(original.pinned)) {
    diffs.push({
      key: 'pinned',
      label: FIELD_LABELS.pinned,
      before: original.pinned ? 'نعم' : 'لا',
      after: updated.pinned ? 'نعم' : 'لا',
    });
  }
  if (Boolean(updated.isNew) !== Boolean(original.isNew)) {
    diffs.push({
      key: 'isNew',
      label: FIELD_LABELS.isNew,
      before: original.isNew ? 'نعم' : 'لا',
      after: updated.isNew ? 'نعم' : 'لا',
    });
  }
  if (Boolean(updated.comingSoon) !== Boolean(original.comingSoon)) {
    diffs.push({
      key: 'comingSoon',
      label: FIELD_LABELS.comingSoon,
      before: original.comingSoon ? 'نعم' : 'لا',
      after: updated.comingSoon ? 'نعم' : 'لا',
    });
  }
  if ((updated.categories || []).join('، ') !== (original.categories || []).join('، ')) {
    diffs.push({
      key: 'categories',
      label: FIELD_LABELS.categories,
      before: (original.categories || []).join('، ') || '—',
      after: (updated.categories || []).join('، ') || '—',
    });
  }
  if ((updated.genres || []).join('، ') !== (original.genres || []).join('، ')) {
    diffs.push({
      key: 'genres',
      label: FIELD_LABELS.genres,
      before: (original.genres || []).join('، ') || '—',
      after: (updated.genres || []).join('، ') || '—',
    });
  }
  const origSeasonsStr = (original.seasons || [])
    .map(
      (s) =>
        `${s.label} (${s.episodes.length} ح${s.episodes[0]?.quality ? ` - ${s.episodes[0].quality}` : ''})`
    )
    .join(' | ');
  const nextSeasonsStr = (updated.seasons || [])
    .map(
      (s) =>
        `${s.label} (${s.episodes.length} ح${s.episodes[0]?.quality ? ` - ${s.episodes[0].quality}` : ''})`
    )
    .join(' | ');
  if (origSeasonsStr !== nextSeasonsStr) {
    diffs.push({
      key: 'seasons',
      label: FIELD_LABELS.seasons,
      before: origSeasonsStr || 'لا توجد مواسم',
      after: nextSeasonsStr || 'لا توجد مواسم',
    });
  }
  return diffs;
}

function applySeasonEpisodeAction(item: MediaItem, cmd: ParsedAdminCommand): MediaItem {
  const existingSeasons: SeasonItem[] = (item.seasons || []).map((s) => ({
    ...s,
    episodes: [...(s.episodes || [])],
  }));

  if (cmd.seasonAction === 'add_season') {
    const nextNum =
      cmd.seasonNumber ||
      (existingSeasons.length > 0
        ? Math.max(...existingSeasons.map((s) => s.seasonNumber)) + 1
        : 1);
    if (existingSeasons.some((s) => s.seasonNumber === nextNum)) return item;
    existingSeasons.push({
      seasonNumber: nextNum,
      label: `الموسم ${String(nextNum).padStart(2, '0')}`,
      year: item.year || '2026',
      episodes: [],
    });
    existingSeasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
    return { ...item, seasons: existingSeasons };
  }

  if (cmd.seasonAction === 'remove_season' && cmd.seasonNumber) {
    const filtered = existingSeasons.filter((s) => s.seasonNumber !== cmd.seasonNumber);
    if (filtered.length === existingSeasons.length) return item;
    return { ...item, seasons: filtered };
  }

  if (cmd.seasonAction === 'add_episode') {
    const targetSeasonNum = cmd.seasonNumber || existingSeasons[0]?.seasonNumber || 1;
    let season = existingSeasons.find((s) => s.seasonNumber === targetSeasonNum);
    if (!season) {
      season = {
        seasonNumber: targetSeasonNum,
        label: `الموسم ${String(targetSeasonNum).padStart(2, '0')}`,
        year: item.year || '2026',
        episodes: [],
      };
      existingSeasons.push(season);
    }
    const nextEpNum =
      cmd.episodeNumber ||
      (season.episodes.length > 0 ? Math.max(...season.episodes.map((e) => e.number)) + 1 : 1);
    if (season.episodes.some((e) => e.number === nextEpNum)) return item;
    const newEp: EpisodeItem = {
      number: nextEpNum,
      title: `الحلقة ${String(nextEpNum).padStart(2, '0')}`,
      duration: '45 دقيقة',
      quality: item.quality || '1080p',
    };
    season.episodes.push(newEp);
    season.episodes.sort((a, b) => a.number - b.number);
    return { ...item, seasons: existingSeasons };
  }

  if (cmd.seasonAction === 'remove_episode' && cmd.episodeNumber) {
    const targetSeasonNum = cmd.seasonNumber;
    let changed = false;
    const updatedSeasons = existingSeasons.map((s) => {
      if (targetSeasonNum && s.seasonNumber !== targetSeasonNum) return s;
      const filteredEps = s.episodes.filter((e) => e.number !== cmd.episodeNumber);
      if (filteredEps.length !== s.episodes.length) changed = true;
      return { ...s, episodes: filteredEps };
    });
    return changed ? { ...item, seasons: updatedSeasons } : item;
  }

  if (cmd.seasonAction === 'update_episodes_quality' && cmd.episodeQuality) {
    if (existingSeasons.length === 0) return item;
    const nextQual = cmd.episodeQuality;
    const updatedSeasons = existingSeasons.map((s) => ({
      ...s,
      episodes: s.episodes.map((e) => ({ ...e, quality: nextQual })),
    }));
    return { ...item, seasons: updatedSeasons };
  }

  return item;
}

/**
 * Generates an auditable ExecutionPreviewPlan from scoped items WITHOUT mutating any data.
 */
export function buildExecutionPreviewPlan(
  cmd: ParsedAdminCommand,
  scopedItems: MediaItem[],
  fullStats?: ExecutionPreviewPlan['countSummary']
): ExecutionPreviewPlan {
  const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (cmd.blockedReason || cmd.operationType === 'unknown') {
    return {
      planId,
      command: cmd,
      scannedCount: scopedItems.length,
      affectedCount: 0,
      proposals: [],
      matchedItems: [],
      noChangeReason: cmd.blockedReason || 'تعذر فهم الأمر.',
    };
  }

  const candidatePool = scopedItems.filter((item) => {
    if (cmd.scopeKind !== 'all' && item.kind !== cmd.scopeKind) return false;
    if (cmd.filterYear && String(item.year || '').trim() !== cmd.filterYear) return false;
    if (
      cmd.filterCategory &&
      !(item.categories || []).some(
        (c) => normalizeArabic(c) === normalizeArabic(cmd.filterCategory!)
      )
    ) {
      return false;
    }
    return true;
  });

  if (cmd.operationType === 'query_count') {
    const movies = scopedItems.filter((i) => i.kind === 'movie').length;
    const series = scopedItems.filter((i) => i.kind === 'series').length;
    const tv = scopedItems.filter((i) => i.kind === 'tv').length;
    const wrestling = scopedItems.filter((i) => i.kind === 'wrestling').length;
    const stats = fullStats || {
      total: scopedItems.length,
      movies,
      series,
      tv,
      wrestling,
    };
    return {
      planId,
      command: cmd,
      scannedCount: stats.total,
      affectedCount: cmd.filterYear
        ? candidatePool.length
        : cmd.scopeKind === 'all'
          ? stats.total
          : candidatePool.length,
      proposals: [],
      matchedItems: candidatePool.slice(0, 12),
      countSummary: {
        ...stats,
        filteredCount: candidatePool.length,
        filteredLabel: `${SCOPE_KIND_LABELS[cmd.scopeKind]}${cmd.filterYear ? ` (${cmd.filterYear})` : ''}`,
      },
    };
  }

  if (cmd.operationType === 'query_latest') {
    const sorted = [...candidatePool].sort((a, b) => {
      if (cmd.sortBy === 'imdb') return (b.imdb || 0) - (a.imdb || 0);
      if (cmd.sortBy === 'views') return (b.views || 0) - (a.views || 0);
      const tDiff = (b.updatedAtMs || b.createdAtMs || 0) - (a.updatedAtMs || a.createdAtMs || 0);
      if (tDiff !== 0) return tDiff;
      return (parseInt(b.year || '0', 10) || 0) - (parseInt(a.year || '0', 10) || 0);
    });
    const sliced = sorted.slice(0, cmd.limitCount || 10);
    return {
      planId,
      command: cmd,
      scannedCount: candidatePool.length,
      affectedCount: sliced.length,
      proposals: [],
      matchedItems: sliced,
      noChangeReason: sliced.length === 0 ? 'لا توجد أعمال مطابقة في هذا القسم.' : undefined,
    };
  }

  if (cmd.operationType === 'query_search') {
    const matched = candidatePool.filter((item) => {
      if (cmd.filterMissingField === 'poster') {
        return !item.poster || !item.poster.trim();
      }
      if (cmd.filterMissingField === 'servers') {
        return !item.servers || item.servers.length === 0;
      }
      if (cmd.filterMissingField === 'trailerUrl') {
        return !item.trailerUrl || !item.trailerUrl.trim();
      }
      if (cmd.filterMissingField === 'story') {
        return !item.story || item.story.trim().length < 15;
      }
      if (cmd.searchTerms.length > 0) {
        return cmd.searchTerms.some((term) => itemMatchesSearch(item, term));
      }
      return true;
    });

    return {
      planId,
      command: cmd,
      scannedCount: candidatePool.length,
      affectedCount: matched.length,
      proposals: [],
      matchedItems: matched.slice(0, 50),
      noChangeReason:
        matched.length === 0
          ? `لم يتم العثور على أي نتائج مطابقة في ${SCOPE_KIND_LABELS[cmd.scopeKind]}.`
          : undefined,
    };
  }

  const findSingleTargetItems = (targetQuery: string): MediaItem[] => {
    const scored = candidatePool
      .map((item) => ({ item, score: titleMatchScore(item, targetQuery) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return [];
    const topScore = scored[0].score;
    if (topScore === 100) {
      return scored.filter((s) => s.score === 100).map((s) => s.item);
    }
    return [scored[0].item];
  };

  if (cmd.operationType === 'delete_items') {
    let targets: MediaItem[] = [];
    if (cmd.isSingleTarget && cmd.targetItemTitle) {
      targets = findSingleTargetItems(cmd.targetItemTitle);
    } else if (cmd.filterContains) {
      targets = candidatePool.filter((item) => itemMatchesSearch(item, cmd.filterContains!));
    } else if (cmd.filterYear || cmd.filterCategory) {
      targets = candidatePool;
    }

    const proposals: CommandProposalEntry[] = targets.map((item) => ({
      original: item,
      updated: item,
      changedFields: [
        {
          key: 'delete',
          label: 'الإجراء',
          before: `${item.title} (${KIND_LABELS[item.kind]} • ${item.year})`,
          after: 'حذف نهائي من قاعدة البيانات',
        },
      ],
      selected: true,
    }));

    return {
      planId,
      command: cmd,
      scannedCount: candidatePool.length,
      affectedCount: proposals.length,
      proposals,
      matchedItems: targets,
      noChangeReason:
        proposals.length === 0
          ? 'لم يتم العثور على أي عمل يطابق شرط الحذف المحدد — لم يتم المساس بأي بيانات.'
          : undefined,
    };
  }

  let workingPool = candidatePool;
  if (cmd.isSingleTarget && cmd.targetItemTitle) {
    workingPool = findSingleTargetItems(cmd.targetItemTitle);
  }

  const proposals: CommandProposalEntry[] = [];

  for (const item of workingPool) {
    let updated: MediaItem = { ...item };

    switch (cmd.operationType) {
      case 'single_rename': {
        if (cmd.newTitle && cmd.newTitle.trim() && cmd.newTitle.trim() !== item.title) {
          updated.title = cmd.newTitle.trim().slice(0, 200);
        }
        break;
      }

      case 'bulk_remove_text': {
        for (const field of cmd.targetFields) {
          const val = updated[field];
          if (typeof val === 'string' && val) {
            let nextVal = val;
            for (const term of cmd.removeTerms) {
              nextVal = removeTermFromText(nextVal, term);
            }
            if (nextVal !== val) {
              updated = { ...updated, [field]: nextVal };
            }
          }
        }
        break;
      }

      case 'bulk_replace_text': {
        if (cmd.replaceFrom) {
          for (const field of cmd.targetFields) {
            const val = updated[field];
            if (typeof val === 'string' && val) {
              const nextVal = replaceTermInText(val, cmd.replaceFrom, cmd.replaceTo || '');
              if (nextVal !== val) {
                updated = { ...updated, [field]: nextVal };
              }
            }
          }
        }
        break;
      }

      case 'bulk_clean_fluff': {
        const nextTitle = cleanPromotionalFluff(item.title);
        if (nextTitle && nextTitle !== item.title) {
          updated.title = nextTitle;
        }
        break;
      }

      case 'bulk_polish_story': {
        const polished = polishStoryAndTagline(item);
        updated.story = polished.story;
        updated.tagline = polished.tagline;
        break;
      }

      case 'bulk_normalize_meta': {
        const normalized = normalizeCategoriesAndGenres(item);
        updated.englishTitle = normalized.englishTitle;
        updated.categories = normalized.categories;
        updated.genres = normalized.genres;
        break;
      }

      case 'bulk_update_field': {
        if (cmd.fieldToSet && cmd.fieldValue !== undefined) {
          updated = { ...updated, [cmd.fieldToSet]: cmd.fieldValue };
        }
        break;
      }

      case 'bulk_tag_change': {
        if (cmd.tagTarget && cmd.tagValue) {
          const currentTags = [...(updated[cmd.tagTarget] || [])];
          const normTarget = normalizeArabic(cmd.tagValue);
          if (cmd.tagAction === 'remove') {
            const filtered = currentTags.filter((t) => normalizeArabic(t) !== normTarget);
            if (filtered.length > 0 && filtered.length !== currentTags.length) {
              updated = { ...updated, [cmd.tagTarget]: filtered };
            }
          } else if (cmd.tagAction === 'add') {
            const exists = currentTags.some((t) => normalizeArabic(t) === normTarget);
            if (!exists && currentTags.length < 10) {
              updated = { ...updated, [cmd.tagTarget]: [...currentTags, cmd.tagValue] };
            }
          }
        }
        break;
      }

      case 'manage_seasons_episodes': {
        updated = applySeasonEpisodeAction(item, cmd);
        break;
      }
    }

    const changedFields = buildDiffFieldsForUpdate(item, updated);
    if (changedFields.length > 0) {
      proposals.push({
        original: item,
        updated,
        changedFields,
        selected: true,
      });
    }
  }

  return {
    planId,
    command: cmd,
    scannedCount: workingPool.length,
    affectedCount: proposals.length,
    proposals,
    matchedItems: proposals.map((p) => p.updated),
    noChangeReason:
      proposals.length === 0
        ? cmd.isSingleTarget && cmd.targetItemTitle
          ? `لم يتم العثور على عمل مطابق لـ "${cmd.targetItemTitle}" أو أن القيمة مطبقة بالفعل.`
          : `تم فحص ${workingPool.length} عملًا، ولم تنطبق التعديلات المطلوبة على أي عنصر.`
        : undefined,
  };
}
