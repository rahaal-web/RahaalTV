import type { MediaItem } from '../types/media';

export function normalizeArabicText(value: string): string {
  return String(value || '')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/الآفلام/g, 'الافلام')
    .replace(/الآضافات/g, 'الاضافات')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const ARAB_COUNTRIES = [
  'مصر',
  'السعوديه',
  'الامارات',
  'الكويت',
  'لبنان',
  'سوريا',
  'الاردن',
  'المغرب',
  'تونس',
  'الجزائر',
  'العراق',
  'البحرين',
  'قطر',
  'عمان',
  'فلسطين',
  'اليمن',
  'السودان',
  'ليبيا',
];

const ASIAN_HINTS = [
  'اليابان',
  'كوريا',
  'الصين',
  'تايلاند',
  'اندونيسيا',
  'الفلبين',
  'اليابانيه',
  'الكوريه',
  'الصينيه',
];

function isMovieItem(item: MediaItem, catsNorm: string[]): boolean {
  if (item.kind === 'movie') return true;
  if (item.kind === 'series' || item.kind === 'wrestling' || item.kind === 'tv') return false;
  return catsNorm.some((c) => c.includes('افلام') || c.includes('فيلم'));
}

function isSeriesItem(item: MediaItem, catsNorm: string[]): boolean {
  if (item.kind === 'series') return true;
  if (item.kind === 'movie' || item.kind === 'wrestling' || item.kind === 'tv') return false;
  return catsNorm.some((c) => c.includes('مسلسل'));
}

function isArabicOrigin(item: MediaItem, catsNorm: string[]): boolean {
  const countryNorm = normalizeArabicText(item.country);
  const langNorm = normalizeArabicText(item.language);
  const titleNorm = normalizeArabicText(item.title);
  if (catsNorm.some((c) => c.includes('عرب'))) return true;
  if (ARAB_COUNTRIES.some((c) => countryNorm.includes(c))) return true;
  if (langNorm.includes('العربيه') && !langNorm.includes('مترجم') && !langNorm.includes('مدبلج')) {
    return true;
  }
  if (/عربي|مصري|خليجي|سعودي|شامي/.test(titleNorm)) return true;
  return false;
}

function isTurkishOrigin(item: MediaItem, catsNorm: string[]): boolean {
  const haystack = normalizeArabicText(
    `${item.country} ${item.language} ${item.title} ${catsNorm.join(' ')}`
  );
  return haystack.includes('تركيا') || haystack.includes('التركيه') || haystack.includes('تركي');
}

function isIndianOrigin(item: MediaItem, catsNorm: string[]): boolean {
  const haystack = normalizeArabicText(
    `${item.country} ${item.language} ${item.title} ${catsNorm.join(' ')}`
  );
  return (
    haystack.includes('الهند') ||
    haystack.includes('الهنديه') ||
    haystack.includes('هندي') ||
    haystack.includes('بوليوود')
  );
}

function isAsianOrigin(item: MediaItem, catsNorm: string[]): boolean {
  const haystack = normalizeArabicText(
    `${item.country} ${item.language} ${item.title} ${catsNorm.join(' ')}`
  );
  return haystack.includes('اسيوي') || ASIAN_HINTS.some((hint) => haystack.includes(hint));
}

function isAnimationItem(item: MediaItem, catsNorm: string[]): boolean {
  const genresNorm = (item.genres || []).map(normalizeArabicText);
  const haystack = normalizeArabicText(
    `${item.title} ${item.tagline} ${catsNorm.join(' ')} ${genresNorm.join(' ')}`
  );
  return (
    haystack.includes('كرتون') ||
    haystack.includes('انيميشن') ||
    haystack.includes('انمي') ||
    haystack.includes('animation') ||
    haystack.includes('anime')
  );
}

function isNetflixItem(item: MediaItem, catsNorm: string[]): boolean {
  const haystack = normalizeArabicText(
    `${item.title} ${item.englishTitle} ${item.tagline} ${item.story} ${catsNorm.join(' ')}`
  );
  return haystack.includes('نيتفليكس') || haystack.includes('نتفليكس') || haystack.includes('netflix');
}

export function matchesCategoryFilter(item: MediaItem, rawCategory: string): boolean {
  const target = normalizeArabicText(rawCategory);
  if (!target) return true;

  const catsNorm = (item.categories || []).map(normalizeArabicText).filter(Boolean);

  if (catsNorm.some((c) => c === target)) return true;

  if (target === 'افلام') {
    return isMovieItem(item, catsNorm);
  }
  if (target === 'مسلسلات') {
    return isSeriesItem(item, catsNorm);
  }

  if (target === 'افلام اجنبيه' || target === 'افلام اجنبي') {
    if (!isMovieItem(item, catsNorm)) return false;
    if (catsNorm.some((c) => c.includes('اجنب'))) return true;
    return (
      !isArabicOrigin(item, catsNorm) &&
      !isTurkishOrigin(item, catsNorm) &&
      !isIndianOrigin(item, catsNorm) &&
      !isAsianOrigin(item, catsNorm) &&
      !isAnimationItem(item, catsNorm)
    );
  }
  if (target === 'افلام عربيه' || target === 'افلام عربي') {
    return isMovieItem(item, catsNorm) && isArabicOrigin(item, catsNorm);
  }
  if (target === 'افلام تركيه' || target === 'افلام تركي') {
    return isMovieItem(item, catsNorm) && isTurkishOrigin(item, catsNorm);
  }
  if (target === 'افلام هنديه' || target === 'افلام هندي') {
    return isMovieItem(item, catsNorm) && isIndianOrigin(item, catsNorm);
  }
  if (target === 'افلام اسيويه' || target === 'افلام اسيوي') {
    return (
      isMovieItem(item, catsNorm) &&
      (isAsianOrigin(item, catsNorm) || isIndianOrigin(item, catsNorm))
    );
  }
  if (target === 'افلام كرتون' || target === 'افلام انمي') {
    return isMovieItem(item, catsNorm) && isAnimationItem(item, catsNorm);
  }
  if (target === 'افلام نيتفليكس' || target === 'افلام نتفليكس') {
    return isMovieItem(item, catsNorm) && isNetflixItem(item, catsNorm);
  }

  if (target === 'مسلسلات اجنبيه' || target === 'مسلسلات اجنبي') {
    if (!isSeriesItem(item, catsNorm)) return false;
    if (catsNorm.some((c) => c.includes('اجنب'))) return true;
    return (
      !isArabicOrigin(item, catsNorm) &&
      !isTurkishOrigin(item, catsNorm) &&
      !isIndianOrigin(item, catsNorm) &&
      !isAsianOrigin(item, catsNorm) &&
      !isAnimationItem(item, catsNorm)
    );
  }
  if (target === 'مسلسلات عربيه' || target === 'مسلسلات عربي') {
    return isSeriesItem(item, catsNorm) && isArabicOrigin(item, catsNorm);
  }
  if (target === 'مسلسلات تركيه' || target === 'مسلسلات تركي') {
    return isSeriesItem(item, catsNorm) && isTurkishOrigin(item, catsNorm);
  }
  if (target === 'مسلسلات هنديه' || target === 'مسلسلات هندي') {
    return isSeriesItem(item, catsNorm) && isIndianOrigin(item, catsNorm);
  }
  if (target === 'مسلسلات اسيويه' || target === 'مسلسلات اسيوي') {
    return isSeriesItem(item, catsNorm) && isAsianOrigin(item, catsNorm);
  }
  if (target === 'مسلسلات كرتون' || target === 'مسلسلات انمي') {
    return isSeriesItem(item, catsNorm) && isAnimationItem(item, catsNorm);
  }
  if (target === 'مسلسلات نيتفليكس' || target === 'مسلسلات نتفليكس') {
    return isSeriesItem(item, catsNorm) && isNetflixItem(item, catsNorm);
  }

  if (target.includes('رمضان')) {
    const hay = normalizeArabicText(
      `${item.title} ${item.tagline} ${item.story} ${catsNorm.join(' ')}`
    );
    return hay.includes('رمضان');
  }
  if (target === 'احدث الحلقات') {
    return (
      catsNorm.some((c) => c.includes('حلقات')) ||
      item.kind === 'series' ||
      Boolean(item.seasons && item.seasons.length > 0)
    );
  }
  if (target === 'يعرض قريبا') {
    return Boolean(item.comingSoon) || catsNorm.some((c) => c.includes('قريبا'));
  }
  if (target.includes('مصارع')) {
    return (
      item.kind === 'wrestling' ||
      catsNorm.some((c) => c.includes('مصارع')) ||
      /مصارع|wwe|wrestlemania|smackdown|\braw\b/i.test(`${item.title} ${item.englishTitle}`)
    );
  }
  if (target === 'عروض تلفزيونيه') {
    return (
      item.kind === 'tv' ||
      catsNorm.some((c) => c.includes('تلفزيون') || c.includes('مسرح') || c.includes('برامج'))
    );
  }
  if (target === 'المسرحيات' || target === 'مسرحيات') {
    return (
      catsNorm.some((c) => c.includes('مسرح')) ||
      normalizeArabicText(item.title).includes('مسرحي')
    );
  }
  if (target === 'برامج تلفزيونيه') {
    return (
      catsNorm.some((c) => c.includes('برامج')) ||
      normalizeArabicText(item.title).includes('برنامج')
    );
  }
  if (target.includes('سلاسل')) {
    return (
      catsNorm.some((c) => c.includes('سلاسل')) ||
      Boolean(item.franchiseIds && item.franchiseIds.length > 0)
    );
  }

  return catsNorm.some((c) => c.includes(target) || target.includes(c));
}
