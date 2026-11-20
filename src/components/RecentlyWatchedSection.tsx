import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  Clock,
  EyeOff,
  History,
  Info,
  Play,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import type { MediaItem, RecentlyWatchedRecord } from '../types/media';
import { FALLBACK_POSTER } from '../lib/mediaFilters';
import { optimizeTmdbUrl } from '../lib/mediaImages';
import { formatRelativeArabicTime } from '../lib/recentlyWatched';
import { OptimizedImage } from './OptimizedImage';

interface RecentlyWatchedSectionProps {
  items: RecentlyWatchedRecord[];
  catalog: MediaItem[];
  isSignedIn: boolean;
  hideCompleted: boolean;
  onToggleHideCompleted: (next: boolean) => void;
  onResumeItem: (record: RecentlyWatchedRecord, matchedMedia?: MediaItem) => void;
  onOpenDetails: (record: RecentlyWatchedRecord, matchedMedia?: MediaItem) => void;
  onRemoveItem: (record: RecentlyWatchedRecord) => void;
  onOpenManager: () => void;
}

const INITIAL_PAGE_SIZE = 6;

export function RecentlyWatchedSection({
  items,
  catalog,
  isSignedIn,
  hideCompleted,
  onToggleHideCompleted,
  onResumeItem,
  onOpenDetails,
  onRemoveItem,
  onOpenManager,
}: RecentlyWatchedSectionProps) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_PAGE_SIZE);

  const catalogById = useMemo(() => {
    const map = new Map<string, MediaItem>();
    for (const m of catalog) {
      map.set(m.id, m);
    }
    return map;
  }, [catalog]);

  if (!items || items.length === 0) {
    return null;
  }

  const displayedItems = items.slice(0, visibleCount);
  const hasMore = items.length > displayedItems.length;

  return (
    <section
      aria-label="شاهدته مؤخراً"
      className="mx-auto max-w-[1440px] px-3.5 sm:px-6 lg:px-8 space-y-3.5 sm:space-y-4"
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <History className="w-5 h-5 text-[#E50914] shrink-0" />
            <h2
              style={{ fontSize: 'var(--rtv-section-title-size, 22px)' }}
              className="font-display font-extrabold text-white leading-snug truncate"
            >
              شاهدته مؤخراً
            </h2>
            <span className="font-latin rounded-lg bg-white/[0.06] border border-white/10 px-2 py-0.5 text-[11px] font-bold text-[#b7c9ef] tabular-nums">
              {items.length}
            </span>
          </div>

          {!isSignedIn && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#f9c400]/10 border border-[#f9c400]/25 px-2.5 py-1 text-[10.5px] font-bold text-[#fde68a]">
              <Clock className="w-3 h-3 text-[#f9c400] shrink-0" />
              <span>محفوظ محلياً على هذا الجهاز — سجّل الدخول لمزامنته</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onToggleHideCompleted(!hideCompleted)}
            className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
              hideCompleted
                ? 'bg-[#4CAF50]/20 border-[#4CAF50]/50 text-[#4CAF50]'
                : 'bg-[#181818] border-white/[0.08] text-[#b7c9ef] hover:text-white'
            }`}
          >
            <EyeOff className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">إخفاء المكتملة</span>
          </button>

          <button
            type="button"
            onClick={onOpenManager}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[#181818] hover:bg-[#E50914] border border-white/[0.08] px-3 sm:px-3.5 py-1.5 text-xs font-bold text-white transition-colors cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
            <span>إدارة السجل</span>
            <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
          </button>
        </div>
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
        {displayedItems.map((rec) => {
          const matchedMedia = catalogById.get(rec.mediaId);
          const posterSrc = optimizeTmdbUrl(
            matchedMedia?.poster_url || matchedMedia?.poster || rec.poster || FALLBACK_POSTER,
            'w342'
          );
          const title = matchedMedia?.title || rec.title;
          const pct = Math.min(100, Math.max(0, rec.progressPct || 0));

          return (
            <article
              key={rec.id}
              className="group relative flex flex-col rounded-2xl bg-[#181818] border border-white/[0.08] overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-white/25 hover:bg-[#202020] shadow-lg"
            >
              {/* Poster */}
              <div
                onClick={() => onResumeItem(rec, matchedMedia)}
                className="relative aspect-[2/3] w-full overflow-hidden bg-[#111] cursor-pointer"
              >
                <OptimizedImage
                  src={posterSrc}
                  fallbackSrc={FALLBACK_POSTER}
                  alt={title}
                  slot="card_grid"
                  loading="lazy"
                  className="h-full w-full"
                  imgClassName="object-cover object-top transition-transform duration-500 group-hover:scale-105"
                />

                <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-t from-[#181818] via-black/15 to-black/50" />

                {/* Top Right Episode or Completion Badge */}
                <div className="absolute top-2 right-2 z-20 flex flex-col items-end gap-1">
                  {rec.completed ? (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-[#4CAF50]/90 px-2 py-0.5 text-[10px] font-black text-white shadow">
                      <CheckCircle2 className="w-2.5 h-2.5" />
                      <span>مكتمل</span>
                    </span>
                  ) : rec.episodeNumber ? (
                    <span className="font-latin rounded-lg bg-[#E50914]/90 px-2 py-0.5 text-[10px] font-black text-white shadow">
                      {rec.seasonNumber ? `S${rec.seasonNumber} · ` : ''}E{rec.episodeNumber}
                    </span>
                  ) : (
                    <span className="font-latin rounded-lg bg-black/75 border border-white/15 px-2 py-0.5 text-[10px] font-bold text-white">
                      {rec.quality || matchedMedia?.quality || 'HD'}
                    </span>
                  )}
                </div>

                {/* Top Left Quick Remove */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveItem(rec);
                  }}
                  aria-label={`إزالة ${title} من سجل المشاهدة`}
                  title="إزالة من السجل"
                  className="absolute top-2 left-2 z-20 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-black/70 border border-white/15 text-white/80 hover:bg-[#D92321] hover:border-[#D92321] hover:text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                {/* Center Resume Play Icon */}
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#E50914]/95 text-white shadow-[0_8px_24px_rgba(229,9,20,0.5)] scale-95 sm:scale-90 sm:opacity-0 transition-all duration-200 group-hover:scale-100 group-hover:opacity-100">
                    <Play className="w-5 h-5 fill-current mr-[-2px]" />
                  </div>
                </div>

                {/* Bottom Progress Bar */}
                <div className="absolute inset-x-0 bottom-0 z-20 h-1 bg-white/15">
                  <div
                    className={`h-full transition-all duration-300 ${
                      rec.completed ? 'bg-[#4CAF50]' : 'bg-[#E50914]'
                    }`}
                    style={{ width: `${Math.max(pct, 6)}%` }}
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex flex-1 flex-col justify-between gap-2 p-2.5 text-right">
                <div
                  onClick={() => onResumeItem(rec, matchedMedia)}
                  className="cursor-pointer min-w-0"
                >
                  <h3
                    style={{ fontSize: 'var(--rtv-card-title-size, 13px)' }}
                    className="font-display font-bold text-white leading-snug line-clamp-1 group-hover:text-[#E50914] transition-colors"
                  >
                    {title}
                  </h3>
                  <div className="mt-1 flex items-center justify-between gap-1 text-[10.5px] font-medium text-[#a3a3a3]">
                    <span className="truncate">
                      {rec.episodeNumber
                        ? `الحلقة ${rec.episodeNumber}`
                        : rec.year || matchedMedia?.year || '2026'}
                    </span>
                    <span className="shrink-0 text-[#b7c9ef]/80">
                      {formatRelativeArabicTime(rec.lastWatchedAtMs)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 pt-1 border-t border-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => onResumeItem(rec, matchedMedia)}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-[#E50914]/15 hover:bg-[#E50914] border border-[#E50914]/35 py-1.5 text-[11px] font-extrabold text-white transition-colors cursor-pointer"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>{rec.completed ? 'إعادة' : 'متابعة'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenDetails(rec, matchedMedia)}
                    aria-label={`تفاصيل ${title}`}
                    title="صفحة التفاصيل"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.06] hover:bg-white/15 border border-white/10 text-[#b7c9ef] hover:text-white transition-colors cursor-pointer shrink-0"
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* Show More Pagination */}
      {hasMore && (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={() => setVisibleCount((prev) => prev + INITIAL_PAGE_SIZE)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#181818] hover:bg-[#242424] border border-white/10 px-5 py-2.5 text-xs font-extrabold text-white transition-colors cursor-pointer"
          >
            <span>عرض المزيد ({items.length - displayedItems.length})</span>
          </button>
        </div>
      )}
    </section>
  );
}
