import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock,
  Film,
  Flame,
  Grid2x2,
  Info,
  Layers,
  MessageSquarePlus,
  Play,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tags,
  Trophy,
  Tv,
  Zap,
} from 'lucide-react';
import { CATEGORY_TAGS } from '../data/catalog';
import { normalizeHomeConfig, resolveSectionMediaItems } from '../lib/homeConfig';
import {
  FALLBACK_BACKDROP,
  FALLBACK_POSTER,
  handleBackdropError,
  handlePosterError,
  matchesCategoryFilter,
} from '../lib/mediaFilters';
import {
  buildBackdropSrcSet,
  getBackdropInfo,
  getHeroThumbUrl,
  getPosterUrl,
} from '../lib/mediaImages';
import {
  CatalogFilterState,
  HomeSectionConfig,
  HomeSectionSource,
  MediaItem,
  SiteSettings,
} from '../types/media';
import { MovieCard, MovieCardSkeleton } from './MovieCard';

interface HomeViewProps {
  catalog: MediaItem[];
  siteSettings: SiteSettings;
  isAdmin?: boolean;
  loading?: boolean;
  onSelectMedia: (item: MediaItem, openDownloads?: boolean) => void;
  onApplyFilter: (partial: Partial<CatalogFilterState>) => void;
  onPlayNow: (item: MediaItem) => void;
  onOpenContact: () => void;
  onOpenHomeBuilder?: () => void;
  watchlistIds: string[];
  onToggleWatchlist: (item: MediaItem) => void;
}

const QUICK_FILTER_TABS: Array<{
  id: string;
  label: string;
  filter: Partial<CatalogFilterState>;
}> = [
  { id: 'all', label: 'كل الأعمال', filter: {} },
  { id: 'movies', label: 'الأفلام', filter: { category: 'افلام' } },
  { id: 'foreign-movies', label: 'أفلام أجنبية', filter: { category: 'افلام اجنبية' } },
  { id: 'arabic-movies', label: 'أفلام عربية', filter: { category: 'افلام عربية' } },
  { id: 'series', label: 'المسلسلات', filter: { category: 'مسلسلات' } },
  { id: 'ramadan', label: 'رمضان 2026', filter: { category: 'رمضان 2026' } },
  { id: 'wrestling', label: 'مصارعة حرة', filter: { category: 'مصارعة حرة' } },
  { id: 'top-rated', label: 'الأعلى تقييماً', filter: { preset: 'rating' } },
];

function getSectionIcon(source: HomeSectionSource) {
  switch (source) {
    case 'movies':
      return <Film className="w-5 h-5 text-[#E50914]" />;
    case 'series':
      return <Tv className="w-5 h-5 text-[#E50914]" />;
    case 'top_rated':
      return <Star className="w-5 h-5 text-[#f9c400]" />;
    case 'trending':
      return <Flame className="w-5 h-5 text-[#E50914]" />;
    case 'wrestling':
      return <Trophy className="w-5 h-5 text-[#f9c400]" />;
    case 'ramadan':
      return <Sparkles className="w-5 h-5 text-[#f9c400]" />;
    case 'category':
    case 'custom':
      return <Layers className="w-5 h-5 text-[#E50914]" />;
    case 'latest':
    default:
      return <Clapperboard className="w-5 h-5 text-[#E50914]" />;
  }
}

function getSectionViewAllFilter(section: HomeSectionConfig): Partial<CatalogFilterState> {
  switch (section.source) {
    case 'movies':
      return { category: 'افلام' };
    case 'series':
      return { category: 'مسلسلات' };
    case 'top_rated':
      return { preset: 'rating' };
    case 'trending':
      return { preset: 'views' };
    case 'ramadan':
      return { category: 'رمضان 2026' };
    case 'wrestling':
      return { category: 'مصارعة حرة' };
    case 'category':
      return section.categoryFilter ? { category: section.categoryFilter } : {};
    case 'latest':
    default:
      return { preset: 'latest' };
  }
}

function getGridColumnClass(cardsPerRow: 4 | 5 | 6): string {
  if (cardsPerRow === 4) {
    return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4';
  }
  if (cardsPerRow === 6) {
    return 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';
  }
  return 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5';
}

/* Lightweight Scroll Fade-In Wrapper (Zero-Latency Fallback) */
function RevealSection({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight + 120) {
      setVisible(true);
      return;
    }
    setVisible(false);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '80px 0px', threshold: 0.04 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-500 ease-out ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      } ${className}`}
    >
      {children}
    </div>
  );
}

/* Horizontal Netflix-style Carousel Row */
function SectionHorizontalRow({
  items,
  cardStyle,
  watchlistIds,
  onSelectMedia,
  onToggleWatchlist,
}: {
  items: MediaItem[];
  cardStyle: 'clean' | 'classic';
  watchlistIds: string[];
  onSelectMedia: (item: MediaItem, openDownloads?: boolean) => void;
  onToggleWatchlist: (item: MediaItem) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const scrollByDir = (dir: 'next' | 'prev') => {
    const el = scrollerRef.current;
    if (!el) return;
    const step = Math.max(280, el.clientWidth * 0.72);
    // In RTL, negative scrollLeft moves toward left (next items)
    el.scrollBy({
      left: dir === 'next' ? -step : step,
      behavior: 'smooth',
    });
  };

  return (
    <div className="relative group/row">
      <button
        type="button"
        onClick={() => scrollByDir('prev')}
        aria-label="التمرير لليمين"
        className="hidden md:flex absolute right-2 top-[42%] -translate-y-1/2 z-20 h-11 w-11 items-center justify-center rounded-full bg-black/80 border border-white/15 text-white opacity-0 group-hover/row:opacity-100 hover:bg-[#E50914] transition-all cursor-pointer shadow-xl"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      <div
        ref={scrollerRef}
        className="flex gap-4 overflow-x-auto no-scrollbar scroll-smooth snap-x snap-mandatory pb-2"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className="w-[46%] sm:w-[31%] md:w-[23.5%] lg:w-[19%] shrink-0 snap-start"
          >
            <MovieCard
              item={item}
              onSelect={onSelectMedia}
              isInWatchlist={watchlistIds.includes(item.id)}
              onToggleWatchlist={onToggleWatchlist}
              variant={cardStyle}
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => scrollByDir('next')}
        aria-label="التمرير لليسار"
        className="hidden md:flex absolute left-2 top-[42%] -translate-y-1/2 z-20 h-11 w-11 items-center justify-center rounded-full bg-black/80 border border-white/15 text-white opacity-0 group-hover/row:opacity-100 hover:bg-[#E50914] transition-all cursor-pointer shadow-xl"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
    </div>
  );
}

export function HomeView({
  catalog,
  siteSettings,
  isAdmin = false,
  loading = false,
  onSelectMedia,
  onApplyFilter,
  onPlayNow,
  onOpenContact,
  onOpenHomeBuilder,
  watchlistIds,
  onToggleWatchlist,
}: HomeViewProps) {
  const homeConfig = useMemo(
    () => normalizeHomeConfig(siteSettings.homeConfig),
    [siteSettings.homeConfig]
  );

  const pinnedList = useMemo(() => catalog.filter((i) => i.pinned), [catalog]);
  const heroSlides = useMemo(() => {
    if (catalog.length === 0) return [];
    const ordered: MediaItem[] = [];
    const seen = new Set<string>();
    if ((homeConfig.heroMode === 'manual' || homeConfig.heroMode === 'brand') && homeConfig.heroMediaId) {
      const manualItem = catalog.find((i) => i.id === homeConfig.heroMediaId);
      if (manualItem) {
        ordered.push(manualItem);
        seen.add(manualItem.id);
      }
    }
    for (const item of pinnedList) {
      if (ordered.length >= 8) break;
      if (!seen.has(item.id)) {
        ordered.push(item);
        seen.add(item.id);
      }
    }
    for (const item of catalog) {
      if (ordered.length >= 8) break;
      if (!seen.has(item.id)) {
        ordered.push(item);
        seen.add(item.id);
      }
    }
    return ordered.slice(0, 8);
  }, [pinnedList, catalog, homeConfig.heroMode, homeConfig.heroMediaId]);

  const [heroIndex, setHeroIndex] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);
  const [dismissedBanner, setDismissedBanner] = useState(false);

  // Full Paginated Library (optional when toggled on by admin)
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'movie' | 'series' | 'other'>('all');
  const [libraryPage, setLibraryPage] = useState(1);

  useEffect(() => {
    if (heroSlides.length > 0 && heroIndex >= heroSlides.length) {
      setHeroIndex(0);
    }
  }, [heroSlides.length, heroIndex]);

  useEffect(() => {
    if (homeConfig.heroMode !== 'auto' || heroSlides.length <= 1 || heroPaused) return;
    const interval = setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % heroSlides.length);
    }, 6500);
    return () => clearInterval(interval);
  }, [homeConfig.heroMode, heroSlides.length, heroPaused]);

  useEffect(() => {
    setLibraryPage(1);
  }, [libraryFilter, catalog.length]);

  const activeSlideIndex = heroSlides.length ? heroIndex % heroSlides.length : 0;

  const activeHero = useMemo(() => {
    if (catalog.length === 0) return null;
    if (heroSlides.length > 0) {
      return heroSlides[activeSlideIndex] || catalog[0];
    }
    return catalog[0];
  }, [catalog, heroSlides, activeSlideIndex]);

  const tickerBase = catalog.slice(0, 10);
  const tickerItems = [...tickerBase, ...tickerBase];

  const quickCategoryChips = useMemo(() => {
    const seen = new Set<string>();
    return CATEGORY_TAGS.filter((tag) => {
      if (seen.has(tag.category)) return false;
      seen.add(tag.category);
      return true;
    }).map((tag) => ({
      ...tag,
      count: catalog.filter((item) => matchesCategoryFilter(item, tag.category)).length,
    }));
  }, [catalog]);

  const filteredLibraryItems = useMemo(() => {
    if (libraryFilter === 'movie') {
      return catalog.filter((i) => matchesCategoryFilter(i, 'افلام') || i.kind === 'movie');
    }
    if (libraryFilter === 'series') {
      return catalog.filter((i) => matchesCategoryFilter(i, 'مسلسلات') || i.kind === 'series');
    }
    if (libraryFilter === 'other') {
      return catalog.filter((i) => i.kind === 'tv' || i.kind === 'wrestling');
    }
    return catalog;
  }, [catalog, libraryFilter]);

  const LIBRARY_PAGE_SIZE = 15;
  const totalLibraryPages = Math.max(1, Math.ceil(filteredLibraryItems.length / LIBRARY_PAGE_SIZE));
  const safeLibraryPage = Math.min(libraryPage, totalLibraryPages);
  const paginatedLibraryItems = filteredLibraryItems.slice(
    (safeLibraryPage - 1) * LIBRARY_PAGE_SIZE,
    safeLibraryPage * LIBRARY_PAGE_SIZE
  );

  /* Loading Skeleton View */
  if (loading && catalog.length === 0) {
    return (
      <div className="space-y-10 pb-16">
        <div className="h-[480px] sm:h-[540px] w-full rtv-skeleton" />
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 space-y-8">
          <div className="h-12 w-full rounded-2xl rtv-skeleton" />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, idx) => (
              <MovieCardSkeleton key={idx} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* Empty State */
  if (!activeHero) {
    return (
      <div className="mx-auto max-w-2xl px-4 pt-36 pb-20 text-center space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#E50914]/15 border border-[#E50914]/30 text-[#E50914]">
          <Clapperboard className="w-8 h-8" />
        </div>
        <h2 className="font-display text-2xl font-extrabold text-white">
          لا يوجد محتوى منشور حاليًا
        </h2>
        <p className="text-sm text-[#a3a3a3] leading-relaxed">
          المكتبة فارغة في الوقت الحالي. يمكنك إضافة أفلام ومسلسلات أو تخصيص الصفحة الرئيسية من لوحة التحكم.
        </p>
        {isAdmin && onOpenHomeBuilder && (
          <button
            type="button"
            onClick={onOpenHomeBuilder}
            className="inline-flex items-center gap-2 rounded-xl bg-[#E50914] hover:bg-[#f40612] px-5 py-2.5 text-xs font-extrabold text-white cursor-pointer"
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>إدارة الصفحة الرئيسية</span>
          </button>
        )}
      </div>
    );
  }

  const heroTitle =
    homeConfig.heroHeadline ||
    (homeConfig.heroMode === 'brand'
      ? `${siteSettings.siteName} — سينما عالية الجودة بلا تقطيع`
      : activeHero.title);

  const heroDescription =
    homeConfig.heroDescription ||
    (homeConfig.heroMode === 'brand' ? siteSettings.tagline : activeHero.story);

  const heroInWatchlist = watchlistIds.includes(activeHero.id);
  const gridColClass = getGridColumnClass(homeConfig.cardsPerRow);
  const enabledSections = homeConfig.sections.filter((sec) => sec.enabled);

  return (
    <div className="space-y-10 sm:space-y-12 pb-16">
      {/* Optional Admin Announcement Bar */}
      {siteSettings.announcementText && !dismissedBanner && (
        <div className="bg-[#E50914] pt-20 pb-2.5 px-4 text-center text-xs font-extrabold text-white relative">
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

      {/* 1. Cinematic Hero Section (High-Res 16:9 Backdrop + Right Info Panel + 8 Bottom Square Thumbnails) */}
      {homeConfig.showHero && (() => {
        const backdropInfo = getBackdropInfo(activeHero);
        const heroBgSrc = backdropInfo.hasDedicatedBackdrop
          ? backdropInfo.url
          : FALLBACK_BACKDROP;
        const heroBgSrcSet = backdropInfo.hasDedicatedBackdrop
          ? buildBackdropSrcSet(backdropInfo.url)
          : undefined;
        const ambientPoster = getPosterUrl(activeHero);

        return (
          <section
            className="relative overflow-hidden bg-[#0f0f0f]"
            onMouseEnter={() => setHeroPaused(true)}
            onMouseLeave={() => setHeroPaused(false)}
          >
            <div className="relative min-h-[540px] sm:min-h-[600px] lg:min-h-[660px] flex flex-col justify-end">
              {/* Background Visual Layer */}
              <img
                key={activeHero.id}
                src={heroBgSrc}
                srcSet={heroBgSrcSet}
                sizes="100vw"
                alt={activeHero.title}
                fetchPriority="high"
                referrerPolicy="no-referrer"
                onError={handleBackdropError}
                className="absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-700"
              />

              {/* Subtle blurred poster accent overlay only when item lacks a genuine 16:9 backdrop */}
              {!backdropInfo.hasDedicatedBackdrop && (
                <img
                  src={ambientPoster}
                  alt=""
                  aria-hidden="true"
                  referrerPolicy="no-referrer"
                  onError={handlePosterError}
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center opacity-25 blur-2xl scale-110"
                />
              )}

              {/* Layered Gradient Scrims Matching Dark Mode + Seamless #0f0f0f Bottom Blend */}
              <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0f0f0f] via-[#0f0f0f]/55 to-black/20" />
              <div className="absolute inset-0 bg-gradient-to-l from-[#0f0f0f]/92 via-[#0f0f0f]/48 to-transparent" />

              <div className="relative z-10 mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-10 pt-28 pb-6 sm:pb-8 flex flex-col gap-6 sm:gap-7">
                {/* Main Info (Right Side in RTL) + Arrows & Progress (Left Side) */}
                <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
                  <div className="max-w-lg space-y-3 text-right">
                    {/* Compact Status Badge */}
                    <div>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E50914] px-3 py-1 text-[11px] font-extrabold text-white shadow-[0_6px_18px_rgba(229,9,20,0.45)]">
                        <Flame className="w-3.5 h-3.5 fill-current" />
                        <span>{homeConfig.heroBadgeText || 'الأكثر مشاهدة'}</span>
                      </span>
                    </div>

                    {/* Balanced Compact Headline */}
                    <h1 className="font-display text-base sm:text-lg lg:text-[22px] font-extrabold text-white leading-[1.3] line-clamp-2">
                      {heroTitle}
                    </h1>

                    {/* Single Compact Metadata Line */}
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-bold text-[#d4d4d4] tabular-nums">
                      {activeHero.duration && (
                        <>
                          <span className="inline-flex items-center gap-1 text-white/90">
                            <Clock className="w-3.5 h-3.5 text-white/75" />
                            <span>{activeHero.duration}</span>
                          </span>
                          <span aria-hidden="true" className="text-white/25">|</span>
                        </>
                      )}
                      <span className="font-latin text-white">{activeHero.quality || 'WEB-DL'}</span>
                      <span aria-hidden="true" className="text-white/25">|</span>
                      <span className="font-latin">{activeHero.year || '2026'}</span>
                      <span aria-hidden="true" className="text-white/25">|</span>
                      <span className="inline-flex items-center gap-1 text-[#f9c400] font-extrabold font-latin">
                        <Star className="w-3.5 h-3.5 fill-current" />
                        {Number(activeHero.imdb || 7.5).toFixed(1)}
                      </span>
                    </div>

                    {/* Concise 2-Line Story */}
                    <p className="text-xs sm:text-[13px] text-[#d4d4d4]/90 leading-relaxed line-clamp-2 max-w-md">
                      {heroDescription}
                    </p>

                    {/* Primary & Secondary Action Buttons */}
                    <div className="pt-1 flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => onPlayNow(activeHero)}
                        className="inline-flex items-center gap-2 rounded-xl bg-[#E50914] hover:bg-[#f40612] px-6 py-2.5 sm:py-3 text-xs sm:text-sm font-extrabold text-white shadow-[0_10px_28px_rgba(229,9,20,0.45)] transition-transform hover:-translate-y-0.5 cursor-pointer"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        <span>{homeConfig.heroPrimaryCta || 'مشاهدة الآن'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onSelectMedia(activeHero)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#1f242b]/85 hover:bg-white/20 border border-white/15 px-4 sm:px-5 py-2.5 sm:py-3 text-xs sm:text-sm font-bold text-white backdrop-blur-md transition-colors cursor-pointer"
                      >
                        <Info className="w-4 h-4" />
                        <span>التفاصيل</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onToggleWatchlist(activeHero)}
                        aria-label={heroInWatchlist ? 'إزالة من قائمتي' : 'إضافة لقائمتي'}
                        className={`inline-flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-xl border backdrop-blur-md transition-colors cursor-pointer ${
                          heroInWatchlist
                            ? 'bg-[#4CAF50]/20 border-[#4CAF50] text-[#4CAF50]'
                            : 'bg-[#1f242b]/80 border-white/15 text-white hover:bg-white/20'
                        }`}
                      >
                        {heroInWatchlist ? (
                          <Check className="w-4 h-4" />
                        ) : (
                          <Bookmark className="w-4 h-4" />
                        )}
                      </button>

                      {isAdmin && onOpenHomeBuilder && (
                        <button
                          type="button"
                          onClick={onOpenHomeBuilder}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-[#f9c400] hover:bg-[#eab308] px-3.5 py-2.5 sm:py-3 text-xs font-black text-[#0f0f0f] transition-colors cursor-pointer"
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                          <span>تخصيص الرئيسية</span>
                        </button>
                      )}
                    </div>

                    {homeConfig.heroShowHighlights && (
                      <div className="pt-1 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] font-medium text-[#a3a3a3]">
                        <span className="inline-flex items-center gap-1">
                          <Zap className="w-3 h-3 text-[#E50914]" />
                          <span>سيرفرات سريعة بدون تقطيع</span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Film className="w-3 h-3 text-[#f9c400]" />
                          <span>دقة 4K UHD</span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3 text-[#4CAF50]" />
                          <span>تحديث يومي</span>
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Left Controls: Circular Prev/Next Arrows + Progress Dots */}
                  {heroSlides.length > 1 && (
                    <div className="flex flex-col items-start lg:items-end gap-2.5 shrink-0">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setHeroIndex(
                              (prev) => (prev - 1 + heroSlides.length) % heroSlides.length
                            )
                          }
                          aria-label="العرض السابق"
                          className="inline-flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full bg-black/65 border border-white/15 text-white hover:bg-[#E50914] hover:border-[#E50914] transition-colors cursor-pointer"
                        >
                          <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setHeroIndex((prev) => (prev + 1) % heroSlides.length)}
                          aria-label="العرض التالي"
                          className="inline-flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full bg-black/65 border border-white/15 text-white hover:bg-[#E50914] hover:border-[#E50914] transition-colors cursor-pointer"
                        >
                          <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {heroSlides.map((item, idx) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setHeroIndex(idx)}
                            aria-label={`عرض ${item.title}`}
                            className={`h-1 rounded-full transition-all cursor-pointer ${
                              idx === activeSlideIndex
                                ? 'w-6 bg-[#E50914]'
                                : 'w-1.5 bg-white/35 hover:bg-white/65'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 8 Square Poster Thumbnails Strip (Desktop: 64x64px, Gap: 12px, Radius: 8px, Active Border: 2px #E50914, Zero Text) */}
                {heroSlides.length > 1 && (
                  <div className="flex items-center justify-center pt-1">
                    <div
                      className="flex items-center justify-center gap-[12px] overflow-x-auto no-scrollbar px-2 py-1.5 max-w-full"
                      role="tablist"
                      aria-label="الأعمال المميزة في السلايدر"
                    >
                      {heroSlides.map((item, idx) => {
                        const isActiveThumb = idx === activeSlideIndex;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            role="tab"
                            aria-selected={isActiveThumb}
                            aria-label={item.title}
                            onClick={() => setHeroIndex(idx)}
                            className={`relative aspect-square w-[52px] h-[52px] sm:w-[64px] sm:h-[64px] shrink-0 rounded-[8px] overflow-hidden p-0 bg-[#181818] transition-all duration-200 cursor-pointer focus:outline-none ${
                              isActiveThumb
                                ? 'border-2 border-[#E50914] shadow-[0_0_20px_rgba(229,9,20,0.65)] scale-[1.04] opacity-100'
                                : 'border-2 border-white/20 opacity-75 hover:opacity-100 hover:border-white/55'
                            }`}
                          >
                            <img
                              src={getHeroThumbUrl(item)}
                              alt={item.title}
                              loading="eager"
                              decoding="async"
                              referrerPolicy="no-referrer"
                              onError={handlePosterError}
                              className="h-full w-full object-cover object-top"
                            />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        );
      })()}

      {/* Admin Quick Customize Banner when Hero is hidden */}
      {!homeConfig.showHero && (
        <div className="pt-20 mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 flex justify-end">
          {isAdmin && onOpenHomeBuilder && (
            <button
              type="button"
              onClick={onOpenHomeBuilder}
              className="inline-flex items-center gap-2 rounded-xl bg-[#f9c400] px-4 py-2 text-xs font-black text-[#0f0f0f] cursor-pointer"
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>تخصيص الصفحة الرئيسية</span>
            </button>
          )}
        </div>
      )}

      {/* 2. Clean Single-Row Quick Filter Strip */}
      {homeConfig.showQuickFilters && (
        <section className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-3 overflow-x-auto no-scrollbar py-1">
            <div className="flex items-center gap-2 shrink-0">
              {QUICK_FILTER_TABS.map((tab, idx) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onApplyFilter(tab.filter)}
                  className={`rounded-xl px-4 py-2 text-xs sm:text-sm font-bold whitespace-nowrap transition-colors cursor-pointer border ${
                    idx === 0
                      ? 'bg-[#E50914] border-[#E50914] text-white'
                      : 'bg-[#181818] border-white/[0.08] text-[#d4d4d4] hover:bg-[#242424] hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => onApplyFilter({})}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#181818] border border-white/[0.08] px-3.5 py-2 text-xs font-bold text-[#a3a3a3] hover:text-white hover:border-white/25 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#E50914]" />
              <span>تصفية متقدمة</span>
            </button>
          </div>
        </section>
      )}

      {/* Optional Smooth News Ticker (Only if enabled in Settings) */}
      {siteSettings.tickerEnabled && tickerItems.length > 0 && (
        <section className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
          <div className="moov-ticker rounded-2xl bg-[#161616] border border-white/[0.07] py-2.5 overflow-hidden">
            <div className="moov-ticker-track items-center gap-3 px-4">
              {tickerItems.map((item, idx) => (
                <button
                  key={`${item.id}-${idx}`}
                  type="button"
                  onClick={() => onSelectMedia(item)}
                  className="inline-flex items-center gap-2.5 rounded-xl bg-[#202020] border border-white/[0.06] px-3 py-1.5 hover:border-[#E50914] transition-colors shrink-0 cursor-pointer"
                >
                  <img
                    src={item.poster || FALLBACK_POSTER}
                    alt={item.title}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={handlePosterError}
                    className="h-9 w-7 rounded object-cover"
                  />
                  <div className="text-right">
                    <p className="text-xs font-bold text-white whitespace-nowrap">{item.title}</p>
                    <p className="font-latin text-[10px] font-bold text-[#f9c400] tabular-nums">
                      {item.quality} · ★ {Number(item.imdb || 7.5).toFixed(1)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 3. Dynamic Admin-Controlled Content Sections */}
      {enabledSections.map((section) => {
        const items = resolveSectionMediaItems(catalog, section);
        if (items.length === 0) return null;

        return (
          <RevealSection
            key={section.id}
            className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 space-y-4"
          >
            <div className="flex items-end justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  {getSectionIcon(section.source)}
                  <h2 className="font-display text-xl sm:text-2xl font-extrabold text-white">
                    {section.title}
                  </h2>
                </div>
                {section.subtitle && (
                  <p className="text-xs sm:text-sm text-[#a3a3a3]">{section.subtitle}</p>
                )}
              </div>

              <button
                type="button"
                onClick={() => onApplyFilter(getSectionViewAllFilter(section))}
                className="inline-flex items-center gap-1 rounded-xl bg-[#181818] hover:bg-[#E50914] border border-white/[0.08] px-3.5 py-2 text-xs font-bold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>عرض الكل</span>
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            </div>

            {section.layout === 'row' ? (
              <SectionHorizontalRow
                items={items}
                cardStyle={homeConfig.cardStyle}
                watchlistIds={watchlistIds}
                onSelectMedia={onSelectMedia}
                onToggleWatchlist={onToggleWatchlist}
              />
            ) : (
              <div className={`grid ${gridColClass} gap-4`}>
                {items.map((item) => (
                  <MovieCard
                    key={item.id}
                    item={item}
                    onSelect={onSelectMedia}
                    isInWatchlist={watchlistIds.includes(item.id)}
                    onToggleWatchlist={onToggleWatchlist}
                    variant={homeConfig.cardStyle}
                  />
                ))}
              </div>
            )}
          </RevealSection>
        );
      })}

      {/* 4. Optional Category Tag Strip (Admin Toggleable) */}
      {homeConfig.showCategoryBar && (
        <RevealSection className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl bg-[#141414] border border-white/[0.07] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Tags className="w-4 h-4 text-[#E50914]" />
                <h2 className="font-display text-base font-extrabold text-white">الأقسام السريعة</h2>
              </div>
              <button
                type="button"
                onClick={() => onApplyFilter({})}
                className="text-xs font-bold text-[#E50914] hover:text-white transition-colors cursor-pointer"
              >
                كل الأقسام ({catalog.length})
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {quickCategoryChips.map((tag) => (
                <button
                  key={tag.category}
                  type="button"
                  onClick={() => onApplyFilter({ category: tag.category })}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#1c1c1c] border border-white/[0.07] px-3 py-1.5 text-xs font-bold text-[#d4d4d4] hover:bg-[#E50914] hover:border-[#E50914] hover:text-white transition-colors cursor-pointer"
                >
                  <span>{tag.label}</span>
                  <span className="font-latin text-[11px] opacity-70 tabular-nums">{tag.count}</span>
                </button>
              ))}
            </div>
          </div>
        </RevealSection>
      )}

      {/* 5. Optional Full Paginated Library (Admin Toggleable) */}
      {homeConfig.showFullLibrary && (
        <RevealSection className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl bg-[#141414] border border-white/[0.08] p-5 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.08] pb-4">
              <div className="flex items-center gap-2.5">
                <Grid2x2 className="w-5 h-5 text-[#E50914]" />
                <div>
                  <h2 className="font-display text-lg sm:text-xl font-extrabold text-white">
                    المكتبة الكاملة ({filteredLibraryItems.length})
                  </h2>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {[
                  { id: 'all' as const, label: 'الكل' },
                  { id: 'movie' as const, label: 'أفلام' },
                  { id: 'series' as const, label: 'مسلسلات' },
                  { id: 'other' as const, label: 'برامج ومصارعة' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setLibraryFilter(tab.id)}
                    className={`rounded-xl px-3.5 py-1.5 text-xs font-bold border transition-colors cursor-pointer ${
                      libraryFilter === tab.id
                        ? 'bg-[#E50914] border-[#E50914] text-white'
                        : 'bg-[#1c1c1c] border-white/10 text-[#a3a3a3] hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={`grid ${gridColClass} gap-4`}>
              {paginatedLibraryItems.map((item) => (
                <MovieCard
                  key={item.id}
                  item={item}
                  onSelect={onSelectMedia}
                  isInWatchlist={watchlistIds.includes(item.id)}
                  onToggleWatchlist={onToggleWatchlist}
                  variant={homeConfig.cardStyle}
                />
              ))}
            </div>

            {totalLibraryPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  type="button"
                  disabled={safeLibraryPage <= 1}
                  onClick={() => setLibraryPage((p) => Math.max(1, p - 1))}
                  className="rounded-xl bg-[#1c1c1c] border border-white/10 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40 cursor-pointer"
                >
                  السابق
                </button>
                <span className="font-latin text-xs font-bold text-[#a3a3a3] tabular-nums">
                  {safeLibraryPage} / {totalLibraryPages}
                </span>
                <button
                  type="button"
                  disabled={safeLibraryPage >= totalLibraryPages}
                  onClick={() => setLibraryPage((p) => Math.min(totalLibraryPages, p + 1))}
                  className="rounded-xl bg-[#1c1c1c] border border-white/10 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40 cursor-pointer"
                >
                  التالي
                </button>
              </div>
            )}
          </div>
        </RevealSection>
      )}

      {/* 6. Clean Request / Contact CTA Banner */}
      {homeConfig.showRequestBanner && (
        <RevealSection className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl bg-gradient-to-l from-[#1c1c1c] via-[#161616] to-[#141414] border border-white/[0.08] p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
            <div className="space-y-1.5">
              <h2 className="font-display text-lg sm:text-xl font-extrabold text-white">
                تبحث عن فيلم أو مسلسل غير موجود؟
              </h2>
              <p className="text-xs sm:text-sm text-[#a3a3a3]">
                أرسل طلبك مباشرة لفريق الموقع وسنقوم بتوفيره بأعلى جودة متاحة.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenContact}
              className="inline-flex items-center gap-2 rounded-xl bg-[#E50914] hover:bg-[#f40612] px-5 py-3 text-xs sm:text-sm font-extrabold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <MessageSquarePlus className="w-4 h-4" />
              <span>اطلب عملاً أو تواصل معنا</span>
            </button>
          </div>
        </RevealSection>
      )}
    </div>
  );
}
