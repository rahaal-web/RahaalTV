import { useMemo, useState } from 'react';
import {
  ArrowDownUp,
  Columns3,
  Edit3,
  Eye,
  Globe,
  Layers,
  Loader2,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
} from 'lucide-react';
import {
  CatalogColumnKey,
  CatalogSortField,
  CatalogTablePrefs,
} from '../../lib/adminPreferences';
import { findDuplicateGroups } from '../../lib/contentAudit';
import { getPosterUrl } from '../../lib/mediaImages';
import { MediaItem, MediaKind } from '../../types/media';
import type { AdminTab } from './adminNavigation';
import { ConfirmDialog, TablePagination } from './AdminSharedUi';

export interface CatalogServerStatusEntry {
  status: 'checking' | 'working' | 'warning' | 'broken';
  httpStatus?: number;
  label: string;
  detail?: string;
}

interface AdminCatalogPanelProps {
  catalog: MediaItem[];
  filteredCatalog: MediaItem[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  kindFilter: string;
  onKindFilterChange: (k: string) => void;
  selectedMediaIds: string[];
  onToggleSelection: (id: string) => void;
  onSelectFiltered: () => void;
  onSelectAllCatalog: () => void;
  onClearSelection: () => void;
  onSetSelectedIds: (next: string[]) => void;
  tablePrefs: CatalogTablePrefs;
  onUpdateTablePrefs: (patch: Partial<CatalogTablePrefs>) => void;
  serverStatuses: Record<string, CatalogServerStatusEntry>;
  checkingCatalogLinks: boolean;
  onCheckCatalogLinks: () => void;
  onCheckItemServers: (urls: string[]) => void;
  resolveWatchServerUrl: (srv?: {
    mode?: 'url' | 'embed';
    url?: string;
    embedCode?: string;
    watchUrl?: string;
  }) => string;
  isOwner: boolean;
  isFirestoreSeeded: boolean;
  hasDismissedStarters: boolean;
  busyAction: boolean;
  onSeedDatabase: () => void;
  onRestoreStarterItems: () => void;
  onOpenNewMedia: () => void;
  onOpenBulkDelete: (mode: 'selected' | 'all') => void;
  onTogglePin: (item: MediaItem) => void;
  onPreviewMedia: (item: MediaItem) => void;
  onEditMedia: (item: MediaItem) => void;
  onRequestDeleteMedia: (id: string) => void;
  onNavigateTab: (tab: AdminTab) => void;
  onNotify: (msg: string) => void;
  onDeleteDuplicateIds?: (ids: string[]) => Promise<void> | void;
  refreshingRatings?: boolean;
  ratingsProgress?: { done: number; total: number } | null;
  default78Count?: number;
  onRefreshRatings?: (mode: '7.8' | 'all' | 'selected') => void;
}

const KIND_LABELS: Record<MediaKind, string> = {
  movie: 'فيلم',
  series: 'مسلسل',
  tv: 'برنامج / مسرحية',
  wrestling: 'مصارعة حرة',
};

const COLUMN_LABELS: Record<CatalogColumnKey, string> = {
  poster: 'البوستر',
  title: 'العمل',
  type: 'النوع',
  category: 'القسم',
  year: 'السنة',
  rating: 'IMDb',
  views: 'المشاهدات',
  servers: 'السيرفرات / التحميل',
  flags: 'الحالة / التثبيت',
};

export function AdminCatalogPanel({
  catalog,
  filteredCatalog,
  searchQuery,
  onSearchChange,
  kindFilter,
  onKindFilterChange,
  selectedMediaIds,
  onToggleSelection,
  onSelectFiltered,
  onSelectAllCatalog,
  onClearSelection,
  onSetSelectedIds,
  tablePrefs,
  onUpdateTablePrefs,
  serverStatuses,
  checkingCatalogLinks,
  onCheckCatalogLinks,
  onCheckItemServers,
  resolveWatchServerUrl,
  isOwner,
  isFirestoreSeeded,
  hasDismissedStarters,
  busyAction,
  onSeedDatabase,
  onRestoreStarterItems,
  onOpenNewMedia,
  onOpenBulkDelete,
  onTogglePin,
  onPreviewMedia,
  onEditMedia,
  onRequestDeleteMedia,
  onNavigateTab,
  onNotify,
  onDeleteDuplicateIds,
  refreshingRatings = false,
  ratingsProgress = null,
  default78Count = 0,
  onRefreshRatings,
}: AdminCatalogPanelProps) {
  const [page, setPage] = useState(1);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [confirmDeleteDuplicates, setConfirmDeleteDuplicates] = useState(false);

  const duplicateAnalysis = useMemo(() => {
    const groups = findDuplicateGroups(catalog);
    const allIds = new Set<string>();
    const extraIds: string[] = [];
    for (const group of groups) {
      for (const item of group.items) allIds.add(item.id);
      extraIds.push(...group.extraIds);
    }
    return { groups, allIds, extraIds };
  }, [catalog]);

  const effectiveCatalog = useMemo(() => {
    if (!duplicatesOnly) return filteredCatalog;
    return filteredCatalog.filter((item) => duplicateAnalysis.allIds.has(item.id));
  }, [filteredCatalog, duplicatesOnly, duplicateAnalysis.allIds]);

  const sortedItems = useMemo(() => {
    const dir = tablePrefs.sortDir === 'asc' ? 1 : -1;
    return [...effectiveCatalog].sort((a, b) => {
      if (duplicatesOnly) {
        const titleCmp = a.title.localeCompare(b.title, 'ar');
        if (titleCmp !== 0) return titleCmp;
      }
      switch (tablePrefs.sortBy) {
        case 'title':
          return a.title.localeCompare(b.title, 'ar') * dir;
        case 'rating':
          return ((a.imdb || 0) - (b.imdb || 0)) * dir;
        case 'views':
          return ((a.views || 0) - (b.views || 0)) * dir;
        case 'year':
          return (Number(a.year || 0) - Number(b.year || 0)) * dir;
        case 'createdAt':
        default: {
          const idxA = catalog.indexOf(a);
          const idxB = catalog.indexOf(b);
          return dir === -1 ? idxA - idxB : idxB - idxA;
        }
      }
    });
  }, [effectiveCatalog, catalog, tablePrefs.sortBy, tablePrefs.sortDir, duplicatesOnly]);

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / tablePrefs.pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pagedItems = useMemo(() => {
    const start = (safePage - 1) * tablePrefs.pageSize;
    return sortedItems.slice(start, start + tablePrefs.pageSize);
  }, [sortedItems, safePage, tablePrefs.pageSize]);

  const cols = tablePrefs.visibleColumns;

  const toggleColumn = (key: CatalogColumnKey) => {
    onUpdateTablePrefs({
      visibleColumns: {
        ...cols,
        [key]: !cols[key],
      },
    });
  };

  return (
    <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-5">
      {/* Search, Filter & Primary Actions */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-[#D92321] absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              onSearchChange(e.target.value);
              setPage(1);
            }}
            placeholder="ابحث باسم الفيلم أو المسلسل أو السنة..."
            className="w-full rounded-xl bg-[#1a242e] border border-white/10 pr-10 pl-4 py-2.5 text-xs font-bold text-white focus:border-[#D92321] focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={kindFilter}
            onChange={(e) => {
              onKindFilterChange(e.target.value);
              setPage(1);
            }}
            aria-label="تصفية حسب النوع"
            className="rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2.5 text-xs font-bold text-white focus:outline-none cursor-pointer"
          >
            <option value="all">كل الأنواع</option>
            <option value="movie">أفلام</option>
            <option value="series">مسلسلات</option>
            <option value="tv">برامج ومسرحيات</option>
            <option value="wrestling">مصارعة حرة</option>
          </select>

          {/* Sort Select */}
          <div className="inline-flex items-center gap-1 rounded-xl bg-[#1a242e] border border-white/10 px-2.5 py-1.5">
            <ArrowDownUp className="w-3.5 h-3.5 text-[#f9c400]" />
            <select
              value={`${tablePrefs.sortBy}:${tablePrefs.sortDir}`}
              onChange={(e) => {
                const [sortBy, sortDir] = e.target.value.split(':') as [
                  CatalogSortField,
                  'asc' | 'desc',
                ];
                onUpdateTablePrefs({ sortBy, sortDir });
                setPage(1);
              }}
              aria-label="فرز الجدول"
              className="bg-transparent text-xs font-bold text-white focus:outline-none cursor-pointer"
            >
              <option value="createdAt:desc" className="bg-[#0c1821]">الأحدث أولاً</option>
              <option value="views:desc" className="bg-[#0c1821]">الأكثر مشاهدة</option>
              <option value="rating:desc" className="bg-[#0c1821]">الأعلى تقييماً</option>
              <option value="year:desc" className="bg-[#0c1821]">سنة الإصدار (الأحدث)</option>
              <option value="title:asc" className="bg-[#0c1821]">الاسم (أ - ي)</option>
            </select>
          </div>

          {/* Column Visibility Menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowColumnMenu((s) => !s)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3 py-2.5 text-xs font-bold text-white cursor-pointer whitespace-nowrap shrink-0"
            >
              <Columns3 className="w-3.5 h-3.5 text-[#b7c9ef]" />
              <span>الأعمدة</span>
            </button>
            {showColumnMenu && (
              <div className="absolute left-0 mt-2 w-52 rounded-2xl bg-[#0c1821] border border-white/15 p-3 shadow-2xl z-30 space-y-1.5">
                <p className="text-[11px] font-extrabold text-[#f9c400] pb-1 border-b border-white/10">
                  إظهار وإخفاء الأعمدة
                </p>
                {(Object.keys(COLUMN_LABELS) as CatalogColumnKey[]).map((key) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-white/5 text-xs font-bold text-white cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(cols[key])}
                      onChange={() => toggleColumn(key)}
                      className="h-3.5 w-3.5 accent-[#D92321]"
                    />
                    <span>{COLUMN_LABELS[key]}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={checkingCatalogLinks || filteredCatalog.length === 0}
            onClick={onCheckCatalogLinks}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-sky-500/20 border border-sky-400/30 disabled:opacity-40 px-3.5 py-2.5 text-xs font-extrabold text-sky-300 cursor-pointer whitespace-nowrap shrink-0"
          >
            {checkingCatalogLinks ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>فحص السيرفرات</span>
          </button>

          {onRefreshRatings && (
            <button
              type="button"
              disabled={refreshingRatings || catalog.length === 0}
              onClick={() =>
                onRefreshRatings(
                  selectedMediaIds.length > 0
                    ? 'selected'
                    : default78Count > 0
                      ? '7.8'
                      : 'all'
                )
              }
              title={
                selectedMediaIds.length > 0
                  ? 'جلب التقييم الحقيقي من IMDb/TMDb للأعمال المحددة'
                  : default78Count > 0
                    ? `جلب التقييم الحقيقي للأعمال ذات التقييم الافتراضي 7.8 (${default78Count})`
                    : 'تحديث جميع التقييمات من IMDb/TMDb'
              }
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-[#f9c400]/20 border border-[#f9c400]/35 disabled:opacity-40 px-3.5 py-2.5 text-xs font-extrabold text-[#f9c400] cursor-pointer whitespace-nowrap shrink-0"
            >
              {refreshingRatings ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Star className="w-3.5 h-3.5" />
              )}
              <span>
                {refreshingRatings && ratingsProgress
                  ? `جلب التقييمات (${ratingsProgress.done}/${ratingsProgress.total})`
                  : selectedMediaIds.length > 0
                    ? `تقييم المحدد (${selectedMediaIds.length})`
                    : default78Count > 0
                      ? `تحديث التقييمات (IMDb/TMDb • ${default78Count})`
                      : 'تحديث التقييمات (IMDb/TMDb)'}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setDuplicatesOnly((prev) => !prev);
              setPage(1);
            }}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-xs font-extrabold cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
              duplicatesOnly
                ? 'bg-[#f9c400] border-[#f9c400] text-[#06131c]'
                : 'bg-[#1a242e] hover:bg-[#f9c400]/15 border-[#f9c400]/35 text-[#f9c400]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>المكرر ({duplicateAnalysis.allIds.size})</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab('bulk_editor')}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3.5 py-2.5 text-xs font-extrabold text-white cursor-pointer whitespace-nowrap shrink-0"
          >
            <Layers className="w-3.5 h-3.5 text-[#f9c400]" />
            <span>التعديل الجماعي</span>
          </button>

          <button
            type="button"
            onClick={onOpenNewMedia}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#D92321] hover:bg-[#dc0e30] px-4 py-2.5 text-xs font-extrabold text-white cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة عمل</span>
          </button>

          {isOwner && !isFirestoreSeeded && catalog.length > 0 && (
            <button
              type="button"
              disabled={busyAction}
              onClick={onSeedDatabase}
              className="rounded-xl bg-[#4CAF50] hover:bg-[#43a047] px-3.5 py-2.5 text-xs font-extrabold text-white cursor-pointer whitespace-nowrap shrink-0"
            >
              استيراد المبدئي لـ Firestore
            </button>
          )}
        </div>
      </div>

      {/* Bulk Selection Toolbar */}
      {effectiveCatalog.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#1a242e]/75 border border-white/10 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (duplicatesOnly) {
                  onSetSelectedIds(
                    Array.from(new Set([...selectedMediaIds, ...effectiveCatalog.map((i) => i.id)]))
                  );
                } else {
                  onSelectFiltered();
                }
              }}
              className="rounded-xl bg-[#0c1821] hover:bg-white/10 border border-white/10 px-3 py-1.5 text-xs font-bold text-white cursor-pointer whitespace-nowrap shrink-0"
            >
              تحديد المعروض ({effectiveCatalog.length})
            </button>

            {duplicateAnalysis.extraIds.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onSetSelectedIds(duplicateAnalysis.extraIds);
                    setDuplicatesOnly(true);
                    setPage(1);
                    onNotify(
                      `تم تحديد ${duplicateAnalysis.extraIds.length} نسخة مكررة مع الإبقاء على النسخة الأفضل لكل عمل`
                    );
                  }}
                  className="rounded-xl bg-[#f9c400]/15 hover:bg-[#f9c400]/25 border border-[#f9c400]/45 px-3 py-1.5 text-xs font-extrabold text-[#f9c400] cursor-pointer whitespace-nowrap shrink-0"
                >
                  تحديد النسخ المكررة ({duplicateAnalysis.extraIds.length})
                </button>
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => setConfirmDeleteDuplicates(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#D92321]/20 hover:bg-[#D92321] border border-[#D92321]/50 disabled:opacity-40 px-3 py-1.5 text-xs font-extrabold text-[#ff9f9d] hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>حذف المحتوى المكرر ({duplicateAnalysis.extraIds.length})</span>
                </button>
              </>
            )}

            {catalog.length > effectiveCatalog.length && (
              <button
                type="button"
                onClick={onSelectAllCatalog}
                className="rounded-xl bg-[#0c1821] hover:bg-white/10 border border-white/10 px-3 py-1.5 text-xs font-bold text-[#f9c400] cursor-pointer whitespace-nowrap shrink-0"
              >
                تحديد كل المكتبة ({catalog.length})
              </button>
            )}

            {selectedMediaIds.length > 0 && (
              <button
                type="button"
                onClick={onClearSelection}
                className="rounded-xl bg-[#0c1821] hover:bg-white/10 border border-white/10 px-3 py-1.5 text-xs font-bold text-[#b7c9ef] cursor-pointer whitespace-nowrap shrink-0"
              >
                إلغاء التحديد
              </button>
            )}

            <span className="rounded-lg bg-[#0c1821] px-2.5 py-1 text-[11px] font-extrabold text-[#b7c9ef] tabular-nums">
              المحدد: <strong className="text-white">{selectedMediaIds.length}</strong>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busyAction || selectedMediaIds.length === 0}
              onClick={() => onOpenBulkDelete('selected')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#D92321] hover:bg-[#dc0e30] disabled:opacity-40 px-3.5 py-1.5 text-xs font-extrabold text-white cursor-pointer whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>حذف المحدد ({selectedMediaIds.length})</span>
            </button>
            {isOwner && (
              <button
                type="button"
                disabled={busyAction || catalog.length === 0}
                onClick={() => onOpenBulkDelete('all')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#D92321]/15 hover:bg-[#D92321] border border-[#D92321]/50 disabled:opacity-40 px-3.5 py-1.5 text-xs font-extrabold text-[#ff8a88] hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>حذف كل المحتوى ({catalog.length})</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl bg-[#1a242e]/50 border border-dashed border-white/15 p-8 text-center space-y-3">
          <p className="text-sm font-extrabold text-white">
            {catalog.length === 0
              ? 'لا يوجد أي محتوى حاليًا في المنصة'
              : 'لا توجد نتائج تطابق بحثك الحالي'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={() => onNavigateTab('site_scraper')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#f9c400] px-4 py-2 text-xs font-black text-[#06131c] cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>جلب محتوى من موقع بالكامل</span>
            </button>
            {isOwner && !isFirestoreSeeded && hasDismissedStarters && (
              <button
                type="button"
                onClick={() => {
                  onRestoreStarterItems();
                  onNotify('تمت استعادة المحتوى الافتراضي المبدئي');
                }}
                className="rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/15 px-4 py-2 text-xs font-bold text-[#b7c9ef] cursor-pointer"
              >
                استعادة المحتوى المبدئي
              </button>
            )}
          </div>
        </div>
      )}

      {/* Paginated Catalog Table */}
      {pagedItems.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-[11px] font-extrabold text-[#b7c9ef]">
                  <th className="py-3 px-2 w-10 text-center">
                    <input
                      type="checkbox"
                      aria-label="تحديد أو إلغاء تحديد كل المعروض في الصفحة"
                      checked={
                        pagedItems.length > 0 &&
                        pagedItems.every((item) => selectedMediaIds.includes(item.id))
                      }
                      onChange={(e) => {
                        const pageIds = pagedItems.map((i) => i.id);
                        if (e.target.checked) {
                          onSetSelectedIds(Array.from(new Set([...selectedMediaIds, ...pageIds])));
                        } else {
                          const pageSet = new Set(pageIds);
                          onSetSelectedIds(selectedMediaIds.filter((id) => !pageSet.has(id)));
                        }
                      }}
                      className="h-4 w-4 accent-[#D92321] cursor-pointer"
                    />
                  </th>
                  {cols.title && <th className="py-3 px-2">العمل</th>}
                  {cols.type && <th className="py-3 px-2">النوع</th>}
                  {cols.category && <th className="py-3 px-2">القسم</th>}
                  {cols.year && <th className="py-3 px-2">السنة</th>}
                  {cols.servers && <th className="py-3 px-2">السيرفرات / التحميل</th>}
                  {cols.rating && <th className="py-3 px-2">IMDb</th>}
                  {cols.views && <th className="py-3 px-2">المشاهدات</th>}
                  {cols.flags && <th className="py-3 px-2">مثبت</th>}
                  <th className="py-3 px-2 text-left">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-xs">
                {pagedItems.map((item) => {
                  const isSelected = selectedMediaIds.includes(item.id);
                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors ${
                        isSelected ? 'bg-[#D92321]/[0.08]' : 'hover:bg-white/[0.02]'
                      }`}
                    >
                      <td className="py-3 px-2 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onToggleSelection(item.id)}
                          aria-label={`تحديد ${item.title}`}
                          className="h-4 w-4 accent-[#D92321] cursor-pointer"
                        />
                      </td>
                      {cols.title && (
                        <td className="py-3 px-2">
                          <div className="flex items-center gap-3">
                            {cols.poster && (
                              <img
                                src={getPosterUrl(item)}
                                alt={item.title}
                                loading="lazy"
                                decoding="async"
                                className="h-14 w-10 rounded-lg object-cover object-top shrink-0"
                              />
                            )}
                            <div className="min-w-0 max-w-[230px]">
                              <div className="flex items-center gap-1.5">
                                <p className="font-extrabold text-white truncate">{item.title}</p>
                                {duplicateAnalysis.allIds.has(item.id) && (
                                  <span className="shrink-0 rounded bg-[#f9c400]/20 border border-[#f9c400]/45 px-1.5 py-0.5 text-[9px] font-black text-[#f9c400]">
                                    مكرر
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-[#b7c9ef] truncate">
                                {item.quality} • {item.language || 'مترجم'}
                              </p>
                            </div>
                          </div>
                        </td>
                      )}
                      {cols.type && (
                        <td className="py-3 px-2">
                          <span className="rounded-lg bg-[#1a242e] px-2.5 py-1 text-[11px] font-bold text-[#b7c9ef] whitespace-nowrap">
                            {KIND_LABELS[item.kind]}
                          </span>
                        </td>
                      )}
                      {cols.category && (
                        <td className="py-3 px-2 text-[11px] font-bold text-[#b7c9ef] max-w-[140px] truncate">
                          {item.categories?.[0] || '—'}
                        </td>
                      )}
                      {cols.year && (
                        <td className="py-3 px-2 font-latin text-xs font-bold text-white tabular-nums">
                          {item.year || '—'}
                        </td>
                      )}
                      {cols.servers && (
                        <td className="py-3 px-2 font-bold text-[#b7c9ef] tabular-nums space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span>
                              {item.servers?.length || 0} سيرفر • {item.downloads?.length || 0} تحميل
                              {item.seasons && item.seasons.length > 0
                                ? ` • ${item.seasons.reduce((a, s) => a + s.episodes.length, 0)} حلقة`
                                : ''}
                            </span>
                            {(item.servers || []).some((s) =>
                              /^https?:\/\//i.test(resolveWatchServerUrl(s))
                            ) && (
                              <button
                                type="button"
                                onClick={() => {
                                  const urls = (item.servers || [])
                                    .map((s) => resolveWatchServerUrl(s))
                                    .filter((u) => /^https?:\/\//i.test(u));
                                  onCheckItemServers(urls);
                                }}
                                title="فحص روابط سيرفرات هذا العمل"
                                className="inline-flex items-center gap-1 rounded-md bg-white/5 hover:bg-sky-500/20 border border-white/10 px-1.5 py-0.5 text-[10px] font-bold text-sky-300 cursor-pointer"
                              >
                                <RefreshCw className="w-2.5 h-2.5" />
                                <span>فحص</span>
                              </button>
                            )}
                          </div>
                          {(() => {
                            const urls = (item.servers || [])
                              .map((s) => resolveWatchServerUrl(s))
                              .filter((u) => /^https?:\/\//i.test(u));
                            const checked = urls.map((u) => serverStatuses[u]).filter(Boolean);
                            if (checked.length === 0) return null;
                            const workingCount = checked.filter((c) => c.status === 'working').length;
                            const warnCount = checked.filter((c) => c.status === 'warning').length;
                            const brokenCount = checked.filter((c) => c.status === 'broken').length;
                            const checkingCount = checked.filter((c) => c.status === 'checking').length;
                            return (
                              <div className="flex flex-wrap items-center gap-1 text-[10px] font-extrabold">
                                {checkingCount > 0 && (
                                  <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300">
                                    جاري الفحص ({checkingCount})
                                  </span>
                                )}
                                {workingCount > 0 && (
                                  <span className="rounded bg-[#4CAF50]/15 px-1.5 py-0.5 text-[#4CAF50]">
                                    ● {workingCount} يعمل
                                  </span>
                                )}
                                {warnCount > 0 && (
                                  <span className="rounded bg-[#f9c400]/15 px-1.5 py-0.5 text-[#f9c400]">
                                    ● {warnCount} تحذير تضمين
                                  </span>
                                )}
                                {brokenCount > 0 && (
                                  <span className="rounded bg-[#D92321]/20 px-1.5 py-0.5 text-[#ff8a88]">
                                    ● {brokenCount} معطل
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                      )}
                      {cols.rating && (
                        <td className="py-3 px-2 font-black text-[#f9c400] tabular-nums whitespace-nowrap">
                          ★ {Number(item.imdb || 0).toFixed(1)}
                        </td>
                      )}
                      {cols.views && (
                        <td className="py-3 px-2 font-latin text-xs font-bold text-[#b7c9ef] tabular-nums">
                          {(item.views || 0).toLocaleString('en-US')}
                        </td>
                      )}
                      {cols.flags && (
                        <td className="py-3 px-2">
                          <button
                            type="button"
                            onClick={() => onTogglePin(item)}
                            aria-label="تبديل التثبيت"
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors cursor-pointer ${
                              item.pinned
                                ? 'bg-[#f9c400] border-[#f9c400] text-[#06131c]'
                                : 'bg-[#1a242e] border-white/10 text-[#b7c9ef]'
                            }`}
                          >
                            <Pin className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                      <td className="py-3 px-2">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => onPreviewMedia(item)}
                            aria-label="معاينة"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#1a242e] text-[#b7c9ef] hover:text-white cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onEditMedia(item)}
                            aria-label="تعديل"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#1a242e] text-sky-300 hover:bg-sky-500 hover:text-white cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onRequestDeleteMedia(item.id)}
                            aria-label="حذف"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#1a242e] text-[#D92321] hover:bg-[#D92321] hover:text-white cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <TablePagination
            page={safePage}
            pageSize={tablePrefs.pageSize}
            totalItems={sortedItems.length}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              onUpdateTablePrefs({ pageSize: size });
              setPage(1);
            }}
          />
        </>
      )}
      <ConfirmDialog
        isOpen={confirmDeleteDuplicates}
        title="تأكيد حذف المحتوى المكرر"
        description={`سيتم حذف ${duplicateAnalysis.extraIds.length} نسخة مكررة من أصل ${duplicateAnalysis.groups.length} مجموعة مكررة، مع الإبقاء تلقائياً على النسخة الأفضل والأكثر اكتمالاً لكل عمل. هل تريد المتابعة؟`}
        confirmLabel={`حذف ${duplicateAnalysis.extraIds.length} نسخة مكررة`}
        busy={busyAction}
        onCancel={() => setConfirmDeleteDuplicates(false)}
        onConfirm={async () => {
          const idsToDelete = [...duplicateAnalysis.extraIds];
          setConfirmDeleteDuplicates(false);
          if (idsToDelete.length === 0) return;
          if (onDeleteDuplicateIds) {
            await onDeleteDuplicateIds(idsToDelete);
          } else {
            onSetSelectedIds(idsToDelete);
            onOpenBulkDelete('selected');
          }
        }}
      />
    </div>
  );
}
