import { useEffect, useState } from 'react';
import {
  Bookmark,
  Calendar,
  Check,
  ChevronLeft,
  Clock,
  Copy,
  Download,
  Film,
  Globe,
  Languages,
  Layers,
  Play,
  Server,
  Share2,
  Star,
  Tv,
  Users,
} from 'lucide-react';
import { FALLBACK_BACKDROP, FALLBACK_POSTER, handleBackdropError, handlePosterError } from '../lib/mediaFilters';
import { MediaItem, CatalogFilterState } from '../types/media';
import { MovieCard } from './MovieCard';

interface SingleDetailViewProps {
  catalog: MediaItem[];
  item: MediaItem;
  initialOpenDownloads?: boolean;
  onSelectMedia: (item: MediaItem, openDownloads?: boolean) => void;
  onApplyFilter: (partial: Partial<CatalogFilterState>) => void;
  onNavigateHome: () => void;
  onOpenTrailer: (item: MediaItem) => void;
  onOpenPlayer: (item: MediaItem, episodeNumber?: number, serverIndex?: number) => void;
  isInWatchlist: boolean;
  onToggleWatchlist: (item: MediaItem) => void;
  onNotify: (message: string) => void;
  watchlistIds: string[];
}

type DetailTab = 'watch' | 'seasons' | 'franchise' | 'cast';

export function SingleDetailView({
  catalog,
  item,
  initialOpenDownloads = false,
  onSelectMedia,
  onApplyFilter,
  onNavigateHome,
  onOpenTrailer,
  onOpenPlayer,
  isInWatchlist,
  onToggleWatchlist,
  onNotify,
  watchlistIds,
}: SingleDetailViewProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('watch');
  const [showDownloads, setShowDownloads] = useState(initialOpenDownloads);
  const [selectedSeasonIdx, setSelectedSeasonIdx] = useState(0);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    setActiveTab('watch');
    setShowDownloads(initialOpenDownloads);
    if (initialOpenDownloads) {
      setTimeout(() => {
        document.getElementById('watch-download-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
  }, [item.id, initialOpenDownloads]);

  const seasons = item.seasons || [];
  const activeSeason = seasons[selectedSeasonIdx];
  const franchiseItems = (item.franchiseIds || [])
    .map((id) => catalog.find((c) => c.id === id))
    .filter((c): c is MediaItem => Boolean(c));

  const relatedItems = catalog
    .filter(
      (c) =>
        c.id !== item.id &&
        (c.kind === item.kind || c.genres.some((g) => item.genres.includes(g)))
    )
    .slice(0, 6);

  const handleCopyShortUrl = async () => {
    try {
      await navigator.clipboard.writeText(item.shortUrl);
    } catch {
      // Clipboard fallback ignored cleanly in sandboxed frames
    }
    setCopiedUrl(true);
    onNotify('تم نسخ الرابط المختصر بنجاح');
    setTimeout(() => setCopiedUrl(false), 2400);
  };

  const handleSocialShare = async (platform: string) => {
    const shareText = `${item.title} — شاهد الآن على RahaL TV: ${item.shortUrl}`;
    try {
      await navigator.clipboard.writeText(shareText);
    } catch {
      // Clipboard fallback ignored
    }
    onNotify(`تم نسخ رابط المشاركة لـ ${platform}`);
  };

  const handleDownload = (quality: string, host: string) => {
    onNotify(`بدأ تجهيز رابط التحميل (${quality}) عبر ${host}`);
  };

  return (
    <div className="pb-10">
      {/* 1. Single Hero Head (.single-head with hex texture, spotlight & IMDb card) */}
      <section className="relative min-h-[340px] sm:min-h-[390px] overflow-hidden border-b border-white/[0.08] bg-[#0c1821]">
        <img
          src={item.backdrop || item.poster || FALLBACK_BACKDROP}
          alt={item.title}
          referrerPolicy="no-referrer"
          onError={handleBackdropError}
          className="absolute inset-0 h-full w-full object-cover opacity-35"
        />
        <div className="absolute inset-0 bg-[#06131c]/75" />
        <div className="moov-hex-pattern absolute inset-0" />
        <div className="moov-spotlight absolute inset-0" />

        <div className="relative z-10 mx-auto flex max-w-[1440px] flex-col justify-end px-4 sm:px-6 lg:px-8 pt-28 pb-12 min-h-[340px] sm:min-h-[390px]">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            {/* Breadcrumb & Page Title */}
            <div className="md:pr-64 lg:pr-72">
              <nav className="mb-3 flex flex-wrap items-center gap-1.5 text-xs font-bold text-[#b7c9ef]">
                <button
                  type="button"
                  onClick={onNavigateHome}
                  className="hover:text-white transition-colors cursor-pointer"
                >
                  RahaL TV
                </button>
                <ChevronLeft className="w-3.5 h-3.5 text-white/40" />
                <button
                  type="button"
                  onClick={() => onApplyFilter({ category: item.categories[0] })}
                  className="hover:text-white transition-colors cursor-pointer"
                >
                  {item.categories[0]}
                </button>
                {item.categories[1] && (
                  <>
                    <ChevronLeft className="w-3.5 h-3.5 text-white/40" />
                    <button
                      type="button"
                      onClick={() => onApplyFilter({ category: item.categories[1] })}
                      className="hover:text-white transition-colors cursor-pointer"
                    >
                      {item.categories[1]}
                    </button>
                  </>
                )}
                <ChevronLeft className="w-3.5 h-3.5 text-white/40" />
                <span className="text-white">{item.title}</span>
              </nav>

              <h1 className="font-display text-2xl sm:text-4xl font-extrabold text-white leading-tight">
                {item.title} بجودة عالية
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-medium text-[#b7c9ef]">{item.tagline}</p>
            </div>

            {/* Overlapping IMDb Card (.single-imdb) */}
            <div className="inline-flex items-center gap-3.5 self-start md:self-end rounded-2xl bg-[#1a242e]/95 border border-[#f9c400]/35 px-4 py-3 shadow-xl backdrop-blur-md">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#f9c400] text-[#06131c]">
                <Star className="w-6 h-6 fill-current" />
              </div>
              <div>
                <div className="flex items-baseline gap-1">
                  <span className="font-latin text-2xl font-black text-white">
                    {item.imdb.toFixed(1)}
                  </span>
                  <span className="font-latin text-xs font-bold text-[#b7c9ef]">/ 10</span>
                </div>
                <p className="font-latin text-[11px] font-bold text-[#b7c9ef]">
                  {item.votes} صوت — IMDb
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Single Inner Split (.single-inner: Poster Column + Info Column) */}
      <section className="relative z-20 mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 -mt-10 md:-mt-24">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
          {/* Poster Column (.single-right overlapping header) */}
          <div className="md:col-span-4 lg:col-span-3 space-y-3.5">
            <div className="relative aspect-[3/4] w-full max-w-[290px] mx-auto md:max-w-none overflow-hidden rounded-3xl border-4 border-[#1a242e] bg-[#0c1821] shadow-2xl">
              {/* Diagonal Quality Ribbon */}
              <div className="moov-ribbon bg-[#D92321] py-1 text-[11px] font-black tracking-wider text-white font-latin uppercase">
                {item.quality}
              </div>

              <img
                src={item.poster || FALLBACK_POSTER}
                alt={item.title}
                referrerPolicy="no-referrer"
                onError={handlePosterError}
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#06131c]/80 via-transparent to-transparent" />

              {/* Centered Frosted Trailer Button (.single-trailer-button) */}
              <button
                type="button"
                onClick={() => onOpenTrailer(item)}
                className="group absolute inset-0 m-auto flex h-16 w-16 flex-col items-center justify-center rounded-full bg-white/20 border border-white/40 text-white backdrop-blur-md shadow-2xl hover:bg-[#D92321] hover:border-[#D92321] hover:scale-110 transition-all cursor-pointer"
                aria-label="تشغيل الإعلان الرسمي"
              >
                <Play className="w-7 h-7 fill-current translate-x-0.5" />
              </button>

              <span className="absolute bottom-3 inset-x-0 text-center text-xs font-bold text-white/90 pointer-events-none">
                تشغيل الإعلان ({item.trailerDuration})
              </span>
            </div>

            {/* Watchlist Toggle Button (.single-playlist-button) */}
            <button
              type="button"
              onClick={() => onToggleWatchlist(item)}
              className={`w-full max-w-[290px] mx-auto md:max-w-none flex items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-extrabold border transition-all cursor-pointer ${
                isInWatchlist
                  ? 'bg-[#4CAF50] border-[#4CAF50] text-white shadow-[0_8px_22px_rgba(76,175,80,0.35)]'
                  : 'bg-[#1a242e] border-white/10 text-white hover:border-[#4CAF50] hover:text-[#4CAF50]'
              }`}
            >
              {isInWatchlist ? <Check className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
              <span>{isInWatchlist ? 'مُضاف إلى قائمتي' : 'أضافة الي قائمتي'}</span>
            </button>
          </div>

          {/* Info Column (.single-left) */}
          <div className="md:col-span-8 lg:col-span-9 md:pt-28 space-y-6">
            {/* Story Block (.single-story) */}
            <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6">
              <h2 className="font-display text-lg font-extrabold text-white mb-2.5 flex items-center gap-2">
                <span className="h-5 w-1.5 rounded-full bg-[#D92321]" />
                قصة العرض
              </h2>
              <p className="text-sm sm:text-base leading-relaxed text-[#b7c9ef]">{item.story}</p>
            </div>

            {/* Clickable Details Grid (.single-details) */}
            <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6">
              <h2 className="font-display text-lg font-extrabold text-white mb-4 flex items-center gap-2">
                <span className="h-5 w-1.5 rounded-full bg-[#f9c400]" />
                تفاصيل العرض
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="flex items-center justify-between rounded-2xl bg-[#1a242e]/70 px-4 py-3">
                  <span className="flex items-center gap-2 text-[#b7c9ef]">
                    <Layers className="w-4 h-4 text-[#D92321]" />
                    تصنيف العرض
                  </span>
                  <button
                    type="button"
                    onClick={() => onApplyFilter({ category: item.categories[1] || item.categories[0] })}
                    className="font-bold text-white hover:text-[#D92321] cursor-pointer"
                  >
                    {item.categories[1] || item.categories[0]}
                  </button>
                </div>

                <div className="flex items-center justify-between rounded-2xl bg-[#1a242e]/70 px-4 py-3">
                  <span className="flex items-center gap-2 text-[#b7c9ef]">
                    <Film className="w-4 h-4 text-[#D92321]" />
                    نوع العرض
                  </span>
                  <div className="flex flex-wrap gap-1.5 justify-end">
                    {item.genres.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => onApplyFilter({ genre: g })}
                        className="font-bold text-white hover:text-[#D92321] cursor-pointer"
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-2xl bg-[#1a242e]/70 px-4 py-3">
                  <span className="flex items-center gap-2 text-[#b7c9ef]">
                    <Calendar className="w-4 h-4 text-[#D92321]" />
                    سنة العرض
                  </span>
                  <button
                    type="button"
                    onClick={() => onApplyFilter({ year: item.year })}
                    className="font-latin font-bold text-white hover:text-[#D92321] cursor-pointer"
                  >
                    {item.year}
                  </button>
                </div>

                <div className="flex items-center justify-between rounded-2xl bg-[#1a242e]/70 px-4 py-3">
                  <span className="flex items-center gap-2 text-[#b7c9ef]">
                    <Languages className="w-4 h-4 text-[#D92321]" />
                    لغة العرض
                  </span>
                  <button
                    type="button"
                    onClick={() => onApplyFilter({ language: item.language })}
                    className="font-bold text-white hover:text-[#D92321] cursor-pointer"
                  >
                    {item.language}
                  </button>
                </div>

                <div className="flex items-center justify-between rounded-2xl bg-[#1a242e]/70 px-4 py-3">
                  <span className="flex items-center gap-2 text-[#b7c9ef]">
                    <Tv className="w-4 h-4 text-[#D92321]" />
                    جودة العرض
                  </span>
                  <button
                    type="button"
                    onClick={() => onApplyFilter({ quality: item.quality })}
                    className="font-latin font-bold text-[#f9c400] hover:underline cursor-pointer"
                  >
                    {item.quality}
                  </button>
                </div>

                <div className="flex items-center justify-between rounded-2xl bg-[#1a242e]/70 px-4 py-3">
                  <span className="flex items-center gap-2 text-[#b7c9ef]">
                    <Globe className="w-4 h-4 text-[#D92321]" />
                    بلد العرض
                  </span>
                  <button
                    type="button"
                    onClick={() => onApplyFilter({ country: item.country })}
                    className="font-bold text-white hover:text-[#D92321] cursor-pointer"
                  >
                    {item.country}
                  </button>
                </div>

                <div className="flex items-center justify-between rounded-2xl bg-[#1a242e]/70 px-4 py-3 sm:col-span-2">
                  <span className="flex items-center gap-2 text-[#b7c9ef]">
                    <Clock className="w-4 h-4 text-[#D92321]" />
                    مدة العرض
                  </span>
                  <span className="font-bold text-white">{item.duration}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Interactive Single Tabs (.single-tab) */}
      <section id="watch-download-tabs" className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 mt-8">
        <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] overflow-hidden">
          {/* Tab Switcher */}
          <div className="flex flex-wrap border-b border-white/[0.08] bg-[#1a242e]">
            <button
              type="button"
              onClick={() => setActiveTab('watch')}
              className={`inline-flex items-center gap-2 px-6 py-4 text-sm font-extrabold transition-colors cursor-pointer ${
                activeTab === 'watch'
                  ? 'bg-[#D92321] text-white'
                  : 'text-[#b7c9ef] hover:text-white hover:bg-white/5'
              }`}
            >
              <Play className="w-4 h-4" />
              <span>المشاهدة والتحميل</span>
            </button>

            {seasons.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('seasons')}
                className={`inline-flex items-center gap-2 px-6 py-4 text-sm font-extrabold transition-colors cursor-pointer ${
                  activeTab === 'seasons'
                    ? 'bg-[#D92321] text-white'
                    : 'text-[#b7c9ef] hover:text-white hover:bg-white/5'
                }`}
              >
                <Tv className="w-4 h-4" />
                <span>المواسم والحلقات</span>
              </button>
            )}

            {franchiseItems.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('franchise')}
                className={`inline-flex items-center gap-2 px-6 py-4 text-sm font-extrabold transition-colors cursor-pointer ${
                  activeTab === 'franchise'
                    ? 'bg-[#D92321] text-white'
                    : 'text-[#b7c9ef] hover:text-white hover:bg-white/5'
                }`}
              >
                <Layers className="w-4 h-4" />
                <span>سلاسل وأعمال مرتبطة</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setActiveTab('cast')}
              className={`inline-flex items-center gap-2 px-6 py-4 text-sm font-extrabold transition-colors cursor-pointer ${
                activeTab === 'cast'
                  ? 'bg-[#D92321] text-white'
                  : 'text-[#b7c9ef] hover:text-white hover:bg-white/5'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>فريق العمل</span>
            </button>
          </div>

          {/* Tab Panel Content */}
          <div className="p-6">
            {activeTab === 'watch' && (
              <div className="space-y-6">
                {/* Watch & Download Primary CTAs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => onOpenPlayer(item, 1)}
                    className="flex items-center justify-center gap-3 rounded-2xl bg-[#D92321] hover:bg-[#dc0e30] py-4 px-6 text-base font-extrabold text-white shadow-[0_12px_30px_rgba(217,35,33,0.4)] transition-transform hover:-translate-y-0.5 cursor-pointer"
                  >
                    <Play className="w-5 h-5 fill-current" />
                    <span>مشاهدة الآن (سيرفرات متعددة)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowDownloads((prev) => !prev)}
                    className="flex items-center justify-center gap-3 rounded-2xl bg-[#4CAF50] hover:bg-[#43a047] py-4 px-6 text-base font-extrabold text-white shadow-[0_12px_30px_rgba(76,175,80,0.3)] transition-transform hover:-translate-y-0.5 cursor-pointer"
                  >
                    <Download className="w-5 h-5" />
                    <span>{showDownloads ? 'إخفاء روابط التحميل' : 'تحميل الآن (روابط مباشرة)'}</span>
                  </button>
                </div>

                {/* Compact Number + Quality Server Strip */}
                {item.servers.length > 0 && (
                  <div className="rounded-2xl bg-[#101e29] border border-white/[0.08] p-3.5 sm:p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#4CAF50] opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#4CAF50]" />
                        </span>
                        <h3 className="text-xs sm:text-sm font-extrabold text-white flex items-center gap-1.5">
                          <Server className="w-4 h-4 text-[#D92321]" />
                          <span>السيرفرات ({item.servers.length})</span>
                        </h3>
                      </div>
                      <span className="text-[11px] font-bold text-[#b7c9ef]">اختر رقم السيرفر للتشغيل</span>
                    </div>

                    <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-2">
                      {item.servers.map((srv, idx) => {
                        const cleanQ =
                          String(srv.quality || item.quality || 'HD')
                            .replace(/مستورد|embed/gi, '')
                            .trim() || 'HD';
                        return (
                          <button
                            key={srv.id || idx}
                            type="button"
                            onClick={() => onOpenPlayer(item, 1, idx)}
                            style={{ animationDelay: `${idx * 35}ms` }}
                            className="moov-server-card moov-server-enter group flex items-center justify-between gap-1.5 rounded-xl bg-[#1a242e]/90 border border-white/[0.08] px-2.5 py-2 transition-all duration-300 hover:border-[#D92321]/70 hover:bg-gradient-to-l hover:from-[#D92321]/25 hover:to-[#1a242e] hover:-translate-y-0.5 cursor-pointer"
                          >
                            <span className="font-latin flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#0c1821] border border-white/10 text-xs font-black text-white group-hover:bg-[#D92321] group-hover:border-[#D92321] transition-colors">
                              {idx + 1}
                            </span>

                            <span className="font-latin shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black text-[#f9c400]">
                              {cleanQ}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Expandable Download Quality Selector */}
                {showDownloads && (
                  <div className="rounded-2xl bg-[#1a242e] border border-[#4CAF50]/30 p-5 space-y-3">
                    <h3 className="text-sm font-extrabold text-white mb-2">
                      اختر جودة التحميل المناسبة لجهازك:
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {item.downloads.map((dl) =>
                        dl.url && /^https?:\/\//i.test(dl.url) ? (
                          <a
                            key={dl.id}
                            href={dl.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => handleDownload(dl.quality, dl.host)}
                            className="flex items-center justify-between rounded-xl bg-[#0c1821] border border-white/10 px-4 py-3 text-right hover:border-[#4CAF50] transition-colors cursor-pointer"
                          >
                            <div>
                              <p className="font-latin text-sm font-extrabold text-white">
                                {dl.quality}
                              </p>
                              <p className="text-[11px] text-[#b7c9ef]">
                                {dl.host} • {dl.format}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-latin rounded-md bg-white/10 px-2 py-1 text-xs font-bold text-[#4CAF50]">
                                {dl.size}
                              </span>
                              <Download className="w-4 h-4 text-[#4CAF50]" />
                            </div>
                          </a>
                        ) : (
                          <button
                            key={dl.id}
                            type="button"
                            onClick={() => handleDownload(dl.quality, dl.host)}
                            className="flex items-center justify-between rounded-xl bg-[#0c1821] border border-white/10 px-4 py-3 text-right hover:border-[#4CAF50] transition-colors cursor-pointer"
                          >
                            <div>
                              <p className="font-latin text-sm font-extrabold text-white">
                                {dl.quality}
                              </p>
                              <p className="text-[11px] text-[#b7c9ef]">
                                {dl.host} • {dl.format}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-latin rounded-md bg-white/10 px-2 py-1 text-xs font-bold text-[#4CAF50]">
                                {dl.size}
                              </span>
                              <Download className="w-4 h-4 text-[#4CAF50]" />
                            </div>
                          </button>
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* Short URL & Social Share Row */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-2xl bg-[#1a242e]/60 border border-white/[0.08] p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
                    <span className="text-xs font-extrabold text-[#b7c9ef] whitespace-nowrap">
                      الرابط المختصر:
                    </span>
                    <div className="flex flex-1 items-center gap-2 rounded-xl bg-[#06131c] border border-white/10 px-3 py-2">
                      <input
                        type="text"
                        readOnly
                        dir="ltr"
                        value={item.shortUrl}
                        aria-label="الرابط المختصر للعرض"
                        className="font-latin w-full bg-transparent text-xs text-white/90 focus:outline-none text-left"
                      />
                      <button
                        type="button"
                        onClick={handleCopyShortUrl}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors shrink-0 cursor-pointer ${
                          copiedUrl
                            ? 'bg-[#4CAF50] text-white'
                            : 'bg-[#D92321] hover:bg-[#dc0e30] text-white'
                        }`}
                      >
                        {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedUrl ? 'تم النسخ' : 'نسخ'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-[#b7c9ef] ml-1">
                      <Share2 className="w-3.5 h-3.5" />
                      مشاركة:
                    </span>
                    {['فيسبوك', 'إكس', 'تيليجرام', 'واتساب'].map((platform) => (
                      <button
                        key={platform}
                        type="button"
                        onClick={() => handleSocialShare(platform)}
                        className="rounded-xl bg-[#0c1821] border border-white/10 px-3 py-1.5 text-xs font-bold text-[#b7c9ef] hover:border-[#D92321] hover:text-white transition-colors cursor-pointer"
                      >
                        {platform}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'seasons' && activeSeason && (
              <div className="space-y-5">
                <div className="flex flex-wrap gap-2">
                  {seasons.map((season, idx) => (
                    <button
                      key={season.seasonNumber}
                      type="button"
                      onClick={() => setSelectedSeasonIdx(idx)}
                      className={`rounded-xl px-4 py-2.5 text-xs font-extrabold transition-colors cursor-pointer ${
                        selectedSeasonIdx === idx
                          ? 'bg-[#D92321] text-white'
                          : 'bg-[#1a242e] text-[#b7c9ef] border border-white/10 hover:text-white'
                      }`}
                    >
                      {season.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {activeSeason.episodes.map((ep) => (
                    <button
                      key={ep.number}
                      type="button"
                      onClick={() => onOpenPlayer(item, ep.number)}
                      className="group flex items-center justify-between rounded-2xl bg-[#1a242e] border border-white/[0.08] p-4 text-right hover:border-[#D92321] transition-all cursor-pointer"
                    >
                      <div>
                        <p className="text-sm font-extrabold text-white group-hover:text-[#D92321]">
                          الحلقة {String(ep.number).padStart(2, '0')}
                        </p>
                        <p className="text-[11px] text-[#b7c9ef] mt-0.5">
                          {ep.duration} • {ep.quality}
                        </p>
                      </div>
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#0c1821] text-[#D92321] group-hover:bg-[#D92321] group-hover:text-white transition-colors">
                        <Play className="w-4 h-4 fill-current" />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'franchise' && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {franchiseItems.map((rel) => (
                  <MovieCard
                    key={rel.id}
                    item={rel}
                    onSelect={onSelectMedia}
                    isInWatchlist={watchlistIds.includes(rel.id)}
                    onToggleWatchlist={onToggleWatchlist}
                  />
                ))}
              </div>
            )}

            {activeTab === 'cast' && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {item.cast.map((actor) => (
                  <div
                    key={actor.name}
                    className="flex flex-col items-center rounded-2xl bg-[#1a242e]/70 border border-white/[0.07] p-4 text-center"
                  >
                    <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[#D92321] to-[#1a242e] border-2 border-white/20 text-lg font-black text-white shadow-lg">
                      {actor.initials}
                    </div>
                    <p className="text-sm font-extrabold text-white leading-snug">{actor.name}</p>
                    <p className="text-xs text-[#b7c9ef] mt-1">{actor.role}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 4. Related Shows Grid (عروض ذات صلة) */}
      <section className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 mt-12">
        <div className="mb-5">
          <h2 className="font-display text-xl sm:text-2xl font-extrabold text-white">عروض ذات صلة</h2>
          <p className="text-xs text-[#b7c9ef] mt-1">أعمال مشابهة قد تنال إعجابك</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {relatedItems.map((rel) => (
            <MovieCard
              key={rel.id}
              item={rel}
              onSelect={onSelectMedia}
              isInWatchlist={watchlistIds.includes(rel.id)}
              onToggleWatchlist={onToggleWatchlist}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
