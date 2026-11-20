import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Search, Star, User as UserIcon, X } from 'lucide-react';
import {
  buildSearchSuggestions,
  handlePosterError,
  matchesCategoryFilter,
  normalizeArabicText,
} from '../lib/mediaFilters';
import { getPosterUrl } from '../lib/mediaImages';
import { MediaItem } from '../types/media';

interface SearchDrawerProps {
  catalog: MediaItem[];
  isOpen: boolean;
  onClose: () => void;
  onSelectMedia: (item: MediaItem) => void;
  onViewAllResults: (query: string, category: string) => void;
}

const SEARCH_CATS = [
  { label: 'الكل', value: '' },
  { label: 'الأفلام', value: 'افلام' },
  { label: 'المسلسلات', value: 'مسلسلات' },
  { label: 'رمضان 2026', value: 'رمضان 2026' },
  { label: 'مصارعة حرة', value: 'مصارعة حرة' },
  { label: 'عروض تلفزيونية', value: 'عروض تلفزيونية' },
];

export function SearchDrawer({
  catalog,
  isOpen,
  onClose,
  onSelectMedia,
  onViewAllResults,
}: SearchDrawerProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [category, setCategory] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === 'function') {
        window.setTimeout(() => prev.focus(), 0);
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setIsSearching(true);
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setIsSearching(false);
    }, 180);
    return () => clearTimeout(timer);
  }, [query, category, isOpen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const suggestions = useMemo(
    () => buildSearchSuggestions(catalog, query, 8),
    [catalog, query]
  );

  const results = useMemo(() => {
    const q = normalizeArabicText(debouncedQuery);
    return catalog.filter((item) => {
      if (category && !matchesCategoryFilter(item, category)) return false;
      if (!q) return true;
      return (
        normalizeArabicText(item.title).includes(q) ||
        normalizeArabicText(item.englishTitle).includes(q) ||
        normalizeArabicText(item.director || '').includes(q) ||
        normalizeArabicText(item.writer || '').includes(q) ||
        (item.cast || []).some((c) => normalizeArabicText(c.name).includes(q)) ||
        (item.genres || []).some((g) => normalizeArabicText(g).includes(q)) ||
        normalizeArabicText(item.country).includes(q) ||
        String(item.year || '').includes(q)
      );
    });
  }, [catalog, debouncedQuery, category]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="البحث السريع في RahaL TV"
      data-rtv-focus-trap="true"
      className="fixed inset-0 z-50 flex justify-end"
    >
      {/* Blurred Dark Backdrop */}
      <div
        className="fixed inset-0 bg-[#06131c]/80 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Left-anchored Slide-Over Panel (800px max width matching .search drawer) */}
      <div className="relative z-10 flex h-full w-full max-w-[800px] flex-col bg-[#0c1821] border-r border-white/10 shadow-2xl">
        {/* Top Search Bar Header */}
        <div className="border-b border-white/10 bg-[#1a242e] px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-3.5 sm:mb-4">
            <div className="min-w-0">
              <h2 className="font-display text-base sm:text-lg font-extrabold text-white truncate">البحث السريع في RahaL TV</h2>
              <p className="text-[11px] sm:text-xs text-[#b7c9ef]">ابحث باسم الفيلم أو المسلسل أو الممثل أو المخرج أو السنة</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق نافذة البحث"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-white hover:bg-[#D92321] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#D92321] absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="أبحث عن فيلم أو مسلسل أو مخرج أو ممثل..."
                className="w-full min-h-[46px] rounded-xl bg-[#06131c] border border-white/10 pr-11 pl-4 py-3 text-sm font-semibold text-white placeholder:text-[#b7c9ef]/50 focus:border-[#D92321] focus:outline-none"
              />
            </div>

            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="تصفية البحث حسب القسم"
              className="min-h-[46px] rounded-xl bg-[#06131c] border border-white/10 px-4 py-3 text-sm font-bold text-white focus:border-[#D92321] focus:outline-none cursor-pointer"
            >
              {SEARCH_CATS.map((cat) => (
                <option key={cat.label} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          {suggestions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {suggestions.map((sug, idx) => (
                <button
                  key={`${sug.type}-${sug.label}-${idx}`}
                  type="button"
                  onClick={() => {
                    if (sug.type === 'media' && sug.mediaId) {
                      const target = catalog.find((m) => m.id === sug.mediaId);
                      if (target) {
                        onSelectMedia(target);
                        onClose();
                        return;
                      }
                    }
                    setQuery(sug.label);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#06131c] border border-white/10 hover:border-[#D92321] px-2.5 py-1 text-[11px] font-bold text-white transition-colors cursor-pointer"
                >
                  {sug.type === 'person' ? (
                    <UserIcon className="w-3 h-3 text-[#f9c400]" />
                  ) : (
                    <Search className="w-3 h-3 text-[#D92321]" />
                  )}
                  <span className="truncate max-w-[180px]">{sug.label}</span>
                  <span className="text-[10px] text-[#b7c9ef] truncate max-w-[100px]">• {sug.sublabel}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Results Grid */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between gap-2 mb-3.5 sm:mb-4">
            <span className="text-xs font-bold text-[#b7c9ef]">
              {isSearching ? (
                <span className="inline-flex items-center gap-2 text-white">
                  <Loader2 className="w-4 h-4 animate-spin text-[#D92321]" />
                  جاري جلب النتائج...
                </span>
              ) : (
                `تم العثور على ${results.length} عمل`
              )}
            </span>

            {results.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onViewAllResults(debouncedQuery, category);
                  onClose();
                }}
                className="inline-flex min-h-[38px] items-center gap-1.5 text-xs font-extrabold text-[#D92321] hover:text-white transition-colors cursor-pointer"
              >
                <span>عرض كل النتائج ({results.length})</span>
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {results.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[#06131c]/60 py-16 text-center px-6">
              <Search className="w-10 h-10 text-[#b7c9ef]/40 mb-3" />
              <p className="text-base font-bold text-white mb-1">لا توجد نتائج مطابقة لبحثك</p>
              <p className="text-xs text-[#b7c9ef]">جرّب كتابة كلمة مختلفة أو تغيير القسم المختار</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {results.slice(0, 16).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectMedia(item);
                    onClose();
                  }}
                  className="group flex items-center gap-3.5 rounded-2xl bg-[#1a242e]/80 border border-white/[0.07] p-2.5 text-right hover:border-[#D92321]/60 hover:bg-[#1a242e] transition-all cursor-pointer"
                >
                  <img
                    src={getPosterUrl(item)}
                    alt={item.title}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={handlePosterError}
                    className="h-24 w-18 rounded-xl object-cover object-top shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-latin rounded bg-[#D92321] px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {item.year}
                      </span>
                      <span className="font-latin rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {item.quality}
                      </span>
                      {item.communityRating && item.communityRating.count > 0 && (
                        <span className="font-latin inline-flex items-center gap-1 text-[11px] font-bold text-[#f9c400]">
                          <Star className="w-3 h-3 fill-[#f9c400]" />
                          <span dir="ltr">{item.communityRating.average.toFixed(1)}/5</span>
                        </span>
                      )}
                    </div>
                    <h3 className="font-display text-sm font-bold text-white group-hover:text-[#D92321] transition-colors truncate">
                      {item.title}
                    </h3>
                    <p className="text-[11px] text-[#b7c9ef] truncate mt-1">
                      {(item.genres || []).join(' • ')} — {item.country || ''}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
