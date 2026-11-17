import { Bookmark, Check, Download, Film, Globe, Languages, Play, Star, Tag } from 'lucide-react';
import { FALLBACK_POSTER, handlePosterError } from '../lib/mediaFilters';
import { MediaItem } from '../types/media';

interface MovieCardProps {
  item: MediaItem;
  onSelect: (item: MediaItem, openDownloads?: boolean) => void;
  isInWatchlist: boolean;
  onToggleWatchlist: (item: MediaItem) => void;
}

export function MovieCard({ item, onSelect, isInWatchlist, onToggleWatchlist }: MovieCardProps) {
  const safeImdb = Number(item.imdb || 7.5).toFixed(1);
  const primaryCat =
    item.categories?.[1] ||
    item.categories?.[0] ||
    (item.kind === 'series' ? 'مسلسلات' : item.kind === 'wrestling' ? 'مصارعة حرة' : 'افلام');
  const genresText = item.genres?.length ? item.genres.slice(0, 2).join('، ') : 'دراما';

  return (
    <article className="moov-card moov-card-perspective group relative aspect-[2/3] w-full rounded-[20px] border-[3px] border-dashed border-white/[0.06] bg-[#0c1821] overflow-hidden shadow-lg">
      {/* Front Face (rotates away on hover in 3D) */}
      <div
        onClick={() => onSelect(item)}
        className="moov-card-front absolute inset-0 cursor-pointer overflow-hidden rounded-[17px]"
      >
        <img
          src={item.poster || FALLBACK_POSTER}
          alt={item.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={handlePosterError}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        {/* Bottom Gradient Scrim */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#06131c] via-[#06131c]/35 to-transparent" />

        {/* Top-Left Year & Quality Strip */}
        <div className="absolute top-3 left-3 flex flex-col items-start gap-1.5 z-10">
          <span className="font-latin rounded-md bg-[#D92321] px-2 py-0.5 text-[11px] font-bold text-white shadow-md">
            {item.year || '2026'}
          </span>
          <span className="font-latin rounded-md bg-white/95 px-2 py-0.5 text-[10px] font-extrabold text-[#06131c] shadow-md">
            {item.quality || 'HD'}
          </span>
        </div>

        {/* Top-Right IMDb Score */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-md bg-[#06131c]/85 px-2 py-1 text-xs font-bold backdrop-blur-sm border border-white/10">
          <Star className="w-3.5 h-3.5 text-[#f9c400] fill-[#f9c400]" />
          <span className="font-latin text-white">{safeImdb}</span>
        </div>

        {/* Bottom Title & Primary Category */}
        <div className="absolute inset-x-0 bottom-0 p-3.5 text-right">
          <p className="text-[11px] font-semibold text-[#b7c9ef] truncate mb-0.5">
            {primaryCat}
          </p>
          <h3 className="font-display text-sm sm:text-[15px] font-bold text-white leading-snug line-clamp-2">
            {item.title}
          </h3>
        </div>
      </div>

      {/* Back Face (3D RotateY reveal on hover — balanced spacing with both Watch & Download) */}
      <div className="moov-card-back absolute inset-0 flex flex-col justify-between rounded-[17px] bg-gradient-to-b from-[#1a242e] via-[#0c1821] to-[#06131c] p-3 border border-white/10 overflow-hidden">
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
              className={`inline-flex items-center justify-center w-7 h-7 rounded-lg border transition-colors cursor-pointer ${
                isInWatchlist
                  ? 'bg-[#4CAF50]/20 border-[#4CAF50] text-[#4CAF50]'
                  : 'bg-white/5 border-white/10 text-[#b7c9ef] hover:text-white hover:border-white/30'
              }`}
            >
              {isInWatchlist ? <Check className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
            </button>
          </div>

          <h3
            onClick={() => onSelect(item)}
            className="font-display text-xs sm:text-[13px] font-extrabold text-white leading-snug mb-2 cursor-pointer hover:text-[#D92321] transition-colors line-clamp-2"
          >
            {item.title}
          </h3>

          {/* Compact Metadata Rows */}
          <ul className="space-y-1 text-[11px]">
            <li className="flex items-center justify-between gap-1.5 text-[#b7c9ef] border-b border-white/[0.06] py-1">
              <span className="flex items-center gap-1 text-white/60 shrink-0">
                <Film className="w-3 h-3 text-[#D92321]" />
                التصنيف
              </span>
              <span className="font-semibold text-white truncate max-w-[95px]">
                {primaryCat}
              </span>
            </li>
            <li className="flex items-center justify-between gap-1.5 text-[#b7c9ef] border-b border-white/[0.06] py-1">
              <span className="flex items-center gap-1 text-white/60 shrink-0">
                <Tag className="w-3 h-3 text-[#D92321]" />
                النوع
              </span>
              <span className="font-semibold text-white truncate max-w-[95px]">
                {genresText}
              </span>
            </li>
            <li className="flex items-center justify-between gap-1.5 text-[#b7c9ef] border-b border-white/[0.06] py-1">
              <span className="flex items-center gap-1 text-white/60 shrink-0">
                <Globe className="w-3 h-3 text-[#D92321]" />
                البلد
              </span>
              <span className="font-semibold text-white truncate max-w-[95px]">{item.country || 'غير محدد'}</span>
            </li>
            <li className="flex items-center justify-between gap-1.5 text-[#b7c9ef] py-1">
              <span className="flex items-center gap-1 text-white/60 shrink-0">
                <Languages className="w-3 h-3 text-[#D92321]" />
                اللغة
              </span>
              <span className="font-semibold text-white truncate max-w-[95px]">{item.language || 'مترجم'}</span>
            </li>
          </ul>
        </div>

        {/* Dual Action Buttons: Watch + Download */}
        <div className="mt-2 grid grid-cols-2 gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onSelect(item, false)}
            className="inline-flex items-center justify-center gap-1 rounded-xl bg-[#D92321] hover:bg-[#dc0e30] px-2 py-2 text-[11px] font-extrabold text-white transition-colors shadow-md cursor-pointer"
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
