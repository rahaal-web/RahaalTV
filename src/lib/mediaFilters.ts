import { SyntheticEvent } from 'react';
import fallbackBackdropImg from '../assets/images/hero_scifi_backdrop_1794813333496.jpg';
import fallbackPosterImg from '../assets/images/poster_running_man_1794813333683.jpg';
import { FILTER_OPTIONS } from '../data/catalog';
import { CatalogFilterState, MediaItem } from '../types/media';

export const FALLBACK_POSTER = fallbackPosterImg;
export const FALLBACK_BACKDROP = fallbackBackdropImg;

export function resolveMediaAssetUrl(url: string | undefined | null, fallback = ''): string {
  const clean = String(url || '').trim();
  if (!clean) return fallback;
  if (clean.startsWith('/src/assets/')) {
    const base = import.meta.env.BASE_URL || '/';
    const normalizedBase = base.endsWith('/') ? base : `${base}/`;
    return `${normalizedBase}${clean.slice(1)}`;
  }
  return clean;
}

export function handlePosterError(e: SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  if (img.dataset.fallbackApplied === '1') return;
  img.dataset.fallbackApplied = '1';
  img.src = FALLBACK_POSTER;
}

export function handleBackdropError(e: SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  if (img.dataset.fallbackApplied === '1') return;
  img.dataset.fallbackApplied = '1';
  img.src = FALLBACK_BACKDROP;
}

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

const ASIAN_HINTS = ['اليابان', 'كوريا', 'الصين', 'تايلاند', 'اندونيسيا', 'الفلبين', 'اليابانيه', 'الكوريه', 'الصينيه'];

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
  const haystack = normalizeArabicText(`${item.country} ${item.language} ${item.title} ${catsNorm.join(' ')}`);
  return haystack.includes('تركيا') || haystack.includes('التركيه') || haystack.includes('تركي');
}

function isIndianOrigin(item: MediaItem, catsNorm: string[]): boolean {
  const haystack = normalizeArabicText(`${item.country} ${item.language} ${item.title} ${catsNorm.join(' ')}`);
  return haystack.includes('الهند') || haystack.includes('الهنديه') || haystack.includes('هندي') || haystack.includes('بوليوود');
}

function isAsianOrigin(item: MediaItem, catsNorm: string[]): boolean {
  const haystack = normalizeArabicText(`${item.country} ${item.language} ${item.title} ${catsNorm.join(' ')}`);
  return haystack.includes('اسيوي') || ASIAN_HINTS.some((hint) => haystack.includes(hint));
}

function isAnimationItem(item: MediaItem, catsNorm: string[]): boolean {
  const genresNorm = (item.genres || []).map(normalizeArabicText);
  const haystack = normalizeArabicText(`${item.title} ${item.tagline} ${catsNorm.join(' ')} ${genresNorm.join(' ')}`);
  return (
    haystack.includes('كرتون') ||
    haystack.includes('انيميشن') ||
    haystack.includes('انمي') ||
    haystack.includes('animation') ||
    haystack.includes('anime')
  );
}

function isNetflixItem(item: MediaItem, catsNorm: string[]): boolean {
  const haystack = normalizeArabicText(`${item.title} ${item.englishTitle} ${item.tagline} ${item.story} ${catsNorm.join(' ')}`);
  return haystack.includes('نيتفليكس') || haystack.includes('نتفليكس') || haystack.includes('netflix');
}

export function matchesCategoryFilter(item: MediaItem, rawCategory: string): boolean {
  const target = normalizeArabicText(rawCategory);
  if (!target) return true;

  const catsNorm = (item.categories || []).map(normalizeArabicText).filter(Boolean);

  // Direct normalized match
  if (catsNorm.some((c) => c === target)) return true;

  // Parent Sections
  if (target === 'افلام') {
    return isMovieItem(item, catsNorm);
  }
  if (target === 'مسلسلات') {
    return isSeriesItem(item, catsNorm);
  }

  // Movie Sub-sections
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
    return isMovieItem(item, catsNorm) && (isAsianOrigin(item, catsNorm) || isIndianOrigin(item, catsNorm));
  }
  if (target === 'افلام كرتون' || target === 'افلام انمي') {
    return isMovieItem(item, catsNorm) && isAnimationItem(item, catsNorm);
  }
  if (target === 'افلام نيتفليكس' || target === 'افلام نتفليكس') {
    return isMovieItem(item, catsNorm) && isNetflixItem(item, catsNorm);
  }

  // Series Sub-sections
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

  // Special & TV Sections
  if (target.includes('رمضان')) {
    const hay = normalizeArabicText(`${item.title} ${item.tagline} ${item.story} ${catsNorm.join(' ')}`);
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

  // Generic normalized substring fallback
  return catsNorm.some((c) => c.includes(target) || target.includes(c));
}

export function filterAndSortCatalog(
  catalog: MediaItem[],
  filters: CatalogFilterState,
  sortMode: 'latest' | 'year' | 'rating' | 'views' | 'likes' | 'pinned' = 'latest'
): MediaItem[] {
  const qNorm = normalizeArabicText(filters.query);
  const genreNorm = normalizeArabicText(filters.genre);
  const countryNorm = normalizeArabicText(filters.country);
  const langNorm = normalizeArabicText(filters.language);
  const qualityNorm = normalizeArabicText(filters.quality);

  const filtered = catalog.filter((item) => {
    if (qNorm) {
      const hit =
        normalizeArabicText(item.title).includes(qNorm) ||
        normalizeArabicText(item.englishTitle).includes(qNorm) ||
        normalizeArabicText(item.story).includes(qNorm) ||
        (item.genres || []).some((g) => normalizeArabicText(g).includes(qNorm)) ||
        normalizeArabicText(item.country).includes(qNorm) ||
        String(item.year || '').includes(qNorm);
      if (!hit) return false;
    }

    if (filters.category && !matchesCategoryFilter(item, filters.category)) return false;

    if (genreNorm) {
      const hasGenre = (item.genres || []).some((g) => {
        const gn = normalizeArabicText(g);
        return gn === genreNorm || gn.includes(genreNorm) || genreNorm.includes(gn);
      });
      if (!hasGenre) return false;
    }

    if (filters.year && String(item.year || '').trim() !== filters.year.trim()) return false;

    if (countryNorm) {
      const cn = normalizeArabicText(item.country);
      if (cn !== countryNorm && !cn.includes(countryNorm) && !countryNorm.includes(cn)) {
        return false;
      }
    }

    if (langNorm) {
      const ln = normalizeArabicText(item.language);
      if (ln !== langNorm && !ln.includes(langNorm) && !langNorm.includes(ln)) {
        return false;
      }
    }

    if (qualityNorm) {
      const qn = normalizeArabicText(item.quality);
      if (qn !== qualityNorm && !qn.includes(qualityNorm) && !qualityNorm.includes(qn)) {
        return false;
      }
    }

    if (filters.minImdb > 0 && Number(item.imdb || 0) < filters.minImdb) return false;
    if (filters.preset === 'pinned' && !item.pinned) return false;
    return true;
  });

  const effectiveSort =
    filters.preset === 'views'
      ? 'views'
      : filters.preset === 'rating'
        ? 'rating'
        : filters.preset === 'likes'
          ? 'likes'
          : sortMode;

  return [...filtered].sort((a, b) => {
    if (effectiveSort === 'views') return (b.views || 0) - (a.views || 0);
    if (effectiveSort === 'rating') return (b.imdb || 0) - (a.imdb || 0);
    if (effectiveSort === 'likes') return (b.likes || 0) - (a.likes || 0);
    if (effectiveSort === 'year') {
      const yDiff = (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0);
      if (yDiff !== 0) return yDiff;
      return (b.updatedAtMs || b.createdAtMs || 0) - (a.updatedAtMs || a.createdAtMs || 0);
    }
    const timeDiff = (b.updatedAtMs || b.createdAtMs || 0) - (a.updatedAtMs || a.createdAtMs || 0);
    if (timeDiff !== 0) return timeDiff;
    return (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0);
  });
}

function mergeUniqueOptions(defaults: string[], dynamicValues: string[]): string[] {
  const seen = new Map<string, string>();
  for (const val of [...defaults, ...dynamicValues]) {
    const clean = String(val || '').trim();
    if (!clean) continue;
    const key = normalizeArabicText(clean);
    if (!seen.has(key)) {
      seen.set(key, clean);
    }
  }
  return Array.from(seen.values());
}

export function buildDynamicFilterOptions(catalog: MediaItem[]) {
  const dynamicCategories: string[] = [];
  const dynamicGenres: string[] = [];
  const dynamicYears = new Set<string>(FILTER_OPTIONS.years);
  const dynamicCountries: string[] = [];
  const dynamicLanguages: string[] = [];
  const dynamicQualities: string[] = [];

  for (const item of catalog) {
    (item.categories || []).forEach((c) => dynamicCategories.push(c));
    (item.genres || []).forEach((g) => dynamicGenres.push(g));
    if (item.year && /^\d{4}$/.test(item.year.trim())) dynamicYears.add(item.year.trim());
    if (item.country) dynamicCountries.push(item.country);
    if (item.language) dynamicLanguages.push(item.language);
    if (item.quality) dynamicQualities.push(item.quality);
  }

  return {
    categories: mergeUniqueOptions(FILTER_OPTIONS.categories, dynamicCategories),
    genres: mergeUniqueOptions(FILTER_OPTIONS.genres, dynamicGenres),
    years: Array.from(dynamicYears).sort((a, b) => Number(b) - Number(a)),
    countries: mergeUniqueOptions(FILTER_OPTIONS.countries, dynamicCountries),
    languages: mergeUniqueOptions(FILTER_OPTIONS.languages, dynamicLanguages),
    qualities: mergeUniqueOptions(FILTER_OPTIONS.qualities, dynamicQualities),
  };
}
