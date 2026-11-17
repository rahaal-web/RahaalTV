import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Eye,
  Flame,
  Grid2x2,
  Heart,
  Paperclip,
  Play,
  Sparkles,
  Star,
  Tags,
  Timer,
  Tv,
} from 'lucide-react';
import { CATEGORY_TAGS, PRESET_FILTERS } from '../data/catalog';
import {
  FALLBACK_BACKDROP,
  FALLBACK_POSTER,
  handleBackdropError,
  handlePosterError,
  matchesCategoryFilter,
} from '../lib/mediaFilters';
import { CatalogFilterState, MediaItem, SiteSettings } from '../types/media';
import { MovieCard } from './MovieCard';

interface HomeViewProps {
  catalog: MediaItem[];
  siteSettings: SiteSettings;
  onSelectMedia: (item: MediaItem, openDownloads?: boolean) => void;
  onApplyFilter: (partial: Partial<CatalogFilterState>) => void;
  onPlayNow: (item: MediaItem) => void;
  watchlistIds: string[];
  onToggleWatchlist: (item: MediaItem) => void;
}

const IMDB_THRESHOLDS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const HOME_QUICK_SECTIONS = [
  { label: 'الأفلام', category: 'افلام' },
  { label: 'أفلام أجنبية', category: 'افلام اجنبية' },
  { label: 'أفلام عربية', category: 'افلام عربية' },
  { label: 'أفلام كرتون', category: 'افلام كرتون' },
  { label: 'المسلسلات', category: 'مسلسلات' },
  { label: 'مسلسلات أجنبية', category: 'مسلسلات اجنبية' },
  { label: 'مسلسلات عربية', category: 'مسلسلات عربية' },
  ...CATEGORY_TAGS,
];

function getPaginationNumbers(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, idx) => idx + 1);
  }
  const pages: Array<number | 'ellipsis'> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('ellipsis');
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < total - 1) pages.push('ellipsis');
  pages.push(total);
  return pages;
}

export function HomeView({
  catalog,
  siteSettings,
  onSelectMedia,
  onApplyFilter,
  onPlayNow,
  watchlistIds,
  onToggleWatchlist,
}: HomeViewProps) {
  const pinnedList = catalog.filter((i) => i.pinned);
  const featuredItems = (pinnedList.length > 0 ? pinnedList : catalog).slice(
    0,
    siteSettings.featuredLimit || 5
  );
  const [heroIndex, setHeroIndex] = useState(0);
  const [dismissedBanner, setDismissedBanner] = useState(false);

  // Full Paginated Library State on Home Page
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'movie' | 'series' | 'other'>('all');
  const [libraryPage, setLibraryPage] = useState(1);
  const [libraryPageSize, setLibraryPageSize] = useState<number>(18);

  useEffect(() => {
    if (featuredItems.length === 0) return;
    const interval = setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % featuredItems.length);
    }, 6500);
    return () => clearInterval(interval);
  }, [featuredItems.length]);

  useEffect(() => {
    setLibraryPage(1);
  }, [libraryFilter, libraryPageSize, catalog.length]);

  const safeIdx = featuredItems.length ? heroIndex % featuredItems.length : 0;
  const activeHero = featuredItems[safeIdx] || catalog[0];

  const allMovies = useMemo(
    () => catalog.filter((i) => matchesCategoryFilter(i, 'افلام')),
    [catalog]
  );
  const allSeriesAndShows = useMemo(
    () =>
      catalog.filter(
        (i) => matchesCategoryFilter(i, 'مسلسلات') || i.kind === 'tv' || i.kind === 'wrestling'
      ),
    [catalog]
  );

  const latestMovies = allMovies.slice(0, 5);
  const latestSeries = allSeriesAndShows.slice(0, 5);

  const showcaseGrid = useMemo(() => {
    const latestMovieIds = new Set(latestMovies.map((m) => m.id));
    const topRated = [...catalog].sort((a, b) => (b.imdb || 0) - (a.imdb || 0));
    const distinctTop = topRated.filter((item) => !latestMovieIds.has(item.id));
    const combined = [...distinctTop, ...topRated.filter((item) => latestMovieIds.has(item.id))];
    return combined.slice(0, 6);
  }, [catalog, latestMovies]);

  const tickerBase = catalog.slice(0, 10);
  const tickerItems = [...tickerBase, ...tickerBase];

  // Deduplicated quick category chips with live counts
  const quickCategoryChips = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ label: string; category: string; count: number }> = [];
    for (const tag of HOME_QUICK_SECTIONS) {
      if (seen.has(tag.category)) continue;
      seen.add(tag.category);
      list.push({
        label: tag.label,
        category: tag.category,
        count: catalog.filter((item) => matchesCategoryFilter(item, tag.category)).length,
      });
    }
    return list;
  }, [catalog]);

  // Full Paginated Library Items
  const filteredLibraryItems = useMemo(() => {
    if (libraryFilter === 'movie') return allMovies;
    if (libraryFilter === 'series') {
      return catalog.filter((i) => matchesCategoryFilter(i, 'مسلسلات'));
    }
    if (libraryFilter === 'other') {
      return catalog.filter((i) => i.kind === 'tv' || i.kind === 'wrestling');
    }
    return catalog;
  }, [catalog, allMovies, libraryFilter]);

  const effectivePageSize =
    libraryPageSize === 0 ? Math.max(filteredLibraryItems.length, 1) : libraryPageSize;
  const totalLibraryPages = Math.max(1, Math.ceil(filteredLibraryItems.length / effectivePageSize));
  const safeLibraryPage = Math.min(libraryPage, totalLibraryPages);
  const libraryStartIdx = (safeLibraryPage - 1) * effectivePageSize;
  const paginatedLibraryItems = filteredLibraryItems.slice(
    libraryStartIdx,
    libraryStartIdx + effectivePageSize
  );
  const libraryPageNumbers = getPaginationNumbers(safeLibraryPage, totalLibraryPages);

  const goToLibraryPage = (page: number) => {
    const clamped = Math.max(1, Math.min(totalLibraryPages, page));
    setLibraryPage(clamped);
    document.getElementById('home-full-library')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const getPresetIcon = (id: string) => {
    switch (id) {
      case 'latest':
        return <Clapperboard className="w-5 h-5" />;
      case 'pinned':
        return <Tv className="w-5 h-5" />;
      case 'views':
        return <Eye className="w-5 h-5" />;
      case 'rating':
        return <Star className="w-5 h-5" />;
      default:
        return <Heart className="w-5 h-5" />;
    }
  };

  if (!activeHero) {
    return (
      <div className="mx-auto max-w-2xl px-4 pt-36 pb-20 text-center space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#D92321]/15 border border-[#D92321]/30 text-[#D92321]">
          <Clapperboard className="w-8 h-8" />
        </div>
        <h2 className="font-display text-2xl font-extrabold text-white">
          لا يوجد محتوى منشور حاليًا
        </h2>
        <p className="text-sm text-[#b7c9ef] leading-relaxed">
          المكتبة فارغة في الوقت الحالي. يمكنك إضافة أفلام ومسلسلات أو جلبها تلقائيًا من لوحة التحكم.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-12 pb-12">
      {/* Optional Admin Announcement Banner */}
      {siteSettings.announcementText && !dismissedBanner && (
        <div className="bg-[#D92321] pt-24 pb-2.5 px-4 text-center text-xs font-extrabold text-white relative">
          <span>{siteSettings.announcementText}</span>
          <button
            type="button"
            onClick={() => setDismissedBanner(true)}
            className="absolute left-4 bottom-2 text-white/80 hover:text-white cursor-pointer"
            aria-label="إخفاء التنبيه"
          >
            ✕
          </button>
        </div>
      )}

      {/* 1. Hero Featured Carousel (.slider + spotlight) */}
      <section className="relative overflow-hidden border-b border-white/[0.08] bg-[#0c1821]">
        <div className="relative min-h-[460px] sm:min-h-[520px] flex items-end">
          <img
            src={activeHero.backdrop || activeHero.poster || FALLBACK_BACKDROP}
            alt={activeHero.title}
            referrerPolicy="no-referrer"
            onError={handleBackdropError}
            className="absolute inset-0 h-full w-full object-cover transition-all duration-700"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#06131c] via-[#06131c]/70 to-[#06131c]/35" />
          <div className="absolute inset-0 bg-gradient-to-l from-[#06131c]/90 via-transparent to-[#06131c]/60" />

          <div className="relative z-10 mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8 pt-28 pb-10">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8">
              <div className="max-w-2xl">
                <div className="mb-3 flex flex-wrap items-center gap-2.5">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#D92321] px-3 py-1 text-xs font-extrabold text-white">
                    <Sparkles className="w-3.5 h-3.5" />
                    عرض مميز
                  </span>
                  <span className="font-latin inline-flex items-center gap-1 rounded-lg bg-[#f9c400] px-2.5 py-1 text-xs font-black text-[#06131c]">
                    <Star className="w-3.5 h-3.5 fill-current" />
                    {Number(activeHero.imdb || 7.5).toFixed(1)} IMDb
                  </span>
                  <span className="font-latin rounded-lg bg-white/10 px-2.5 py-1 text-xs font-bold text-white backdrop-blur-sm">
                    {activeHero.year} • {activeHero.quality}
                  </span>
                </div>

                <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white leading-tight">
                  {activeHero.title}
                </h1>

                <p className="mt-3 text-sm sm:text-base font-medium text-[#b7c9ef] leading-relaxed line-clamp-2">
                  {activeHero.story}
                </p>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onPlayNow(activeHero)}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#D92321] hover:bg-[#dc0e30] px-6 py-3 text-sm font-extrabold text-white shadow-[0_10px_28px_rgba(217,35,33,0.45)] transition-transform hover:-translate-y-0.5 cursor-pointer"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>مشاهدة الآن</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelectMedia(activeHero)}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#1a242e]/90 hover:bg-[#1a242e] border border-white/15 px-6 py-3 text-sm font-bold text-white backdrop-blur-sm transition-colors cursor-pointer"
                  >
                    <span>التفاصيل والتحميل</span>
                  </button>
                </div>
              </div>

              {/* Slider Navigation & Mini Strip */}
              <div className="flex flex-col items-start lg:items-end gap-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setHeroIndex((prev) => (prev - 1 + featuredItems.length) % featuredItems.length)
                    }
                    aria-label="العرض السابق"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#1a242e]/90 border border-white/15 text-white hover:bg-[#D92321] transition-colors cursor-pointer"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setHeroIndex((prev) => (prev + 1) % featuredItems.length)}
                    aria-label="العرض التالي"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#1a242e]/90 border border-white/15 text-white hover:bg-[#D92321] transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {featuredItems.map((item, idx) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setHeroIndex(idx)}
                      aria-label={`عرض ${item.title}`}
                      className={`h-2 rounded-full transition-all cursor-pointer ${
                        idx === safeIdx ? 'w-8 bg-[#D92321]' : 'w-2 bg-white/30 hover:bg-white/60'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. IMDb Rating & Preset Filter Bar (.filter-home) */}
      <section className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* IMDb Gold Block */}
          <div className="lg:col-span-4 rounded-2xl bg-[#1a242e] border border-[#f9c400]/30 p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="font-latin rounded-md bg-[#f9c400] px-2 py-0.5 text-xs font-black text-[#06131c]">
                  IMDb
                </span>
                <span className="text-xs font-extrabold text-white">تصفية حسب التقييم</span>
              </div>
              <span className="text-[11px] font-semibold text-[#b7c9ef]">اختر الحد الأدنى</span>
            </div>

            <div className="grid grid-cols-9 gap-1.5">
              {IMDB_THRESHOLDS.map((score) => (
                <button
                  key={score}
                  type="button"
                  onClick={() => onApplyFilter({ minImdb: score })}
                  className="font-latin flex h-9 items-center justify-center rounded-lg bg-[#0c1821] border border-white/10 text-xs font-black text-[#f9c400] hover:bg-[#f9c400] hover:text-[#06131c] transition-colors cursor-pointer"
                >
                  {score}
                </button>
              ))}
            </div>
          </div>

          {/* 5 Preset Filter Cards */}
          <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {PRESET_FILTERS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onApplyFilter({ preset: preset.id })}
                className="group flex flex-col items-start justify-between rounded-2xl bg-[#1a242e] border border-white/[0.08] p-4 text-right hover:border-[#D92321]/70 hover:bg-[#1b252f] transition-all cursor-pointer"
              >
                <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#0c1821] text-[#D92321] group-hover:bg-[#D92321] group-hover:text-white transition-colors">
                  {getPresetIcon(preset.id)}
                </div>
                <div>
                  <p className="font-display text-sm font-extrabold text-white">{preset.title}</p>
                  <p className="text-[11px] text-[#b7c9ef] mt-0.5">{preset.subtitle}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 3. Split Section 1: Latest Movies + 2x2 Quick Filter Menu */}
      {latestMovies.length > 0 && (
        <section className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Right Sidebar Menu */}
            <div className="lg:col-span-3 rounded-3xl bg-[#1a242e] border border-white/[0.08] p-5">
              <div className="mb-5">
                <span className="text-[11px] font-extrabold text-[#D92321]">
                  أحدث الأفلام المضافة ({allMovies.length})
                </span>
                <h2 className="font-display text-xl font-extrabold text-white mt-1 leading-snug">
                  أستكشف وتصفح جديد الأفلام
                </h2>
                <p className="text-xs text-[#b7c9ef] mt-1.5">
                  أقوى إنتاجات السينما العالمية والعربية بجودات BluRay و WEB-DL
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => onApplyFilter({ category: 'افلام', preset: 'latest' })}
                  className="flex flex-col items-start gap-2 rounded-2xl bg-[#0c1821] border border-white/[0.07] p-3 text-right hover:border-[#D92321] transition-colors cursor-pointer"
                >
                  <Timer className="w-4 h-4 text-[#D92321]" />
                  <span className="text-xs font-bold text-white">أفلام جديدة</span>
                </button>

                <button
                  type="button"
                  onClick={() => onApplyFilter({ category: 'افلام', preset: 'pinned' })}
                  className="flex flex-col items-start gap-2 rounded-2xl bg-[#0c1821] border border-white/[0.07] p-3 text-right hover:border-[#D92321] transition-colors cursor-pointer"
                >
                  <Paperclip className="w-4 h-4 text-[#f9c400]" />
                  <span className="text-xs font-bold text-white">أفلام مثبتة</span>
                </button>

                <button
                  type="button"
                  onClick={() => onApplyFilter({ category: 'افلام', preset: 'rating' })}
                  className="flex flex-col items-start gap-2 rounded-2xl bg-[#0c1821] border border-white/[0.07] p-3 text-right hover:border-[#D92321] transition-colors cursor-pointer"
                >
                  <BarChart3 className="w-4 h-4 text-[#4CAF50]" />
                  <span className="text-xs font-bold text-white">أفضل الأفلام</span>
                </button>

                <button
                  type="button"
                  onClick={() => onApplyFilter({ category: 'افلام', preset: 'views' })}
                  className="flex flex-col items-start gap-2 rounded-2xl bg-[#0c1821] border border-white/[0.07] p-3 text-right hover:border-[#D92321] transition-colors cursor-pointer"
                >
                  <Flame className="w-4 h-4 text-[#D92321]" />
                  <span className="text-xs font-bold text-white">الأكثر شهرة</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => onApplyFilter({ category: 'افلام' })}
                className="mt-4 w-full rounded-xl bg-[#D92321] hover:bg-[#dc0e30] py-2.5 text-xs font-extrabold text-white transition-colors cursor-pointer"
              >
                عرض جميع الأفلام ({allMovies.length})
              </button>
            </div>

            {/* 5-Card Grid */}
            <div className="lg:col-span-9 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
              {latestMovies.map((item) => (
                <MovieCard
                  key={item.id}
                  item={item}
                  onSelect={onSelectMedia}
                  isInWatchlist={watchlistIds.includes(item.id)}
                  onToggleWatchlist={onToggleWatchlist}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 4. Diagonal News Ticker */}
      {siteSettings.tickerEnabled && tickerItems.length > 0 && (
        <section className="relative overflow-hidden py-4">
          <svg
            viewBox="0 0 1440 36"
            preserveAspectRatio="none"
            className="block w-full h-7 text-[#19262f] fill-current"
            aria-hidden="true"
          >
            <polygon points="0,36 1440,0 1440,36" />
          </svg>

          <div className="moov-ticker bg-[#19262f] py-4 border-y border-white/[0.06] overflow-hidden">
            <div className="moov-ticker-track items-center gap-4 px-4">
              {tickerItems.map((item, idx) => (
                <button
                  key={`${item.id}-${idx}`}
                  type="button"
                  onClick={() => onSelectMedia(item)}
                  className="inline-flex items-center gap-3 rounded-2xl bg-[#0c1821] border border-white/[0.08] px-3.5 py-2 hover:border-[#D92321] transition-colors shrink-0 cursor-pointer"
                >
                  <img
                    src={item.poster || FALLBACK_POSTER}
                    alt={item.title}
                    referrerPolicy="no-referrer"
                    onError={handlePosterError}
                    className="h-11 w-8 rounded-lg object-cover"
                  />
                  <div className="text-right">
                    <p className="text-xs font-extrabold text-white whitespace-nowrap">{item.title}</p>
                    <p className="font-latin text-[10px] font-bold text-[#f9c400]">
                      {item.quality} • ★ {Number(item.imdb || 7.5).toFixed(1)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <svg
            viewBox="0 0 1440 36"
            preserveAspectRatio="none"
            className="block w-full h-7 text-[#19262f] fill-current"
            aria-hidden="true"
          >
            <polygon points="0,0 1440,0 0,36" />
          </svg>
        </section>
      )}

      {/* 5. 6-Card Top-Rated Showcase Grid */}
      <section className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-display text-xl sm:text-2xl font-extrabold text-white">
              أبرز العروض والأفلام المختارة
            </h2>
            <p className="text-xs text-[#b7c9ef] mt-1">أعمال عالية التقييم يرشحها فريق RahaL TV</p>
          </div>
          <button
            type="button"
            onClick={() => onApplyFilter({ preset: 'rating' })}
            className="rounded-xl bg-[#1a242e] border border-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-[#D92321] transition-colors cursor-pointer"
          >
            استكشف المزيد
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {showcaseGrid.map((item) => (
            <MovieCard
              key={item.id}
              item={item}
              onSelect={onSelectMedia}
              isInWatchlist={watchlistIds.includes(item.id)}
              onToggleWatchlist={onToggleWatchlist}
            />
          ))}
        </div>
      </section>

      {/* 6. Interactive Categories Tag Strip with Live Counts */}
      <section className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
        <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Tags className="w-5 h-5 text-[#D92321]" />
              <h2 className="font-display text-lg font-extrabold text-white">تصفح الأقسام السريعة</h2>
            </div>
            <button
              type="button"
              onClick={() => onApplyFilter({})}
              className="text-xs font-extrabold text-[#D92321] hover:text-white transition-colors cursor-pointer"
            >
              عرض جميع الأقسام ({catalog.length})
            </button>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {quickCategoryChips.map((tag) => (
              <button
                key={tag.category}
                type="button"
                onClick={() => onApplyFilter({ category: tag.category })}
                className="inline-flex items-center gap-2 rounded-xl bg-[#1a242e] border border-white/[0.08] px-3.5 py-2 text-xs sm:text-sm font-bold text-[#b7c9ef] hover:bg-[#D92321] hover:border-[#D92321] hover:text-white transition-colors cursor-pointer"
              >
                <Tags className="w-3.5 h-3.5" />
                <span>{tag.label}</span>
                <span className="font-latin rounded-md bg-[#0c1821] px-1.5 py-0.5 text-[11px] font-black text-white/90">
                  {tag.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 7. Split Section 2: Series, Ramadan 2026 & Wrestling */}
      {latestSeries.length > 0 && (
        <section className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-3 rounded-3xl bg-[#1a242e] border border-white/[0.08] p-5">
              <span className="text-[11px] font-extrabold text-[#f9c400]">
                مسلسلات وبرامج وعروض حصرية ({allSeriesAndShows.length})
              </span>
              <h2 className="font-display text-xl font-extrabold text-white mt-1 leading-snug">
                أحدث المسلسلات وموسم رمضان 2026
              </h2>
              <p className="text-xs text-[#b7c9ef] mt-2 leading-relaxed">
                تابع أحدث الحلقات فور صدورها مع تنقل مباشر بين المواسم وروابط مشاهدة متعددة السيرفرات.
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => onApplyFilter({ category: 'مسلسلات' })}
                  className="w-full rounded-xl bg-[#D92321] hover:bg-[#dc0e30] py-2.5 text-xs font-extrabold text-white transition-colors cursor-pointer"
                >
                  تصفح كل المسلسلات
                </button>
                <button
                  type="button"
                  onClick={() => onApplyFilter({ category: 'رمضان 2026' })}
                  className="w-full rounded-xl bg-[#0c1821] hover:bg-white/10 border border-white/10 py-2.5 text-xs font-bold text-white transition-colors cursor-pointer"
                >
                  قسم رمضان 2026
                </button>
              </div>
            </div>

            <div className="lg:col-span-9 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
              {latestSeries.map((item) => (
                <MovieCard
                  key={item.id}
                  item={item}
                  onSelect={onSelectMedia}
                  isInWatchlist={watchlistIds.includes(item.id)}
                  onToggleWatchlist={onToggleWatchlist}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 8. NEW Full Library Paginated Grid — displays ALL 70+ items with pages directly on Home */}
      <section id="home-full-library" className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 scroll-mt-24">
        <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 sm:p-6 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-white/[0.08] pb-4">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-extrabold text-[#D92321] mb-1">
                <Grid2x2 className="w-4 h-4" />
                <span>المكتبة الكاملة</span>
              </div>
              <h2 className="font-display text-xl sm:text-2xl font-extrabold text-white">
                تصفح جميع الأعمال المضافة ({filteredLibraryItems.length})
              </h2>
              <p className="text-xs text-[#b7c9ef] mt-1">
                عرض{' '}
                <span className="font-latin font-bold text-white">
                  {filteredLibraryItems.length === 0 ? 0 : libraryStartIdx + 1}–
                  {Math.min(libraryStartIdx + effectivePageSize, filteredLibraryItems.length)}
                </span>{' '}
                من أصل <span className="font-latin font-bold text-[#f9c400]">{filteredLibraryItems.length}</span> عمل • صفحة{' '}
                <span className="font-latin font-bold text-white">{safeLibraryPage}</span> من{' '}
                <span className="font-latin font-bold text-white">{totalLibraryPages}</span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {[
                { id: 'all' as const, label: `الكل (${catalog.length})` },
                { id: 'movie' as const, label: `أفلام (${allMovies.length})` },
                {
                  id: 'series' as const,
                  label: `مسلسلات (${catalog.filter((i) => matchesCategoryFilter(i, 'مسلسلات')).length})`,
                },
                {
                  id: 'other' as const,
                  label: `برامج ومصارعة (${catalog.filter((i) => i.kind === 'tv' || i.kind === 'wrestling').length})`,
                },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setLibraryFilter(tab.id)}
                  className={`rounded-xl px-3.5 py-2 text-xs font-extrabold border transition-colors cursor-pointer ${
                    libraryFilter === tab.id
                      ? 'bg-[#D92321] border-[#D92321] text-white'
                      : 'bg-[#1a242e] border-white/10 text-[#b7c9ef] hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}

              <select
                value={libraryPageSize}
                onChange={(e) => setLibraryPageSize(Number(e.target.value))}
                aria-label="عدد الأعمال في الصفحة"
                className="rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs font-bold text-white focus:border-[#D92321] focus:outline-none cursor-pointer"
              >
                <option value={18}>18 / صفحة</option>
                <option value={36}>36 / صفحة</option>
                <option value={0}>عرض الكل</option>
              </select>

              <button
                type="button"
                onClick={() => onApplyFilter({})}
                className="rounded-xl bg-[#1a242e] hover:bg-[#D92321] border border-white/10 px-3.5 py-2 text-xs font-extrabold text-white transition-colors cursor-pointer"
              >
                الفلاتر المتقدمة
              </button>
            </div>
          </div>

          {paginatedLibraryItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 py-14 text-center">
              <p className="text-sm font-bold text-[#b7c9ef]">لا توجد أعمال في هذا التبويب حاليًا.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {paginatedLibraryItems.map((item) => (
                <MovieCard
                  key={item.id}
                  item={item}
                  onSelect={onSelectMedia}
                  isInWatchlist={watchlistIds.includes(item.id)}
                  onToggleWatchlist={onToggleWatchlist}
                />
              ))}
            </div>
          )}

          {totalLibraryPages > 1 && (
            <nav
              aria-label="صفحات المكتبة في الرئيسية"
              className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-white/[0.08] pt-4"
            >
              <span className="text-xs font-bold text-[#b7c9ef]">
                صفحة <span className="font-latin text-white">{safeLibraryPage}</span> من{' '}
                <span className="font-latin text-white">{totalLibraryPages}</span>
              </span>

              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <button
                  type="button"
                  disabled={safeLibraryPage <= 1}
                  onClick={() => goToLibraryPage(safeLibraryPage - 1)}
                  className="inline-flex h-9 items-center gap-1 rounded-xl bg-[#1a242e] border border-white/10 px-3 text-xs font-bold text-white disabled:opacity-40 hover:bg-[#D92321] hover:border-[#D92321] transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                  <span>السابق</span>
                </button>

                {libraryPageNumbers.map((page, idx) =>
                  page === 'ellipsis' ? (
                    <span key={`home-el-${idx}`} className="px-2 text-xs font-bold text-[#b7c9ef]">
                      ...
                    </span>
                  ) : (
                    <button
                      key={page}
                      type="button"
                      onClick={() => goToLibraryPage(page)}
                      className={`font-latin inline-flex h-9 min-w-9 items-center justify-center rounded-xl border px-2.5 text-xs font-black transition-colors cursor-pointer ${
                        page === safeLibraryPage
                          ? 'bg-[#D92321] border-[#D92321] text-white shadow-md'
                          : 'bg-[#1a242e] border-white/10 text-[#b7c9ef] hover:text-white hover:border-white/30'
                      }`}
                    >
                      {page}
                    </button>
                  )
                )}

                <button
                  type="button"
                  disabled={safeLibraryPage >= totalLibraryPages}
                  onClick={() => goToLibraryPage(safeLibraryPage + 1)}
                  className="inline-flex h-9 items-center gap-1 rounded-xl bg-[#1a242e] border border-white/10 px-3 text-xs font-bold text-white disabled:opacity-40 hover:bg-[#D92321] hover:border-[#D92321] transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  <span>التالي</span>
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>
            </nav>
          )}
        </div>
      </section>
    </div>
  );
}
