import {
  HomeHeroMode,
  HomeLayoutConfig,
  HomeSectionConfig,
  HomeSectionSource,
  MediaItem,
} from '../types/media';
import { matchesCategoryFilter } from './mediaFilters';

export const HOME_CONFIG_STORAGE_KEY = 'rahaltv_home_config_v1';

export const DEFAULT_HOME_SECTIONS: HomeSectionConfig[] = [
  {
    id: 'sec-latest',
    title: 'أحدث الإضافات',
    subtitle: 'أجدد الأفلام والمسلسلات المرفوعة بجودة عالية',
    enabled: true,
    source: 'latest',
    limit: 10,
    layout: 'grid',
  },
  {
    id: 'sec-movies',
    title: 'أفلام مختارة',
    subtitle: 'أقوى إنتاجات السينما العالمية والعربية',
    enabled: true,
    source: 'movies',
    limit: 10,
    layout: 'row',
  },
  {
    id: 'sec-series',
    title: 'مسلسلات وعروض مميزة',
    subtitle: 'حلقات محدثة ومواسم كاملة بدون تقطيع',
    enabled: true,
    source: 'series',
    limit: 10,
    layout: 'grid',
  },
];

export const DEFAULT_HOME_CONFIG: HomeLayoutConfig = {
  showHero: true,
  heroMode: 'auto',
  heroMediaId: '',
  heroBadgeText: 'اختيار المحررين',
  heroHeadline: '',
  heroDescription: '',
  heroPrimaryCta: 'مشاهدة الآن',
  heroShowHighlights: true,
  heroAutoPlay: true,
  heroSlideIntervalSec: 6,
  heroShowProgressBar: true,
  heroShowThumbnails: true,
  heroShowArrows: true,
  heroPauseOnHover: true,
  heroMaxSlides: 8,
  heroSlideIds: [],
  showQuickFilters: true,
  showCategoryBar: false,
  showFullLibrary: false,
  showRequestBanner: true,
  cardsPerRow: 5,
  cardStyle: 'clean',
  sections: DEFAULT_HOME_SECTIONS,
};

const VALID_HERO_MODES: HomeHeroMode[] = ['auto', 'manual', 'brand'];
const VALID_SOURCES: HomeSectionSource[] = [
  'latest',
  'movies',
  'series',
  'top_rated',
  'trending',
  'ramadan',
  'wrestling',
  'category',
  'custom',
];

export function normalizeHomeSection(
  raw: Partial<HomeSectionConfig> | null | undefined,
  index: number
): HomeSectionConfig {
  const id =
    typeof raw?.id === 'string' && /^[a-zA-Z0-9_\-]+$/.test(raw.id.trim())
      ? raw.id.trim().slice(0, 64)
      : `sec-${index + 1}`;
  const title =
    typeof raw?.title === 'string' && raw.title.trim()
      ? raw.title.trim().slice(0, 100)
      : `قسم ${index + 1}`;
  const subtitle =
    typeof raw?.subtitle === 'string' ? raw.subtitle.trim().slice(0, 180) : '';
  const source: HomeSectionSource = VALID_SOURCES.includes(raw?.source as HomeSectionSource)
    ? (raw!.source as HomeSectionSource)
    : 'latest';
  const categoryFilter =
    typeof raw?.categoryFilter === 'string' ? raw.categoryFilter.trim().slice(0, 80) : '';
  const customMediaIds = Array.isArray(raw?.customMediaIds)
    ? raw!.customMediaIds
        .map((m) => String(m || '').trim().slice(0, 128))
        .filter(Boolean)
        .slice(0, 24)
    : [];
  const limitNum = Number(raw?.limit);
  const limit = Number.isFinite(limitNum) ? Math.min(24, Math.max(2, Math.round(limitNum))) : 10;
  const layout = raw?.layout === 'row' ? 'row' : 'grid';

  return {
    id,
    title,
    subtitle,
    enabled: raw?.enabled ?? true,
    source,
    categoryFilter,
    customMediaIds,
    limit,
    layout,
  };
}

export function normalizeHomeConfig(
  raw?: Partial<HomeLayoutConfig> | null
): HomeLayoutConfig {
  if (!raw || typeof raw !== 'object') {
    return {
      ...DEFAULT_HOME_CONFIG,
      sections: DEFAULT_HOME_SECTIONS.map((s) => ({ ...s })),
    };
  }

  const heroMode: HomeHeroMode = VALID_HERO_MODES.includes(raw.heroMode as HomeHeroMode)
    ? (raw.heroMode as HomeHeroMode)
    : 'auto';

  const cardsPerRow =
    raw.cardsPerRow === 4 || raw.cardsPerRow === 5 || raw.cardsPerRow === 6
      ? raw.cardsPerRow
      : 5;

  const rawSections = Array.isArray(raw.sections) && raw.sections.length > 0
    ? raw.sections.slice(0, 12).map((sec, idx) => normalizeHomeSection(sec, idx))
    : DEFAULT_HOME_SECTIONS.map((s) => ({ ...s }));

  const intervalNum = Number(raw.heroSlideIntervalSec);
  const heroSlideIntervalSec = Number.isFinite(intervalNum)
    ? Math.min(30, Math.max(2, Math.round(intervalNum)))
    : DEFAULT_HOME_CONFIG.heroSlideIntervalSec!;

  const maxSlidesNum = Number(raw.heroMaxSlides);
  const heroMaxSlides = Number.isFinite(maxSlidesNum)
    ? Math.min(12, Math.max(1, Math.round(maxSlidesNum)))
    : DEFAULT_HOME_CONFIG.heroMaxSlides!;

  const heroSlideIds = Array.isArray(raw.heroSlideIds)
    ? Array.from(
        new Set(
          raw.heroSlideIds
            .map((id) => String(id || '').trim().slice(0, 128))
            .filter(Boolean)
        )
      ).slice(0, 12)
    : [];

  return {
    showHero: raw.showHero ?? true,
    heroMode,
    heroMediaId: typeof raw.heroMediaId === 'string' ? raw.heroMediaId.trim().slice(0, 128) : '',
    heroBadgeText:
      typeof raw.heroBadgeText === 'string' && raw.heroBadgeText.trim()
        ? raw.heroBadgeText.trim().slice(0, 50)
        : DEFAULT_HOME_CONFIG.heroBadgeText,
    heroHeadline:
      typeof raw.heroHeadline === 'string' ? raw.heroHeadline.trim().slice(0, 160) : '',
    heroDescription:
      typeof raw.heroDescription === 'string' ? raw.heroDescription.trim().slice(0, 320) : '',
    heroPrimaryCta:
      typeof raw.heroPrimaryCta === 'string' && raw.heroPrimaryCta.trim()
        ? raw.heroPrimaryCta.trim().slice(0, 40)
        : DEFAULT_HOME_CONFIG.heroPrimaryCta,
    heroShowHighlights: raw.heroShowHighlights ?? true,
    heroAutoPlay: raw.heroAutoPlay ?? true,
    heroSlideIntervalSec,
    heroShowProgressBar: raw.heroShowProgressBar ?? true,
    heroShowThumbnails: raw.heroShowThumbnails ?? true,
    heroShowArrows: raw.heroShowArrows ?? true,
    heroPauseOnHover: raw.heroPauseOnHover ?? true,
    heroMaxSlides,
    heroSlideIds,
    showQuickFilters: raw.showQuickFilters ?? true,
    showCategoryBar: raw.showCategoryBar ?? false,
    showFullLibrary: raw.showFullLibrary ?? false,
    showRequestBanner: raw.showRequestBanner ?? true,
    cardsPerRow,
    cardStyle: raw.cardStyle === 'classic' ? 'classic' : 'clean',
    sections: rawSections,
  };
}

export function loadStoredHomeConfig(): HomeLayoutConfig {
  if (typeof window === 'undefined') return normalizeHomeConfig();
  try {
    const raw = localStorage.getItem(HOME_CONFIG_STORAGE_KEY);
    if (!raw) return normalizeHomeConfig();
    return normalizeHomeConfig(JSON.parse(raw) as Partial<HomeLayoutConfig>);
  } catch {
    return normalizeHomeConfig();
  }
}

export function saveStoredHomeConfig(config: HomeLayoutConfig): HomeLayoutConfig {
  const clean = normalizeHomeConfig(config);
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(HOME_CONFIG_STORAGE_KEY, JSON.stringify(clean));
    } catch {
      // Ignore storage quota errors
    }
  }
  return clean;
}

export function resolveSectionMediaItems(
  catalog: MediaItem[],
  section: HomeSectionConfig
): MediaItem[] {
  const limit = Math.max(1, section.limit || 10);

  switch (section.source) {
    case 'movies':
      return catalog.filter((i) => matchesCategoryFilter(i, 'افلام') || i.kind === 'movie').slice(0, limit);
    case 'series':
      return catalog
        .filter((i) => matchesCategoryFilter(i, 'مسلسلات') || i.kind === 'series' || i.kind === 'tv')
        .slice(0, limit);
    case 'top_rated':
      return [...catalog].sort((a, b) => (b.imdb || 0) - (a.imdb || 0)).slice(0, limit);
    case 'trending':
      return [...catalog].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, limit);
    case 'ramadan':
      return catalog.filter((i) => matchesCategoryFilter(i, 'رمضان 2026')).slice(0, limit);
    case 'wrestling':
      return catalog
        .filter((i) => i.kind === 'wrestling' || matchesCategoryFilter(i, 'مصارعة حرة'))
        .slice(0, limit);
    case 'category':
      return (section.categoryFilter
        ? catalog.filter((i) => matchesCategoryFilter(i, section.categoryFilter!))
        : catalog
      ).slice(0, limit);
    case 'custom': {
      const ids = section.customMediaIds || [];
      const byId = new Map(catalog.map((item) => [item.id, item]));
      const picked = ids.map((id) => byId.get(id)).filter((x): x is MediaItem => Boolean(x));
      return picked.slice(0, limit);
    }
    case 'latest':
    default:
      return catalog.slice(0, limit);
  }
}
