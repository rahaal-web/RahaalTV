import { SyntheticEvent } from 'react';
import fallbackBackdropImg from '../assets/images/hero_scifi_backdrop_1794813333496.jpg';
import fallbackPosterImg from '../assets/images/poster_running_man_1794813333683.jpg';
import { FILTER_OPTIONS } from '../data/catalog';
import { CatalogFilterState, MediaItem } from '../types/media';
import { matchesCategoryFilter, normalizeArabicText } from './categoryMatcher';

export { matchesCategoryFilter, normalizeArabicText };

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
        normalizeArabicText(item.director || '').includes(qNorm) ||
        normalizeArabicText(item.writer || '').includes(qNorm) ||
        (item.cast || []).some((c) => normalizeArabicText(c.name).includes(qNorm)) ||
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

    if (filters.minImdb > 0) {
      const score = Math.max(Number(item.imdb || 0), Number(item.reviewSummary?.average10 || 0));
      if (score < filters.minImdb) return false;
    }
    if (filters.releaseStatus === 'released' && item.comingSoon) return false;
    if (filters.releaseStatus === 'comingSoon' && !item.comingSoon) return false;
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
    if (effectiveSort === 'rating') {
      const avgDiff = (b.communityRating?.average || 0) - (a.communityRating?.average || 0);
      if (avgDiff !== 0) return avgDiff;
      return (b.communityRating?.count || 0) - (a.communityRating?.count || 0);
    }
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

export interface SearchSuggestionItem {
  type: 'media' | 'person' | 'genre';
  label: string;
  sublabel: string;
  mediaId?: string;
}

export function buildSearchSuggestions(
  catalog: MediaItem[],
  rawQuery: string,
  maxItems = 8
): SearchSuggestionItem[] {
  const qNorm = normalizeArabicText(rawQuery);
  if (!qNorm || qNorm.length < 2) return [];

  const suggestions: SearchSuggestionItem[] = [];
  const seenKeys = new Set<string>();

  for (const item of catalog) {
    if (suggestions.length >= maxItems) break;
    const tNorm = normalizeArabicText(item.title);
    const eNorm = normalizeArabicText(item.englishTitle);
    if (tNorm.includes(qNorm) || eNorm.includes(qNorm)) {
      const key = `m:${item.id}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        suggestions.push({
          type: 'media',
          label: item.title,
          sublabel: `${item.englishTitle} • ${item.year}`,
          mediaId: item.id,
        });
      }
    }
  }

  // Also suggest matching directors, writers, or cast names
  for (const item of catalog) {
    if (suggestions.length >= maxItems) break;
    const people = [
      ...(item.director ? [{ name: item.director, role: 'مخرج' }] : []),
      ...(item.writer ? [{ name: item.writer, role: 'مؤلف' }] : []),
      ...(item.cast || []).map((c) => ({ name: c.name, role: c.role || 'ممثل' })),
    ];
    for (const p of people) {
      if (suggestions.length >= maxItems) break;
      const pNorm = normalizeArabicText(p.name);
      if (pNorm.includes(qNorm) && !seenKeys.has(`p:${pNorm}`)) {
        seenKeys.add(`p:${pNorm}`);
        suggestions.push({
          type: 'person',
          label: p.name,
          sublabel: p.role,
        });
      }
    }
  }

  return suggestions.slice(0, maxItems);
}
