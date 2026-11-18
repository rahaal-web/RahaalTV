import { Bookmark, Check, Download, Film, Globe, Languages, Play, Star, Tag } from 'lucide-react';
import { handlePosterError } from '../lib/mediaFilters';
import { buildPosterSrcSet, getPosterUrl } from '../lib/mediaImages';
import { MediaItem } from '../types/media';

interface MovieCardProps {
  item: MediaItem;
  onSelect: (item: MediaItem, openDownloads?: boolean) => void;
  isInWatchlist: boolean;
  onToggleWatchlist: (item: MediaItem) => void;
  variant?: 'clean' | 'classic';
}

export function MovieCardSkeleton() {
  return (
    <div className="flex flex-col rounded-2xl bg-[#181818] border border-white/[0.06] overflow-hidden">
      <div className="aspect-[2/3] w-full rtv-skeleton" />
      <div className="p-3 space-y-2">
        <div className="h-4 w-4/5 rounded rtv-skeleton" />
        <div className="h-3 w-1/2 rounded rtv-skeleton" />
      </div>
    </div>
  );
}

export function MovieCard({
  item,
  onSelect,
  isInWatchlist,
  onToggleWatchlist,
  variant = 'clean',
}: MovieCardProps) {
  const safeImdb = Number(item.imdb || 7.5).toFixed(1);
  const primaryCat =
    item.categories?.[1] ||
    item.categories?.[0] ||
    (item.kind === 'series' ? 'مسلسلات' : item.kind === 'wrestling' ? 'مصارعة حرة' : 'افلام');
  const genresText = item.genres?.length ? item.genres.slice(0, 2).join('، ') : 'دراما';

  if (variant === 'classic') {
    return (
      <article className="moov-card moov-card-perspective group relative aspect-[2/3] w-full rounded-[20px] border border-white/[0.08] bg-[#181818] overflow-hidden shadow-lg">
        {/* Front Face */}
        <div
          onClick={() => onSelect(item)}
          className="moov-card-front absolute inset-0 cursor-pointer overflow-hidden rounded-[20px]"
        >
          <img
            src={getPosterUrl(item)}
            srcSet={buildPosterSrcSet(getPosterUrl(item))}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 280px"
            alt={item.title}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={handlePosterError}
            className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0f0f0f] via-[#0f0f0f]/35 to-transparent" />

          <div className="absolute top-3 left-3 flex flex-col items-start gap-1.5 z-10">
            <span className="font-latin rounded-md bg-[#E50914] px-2 py-0.5 text-[11px] font-bold text-white shadow-md">
              {item.year || '2026'}
            </span>
            <span className="font-latin rounded-md bg-black/75 backdrop-blur-sm px-2 py-0.5 text-[10px] font-extrabold text-white border border-white/15">
              {item.quality || 'HD'}
            </span>
          </div>

          <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-1">
            <div className="flex items-center gap-1 rounded-md bg-black/75 px-2 py-1 text-xs font-bold backdrop-blur-sm border border-white/10">
              <Star className="w-3.5 h-3.5 text-[#f9c400] fill-[#f9c400]" />
              <span className="font-latin text-white">{safeImdb}</span>
            </div>
            {item.communityRating && item.communityRating.count > 0 && (
              <div className="flex items-center gap-1 rounded-md bg-[#4CAF50]/85 px-2 py-0.5 text-[10px] font-extrabold text-white backdrop-blur-sm border border-white/15">
                <Star className="w-3 h-3 text-[#f9c400] fill-[#f9c400]" />
                <span className="font-latin">{item.communityRating.average.toFixed(1)}/5</span>
              </div>
            )}
          </div>

          <div className="absolute inset-x-0 bottom-0 p-3.5 text-right">
            <p className="text-[11px] font-semibold text-[#a3a3a3] truncate mb-0.5">
              {primaryCat}
            </p>
            <h3
              style={{ fontSize: 'var(--rtv-card-title-size, 13px)' }}
              className="font-display font-bold text-white leading-snug line-clamp-2"
            >
              {item.title}
            </h3>
          </div>
        </div>

        {/* Back Face */}
        <div className="moov-card-back absolute inset-0 flex flex-col justify-between rounded-[20px] bg-gradient-to-b from-[#202020] via-[#161616] to-[#0f0f0f] p-3 border border-white/10 overflow-hidden">
          <div className="min-h-0">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="font-latin text-xs font-bold text-[#f9c400] flex items-center gap-1">
                <Star className="w-3.5 h-3.5 fill-[#f9c400]" />
                {safeImdb}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleWatchlist(item);
                }}
                aria-label={isInWatchlist ? 'إزالة من قائمتي' : 'إضافة إلى قائمتي'}
                className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors cursor-pointer ${
                  isInWatchlist
                    ? 'bg-[#4CAF50]/20 border-[#4CAF50] text-[#4CAF50]'
                    : 'bg-white/5 border-white/10 text-[#a3a3a3] hover:text-white hover:border-white/30'
                }`}
              >
                {isInWatchlist ? <Check className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
              </button>
            </div>

            <h3
              onClick={() => onSelect(item)}
              style={{ fontSize: 'calc(var(--rtv-card-title-size, 13px) - 1px)' }}
              className="font-display font-extrabold text-white leading-snug mb-2 cursor-pointer hover:text-[#E50914] transition-colors line-clamp-2"
            >
              {item.title}
            </h3>

            <ul className="space-y-1 text-[11px]">
              <li className="flex items-center justify-between gap-1.5 text-[#a3a3a3] border-b border-white/[0.06] py-1">
                <span className="flex items-center gap-1 text-white/60 shrink-0">
                  <Film className="w-3 h-3 text-[#E50914]" />
                  التصنيف
                </span>
                <span className="font-semibold text-white truncate max-w-[95px]">
                  {primaryCat}
                </span>
              </li>
              <li className="flex items-center justify-between gap-1.5 text-[#a3a3a3] border-b border-white/[0.06] py-1">
                <span className="flex items-center gap-1 text-white/60 shrink-0">
                  <Tag className="w-3 h-3 text-[#E50914]" />
                  النوع
                </span>
                <span className="font-semibold text-white truncate max-w-[95px]">
                  {genresText}
                </span>
              </li>
              <li className="flex items-center justify-between gap-1.5 text-[#a3a3a3] border-b border-white/[0.06] py-1">
                <span className="flex items-center gap-1 text-white/60 shrink-0">
                  <Globe className="w-3 h-3 text-[#E50914]" />
                  البلد
                </span>
                <span className="font-semibold text-white truncate max-w-[95px]">
                  {item.country || 'غير محدد'}
                </span>
              </li>
              <li className="flex items-center justify-between gap-1.5 text-[#a3a3a3] py-1">
                <span className="flex items-center gap-1 text-white/60 shrink-0">
                  <Languages className="w-3 h-3 text-[#E50914]" />
                  اللغة
                </span>
                <span className="font-semibold text-white truncate max-w-[95px]">
                  {item.language || 'مترجم'}
                </span>
              </li>
            </ul>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onSelect(item, false)}
              className="inline-flex items-center justify-center gap-1 rounded-xl bg-[#E50914] hover:bg-[#f40612] px-2 py-2 text-[11px] font-extrabold text-white transition-colors shadow-md cursor-pointer"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>مشاهدة</span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(item, true);
              }}
              className="inline-flex items-center justify-center gap-1 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] px-2 py-2 text-[11px] font-extrabold text-white transition-colors shadow-md cursor-pointer"
            >
              <Download className="w-3 h-3" />
              <span>تحميل</span>
            </button>
          </div>
        </div>
      </article>
    );
  }

  /* Default: Modern Clean Dark Card (Netflix / YouTube inspired, zero clutter) */
  return (
    <article className="group relative flex flex-col rounded-2xl bg-[#181818] border border-white/[0.07] overflow-hidden transition-all duration-300 ease-out hover:-translate-y-1 hover:border-white/20 hover:bg-[#202020] hover:shadow-[0_20px_42px_rgba(0,0,0,0.72)]">
      {/* Poster Container */}
      <div
        onClick={() => onSelect(item)}
        className="relative aspect-[2/3] w-full overflow-hidden bg-[#121212] cursor-pointer"
      >
        <img
          src={getPosterUrl(item)}
          srcSet={buildPosterSrcSet(getPosterUrl(item))}
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 280px"
          alt={item.title}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={handlePosterError}
          className="h-full w-full object-cover object-top transition-transform duration-500 ease-out group-hover:scale-105"
        />

        {/* Measured Contrast Scrim */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-transparent to-black/45 opacity-90" />

        {/* Subtle Top-Right IMDb & Community Rating */}
        <div className="absolute top-2.5 right-2.5 z-10 flex flex-col items-end gap-1">
          <div className="inline-flex items-center gap-1 rounded-lg bg-black/70 backdrop-blur-md px-2 py-0.5 text-[11px] font-bold text-white border border-white/10">
            <Star className="w-3 h-3 text-[#f9c400] fill-[#f9c400]" />
            <span className="font-latin tabular-nums">{safeImdb}</span>
          </div>
          {item.communityRating && item.communityRating.count > 0 && (
            <div className="inline-flex items-center gap-1 rounded-lg bg-[#0c1821]/85 backdrop-blur-md px-2 py-0.5 text-[10px] font-extrabold text-[#4CAF50] border border-[#4CAF50]/40">
              <Star className="w-2.5 h-2.5 text-[#f9c400] fill-[#f9c400]" />
              <span className="font-latin tabular-nums">
                {item.communityRating.average.toFixed(1)}/5
              </span>
            </div>
          )}
        </div>

        {/* Top-Left Watchlist Quick Action */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleWatchlist(item);
          }}
          aria-label={isInWatchlist ? 'إزالة من قائمتي' : 'إضافة إلى قائمتي'}
          className={`absolute top-2.5 left-2.5 z-10 inline-flex h-8 w-8 items-center justify-center rounded-lg backdrop-blur-md border transition-all cursor-pointer ${
            isInWatchlist
              ? 'bg-[#E50914] border-[#E50914] text-white opacity-100'
              : 'bg-black/65 border-white/15 text-white/80 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-[#E50914] hover:border-[#E50914] hover:text-white'
          }`}
        >
          {isInWatchlist ? <Check className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
        </button>

        {/* Center Hover Play Button */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#E50914]/95 text-white shadow-[0_8px_24px_rgba(229,9,20,0.5)] scale-90 opacity-0 transition-all duration-200 group-hover:scale-100 group-hover:opacity-100">
            <Play className="w-5 h-5 fill-current mr-[-2px]" />
          </div>
        </div>
      </div>

      {/* Clean Card Footer (Unboxed Metadata) */}
      <div
        onClick={() => onSelect(item)}
        className="flex flex-1 flex-col justify-between p-3 text-right cursor-pointer"
      >
        <h3
          style={{ fontSize: 'var(--rtv-card-title-size, 13px)' }}
          className="font-display font-bold text-white leading-snug line-clamp-1 group-hover:text-[#E50914] transition-colors"
        >
          {item.title}
        </h3>
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[#a3a3a3] truncate tabular-nums">
          <span>{item.year || '2026'}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{primaryCat}</span>
          <span aria-hidden="true">·</span>
          <span className="font-latin text-white/80 shrink-0">{item.quality || 'HD'}</span>
        </div>
      </div>
    </article>
  );
}
