import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Film,
  Search,
  X,
} from 'lucide-react';
import { MediaItem } from '../../types/media';
import { AdminNavItem, AdminTab } from './adminNavigation';

/* ---------------- Reusable MetricCard ---------------- */
interface MetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  icon?: ReactNode;
  accentClass?: string;
}

export function MetricCard({
  label,
  value,
  subtext,
  icon,
  accentClass = 'text-[#b7c9ef]',
}: MetricCardProps) {
  return (
    <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-5">
      <div className="flex items-center justify-between gap-2 text-xs text-[#b7c9ef] mb-2">
        <span className="font-bold truncate">{label}</span>
        {icon && <span className="shrink-0">{icon}</span>}
      </div>
      <p className="text-2xl sm:text-3xl font-black text-white tabular-nums">{value}</p>
      {subtext && <p className={`text-[11px] mt-1 font-bold ${accentClass}`}>{subtext}</p>}
    </div>
  );
}

/* ---------------- Reusable EmptyState ---------------- */
interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 bg-[#1a242e]/35 py-12 px-5 text-center space-y-3">
      {icon && <div className="mx-auto flex justify-center text-[#b7c9ef]/45">{icon}</div>}
      <p className="text-sm font-extrabold text-white">{title}</p>
      {description && <p className="text-xs text-[#b7c9ef] max-w-md mx-auto leading-relaxed">{description}</p>}
      {action && <div className="pt-1 flex justify-center">{action}</div>}
    </div>
  );
}

/* ---------------- Reusable Accessible ConfirmDialog ---------------- */
interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel,
  cancelLabel = 'إلغاء',
  busy = false,
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => {
      cancelBtnRef.current?.focus();
    }, 10);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      if (prevFocus && document.body.contains(prevFocus)) {
        prevFocus.focus();
      }
    };
  }, [isOpen, busy, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-rtv-focus-trap="true"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
    >
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div className="relative z-10 w-full max-w-md rounded-3xl bg-[#0c1821] border border-white/15 p-6 text-center space-y-4 shadow-2xl">
        <div
          className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl ${
            danger ? 'bg-[#D92321]/20 text-[#D92321]' : 'bg-[#f9c400]/20 text-[#f9c400]'
          }`}
        >
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h3 className="font-display text-base font-extrabold text-white">{title}</h3>
        <p className="text-xs text-[#b7c9ef] leading-relaxed">{description}</p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            ref={cancelBtnRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-xl bg-[#1a242e] hover:bg-white/10 px-5 py-2.5 text-xs font-bold text-white cursor-pointer whitespace-nowrap shrink-0"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`rounded-xl px-5 py-2.5 text-xs font-extrabold text-white shadow-lg cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50 ${
              danger ? 'bg-[#D92321] hover:bg-[#dc0e30]' : 'bg-[#4CAF50] hover:bg-[#43a047]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Reusable Pagination Footer ---------------- */
interface TablePaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: 15 | 30 | 50 | 100) => void;
}

export function TablePagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
}: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIdx = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const endIdx = Math.min(totalItems, safePage * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/[0.08] text-xs">
      <div className="flex items-center gap-3 text-[#b7c9ef] tabular-nums">
        <span>
          عرض <strong className="text-white">{startIdx}</strong> –{' '}
          <strong className="text-white">{endIdx}</strong> من أصل{' '}
          <strong className="text-white">{totalItems}</strong>
        </span>
        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value) as 15 | 30 | 50 | 100)}
            aria-label="عدد العناصر في الصفحة"
            className="rounded-lg bg-[#1a242e] border border-white/10 px-2.5 py-1 text-xs font-bold text-white cursor-pointer"
          >
            <option value={15}>15 / صفحة</option>
            <option value={30}>30 / صفحة</option>
            <option value={50}>50 / صفحة</option>
            <option value={100}>100 / صفحة</option>
          </select>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          aria-label="الصفحة السابقة"
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#1a242e] border border-white/10 px-2.5 text-xs font-bold text-white hover:bg-white/10 disabled:opacity-35 cursor-pointer whitespace-nowrap shrink-0"
        >
          <ChevronRight className="w-3.5 h-3.5" />
          <span>السابق</span>
        </button>
        <span className="px-2.5 text-xs font-black text-[#f9c400] tabular-nums">
          {safePage} / {totalPages}
        </span>
        <button
          type="button"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          aria-label="الصفحة التالية"
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#1a242e] border border-white/10 px-2.5 text-xs font-bold text-white hover:bg-white/10 disabled:opacity-35 cursor-pointer whitespace-nowrap shrink-0"
        >
          <span>التالي</span>
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ---------------- Global Command Palette (Cmd/Ctrl + K) ---------------- */
interface GlobalCommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  accessibleItems: AdminNavItem[];
  catalog: MediaItem[];
  onNavigateTab: (tab: AdminTab) => void;
  onEditMedia: (item: MediaItem) => void;
}

export function GlobalCommandPalette({
  isOpen,
  onClose,
  accessibleItems,
  catalog,
  onNavigateTab,
  onEditMedia,
}: GlobalCommandPaletteProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    const prevFocus = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => inputRef.current?.focus(), 15);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      if (prevFocus && document.body.contains(prevFocus)) {
        prevFocus.focus();
      }
    };
  }, [isOpen, onClose]);

  const normalizedQuery = query.trim().toLowerCase();

  const matchedNav = useMemo(() => {
    if (!normalizedQuery) return accessibleItems.slice(0, 8);
    return accessibleItems.filter(
      (item) =>
        item.label.toLowerCase().includes(normalizedQuery) ||
        item.shortLabel.toLowerCase().includes(normalizedQuery) ||
        item.description.toLowerCase().includes(normalizedQuery) ||
        item.keywords.some((k) => k.toLowerCase().includes(normalizedQuery))
    );
  }, [accessibleItems, normalizedQuery]);

  const matchedMedia = useMemo(() => {
    if (!normalizedQuery) return [];
    return catalog
      .filter(
        (m) =>
          m.title.toLowerCase().includes(normalizedQuery) ||
          m.englishTitle.toLowerCase().includes(normalizedQuery) ||
          String(m.year).includes(normalizedQuery)
      )
      .slice(0, 6);
  }, [catalog, normalizedQuery]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="البحث السريع في لوحة الإدارة"
      data-rtv-focus-trap="true"
      className="fixed inset-0 z-[75] flex items-start justify-center pt-[10vh] p-4"
    >
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl rounded-3xl bg-[#0c1821] border border-white/15 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 border-b border-white/10 bg-[#1a242e] px-4 py-3.5">
          <Search className="w-4 h-4 text-[#f9c400] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث عن قسم، أداة، إعداد، أو اسم فيلم / مسلسل للانتقال السريع..."
            className="flex-1 bg-transparent text-sm font-bold text-white placeholder:text-[#b7c9ef]/50 focus:outline-none"
          />
          <span className="hidden sm:inline-flex rounded bg-[#0c1821] border border-white/10 px-2 py-0.5 font-latin text-[10px] font-bold text-[#b7c9ef]">
            ESC
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق البحث السريع"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-white hover:bg-[#D92321] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-4 space-y-4">
          {matchedNav.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-extrabold text-[#b7c9ef] px-1">
                الأقسام والأدوات ({matchedNav.length})
              </p>
              <div className="space-y-1">
                {matchedNav.map((nav) => (
                  <button
                    key={nav.id}
                    type="button"
                    onClick={() => {
                      onNavigateTab(nav.id);
                      onClose();
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-xl bg-[#1a242e]/60 hover:bg-[#D92321] border border-white/[0.06] px-3.5 py-2.5 text-right transition-colors cursor-pointer group"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold text-white truncate">{nav.label}</p>
                      <p className="text-[11px] text-[#b7c9ef] group-hover:text-white/85 truncate">
                        {nav.description}
                      </p>
                    </div>
                    <ArrowLeft className="w-4 h-4 text-[#b7c9ef] group-hover:text-white shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {matchedMedia.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-white/10">
              <p className="text-[11px] font-extrabold text-[#f9c400] px-1">
                أعمال في الكتالوج ({matchedMedia.length})
              </p>
              <div className="space-y-1">
                {matchedMedia.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      onEditMedia(m);
                      onClose();
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-xl bg-[#1a242e]/60 hover:bg-sky-500/20 border border-white/[0.06] px-3.5 py-2.5 text-right transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Film className="w-4 h-4 text-[#f9c400] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-extrabold text-white truncate">{m.title}</p>
                        <p className="text-[10px] text-[#b7c9ef] truncate">
                          {m.year} • {m.quality} • {m.servers?.length || 0} سيرفر
                        </p>
                      </div>
                    </div>
                    <span className="text-[11px] font-bold text-sky-300 shrink-0">فتح في المحرر</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {matchedNav.length === 0 && matchedMedia.length === 0 && (
            <EmptyState
              icon={<Search className="w-9 h-9" />}
              title="لا توجد نتائج مطابقة"
              description="جرّب كتابة اسم قسم (مثل السيرفرات، الأمان، الفحص، التلفاز) أو اسم عمل من المكتبة."
            />
          )}
        </div>
      </div>
    </div>
  );
}
