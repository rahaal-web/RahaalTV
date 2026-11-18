import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  Layers,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { bulkDeleteMediaFromFirestore, bulkSaveMediaToFirestore } from '../../lib/firebase';
import { appendActivityLog } from '../../lib/adminAssistantDb';
import { MediaItem, MediaKind } from '../../types/media';

interface AdminBulkEditorPanelProps {
  catalog: MediaItem[];
  adminUid: string;
  adminName: string;
  isFirestoreSeeded: boolean;
  onDeleteStarterItems: (ids: string[]) => void;
  onNotify: (msg: string) => void;
}

const KIND_LABELS: Record<MediaKind, string> = {
  movie: 'فيلم',
  series: 'مسلسل',
  tv: 'برنامج / مسرحية',
  wrestling: 'مصارعة حرة',
};

export function AdminBulkEditorPanel({
  catalog,
  adminUid,
  adminName,
  isFirestoreSeeded,
  onDeleteStarterItems,
  onNotify,
}: AdminBulkEditorPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | MediaKind>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Bulk operation fields
  const [opQuality, setOpQuality] = useState('');
  const [opCategoryAdd, setOpCategoryAdd] = useState('');
  const [opGenreAdd, setOpGenreAdd] = useState('');
  const [opPinned, setOpPinned] = useState<'unchanged' | 'true' | 'false'>('unchanged');
  const [opIsNew, setOpIsNew] = useState<'unchanged' | 'true' | 'false'>('unchanged');
  const [opComingSoon, setOpComingSoon] = useState<'unchanged' | 'true' | 'false'>('unchanged');
  const [opYear, setOpYear] = useState('');

  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lastUndoSnapshot, setLastUndoSnapshot] = useState<MediaItem[] | null>(null);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return catalog.filter((item) => {
      if (kindFilter !== 'all' && item.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.englishTitle.toLowerCase().includes(q) ||
        item.categories.join(' ').toLowerCase().includes(q)
      );
    });
  }, [catalog, searchQuery, kindFilter]);

  const selectedItems = useMemo(() => {
    const set = new Set(selectedIds);
    return catalog.filter((m) => set.has(m.id));
  }, [catalog, selectedIds]);

  const previewPatches = useMemo(() => {
    return selectedItems.map((item) => {
      const next: MediaItem = { ...item };
      const changes: string[] = [];

      if (opQuality.trim()) {
        next.quality = opQuality.trim();
        changes.push(`الجودة ← ${next.quality}`);
      }
      if (opYear.trim() && /^\d{4}$/.test(opYear.trim())) {
        next.year = opYear.trim();
        changes.push(`السنة ← ${next.year}`);
      }
      if (opCategoryAdd.trim()) {
        const cat = opCategoryAdd.trim();
        if (!next.categories.includes(cat)) {
          next.categories = [...next.categories, cat];
          changes.push(`+ قسم "${cat}"`);
        }
      }
      if (opGenreAdd.trim()) {
        const genre = opGenreAdd.trim();
        if (!next.genres.includes(genre)) {
          next.genres = [...next.genres, genre];
          changes.push(`+ تصنيف "${genre}"`);
        }
      }
      if (opPinned !== 'unchanged') {
        const flag = opPinned === 'true';
        if (Boolean(next.pinned) !== flag) {
          next.pinned = flag;
          changes.push(flag ? 'تثبيت في السلايدر' : 'إلغاء التثبيت');
        }
      }
      if (opIsNew !== 'unchanged') {
        const flag = opIsNew === 'true';
        if (Boolean(next.isNew) !== flag) {
          next.isNew = flag;
          changes.push(flag ? 'شارة جديد: نعم' : 'شارة جديد: لا');
        }
      }
      if (opComingSoon !== 'unchanged') {
        const flag = opComingSoon === 'true';
        if (Boolean(next.comingSoon) !== flag) {
          next.comingSoon = flag;
          changes.push(flag ? 'قريباً: نعم' : 'قريباً: لا');
        }
      }

      return { original: item, next, changes };
    });
  }, [selectedItems, opQuality, opYear, opCategoryAdd, opGenreAdd, opPinned, opIsNew, opComingSoon]);

  const changedCount = useMemo(
    () => previewPatches.filter((p) => p.changes.length > 0).length,
    [previewPatches]
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleApplyBulkChanges = async () => {
    const toUpdate = previewPatches.filter((p) => p.changes.length > 0);
    if (toUpdate.length === 0) {
      onNotify('اختر أعمالاً وحدد حقلاً واحداً على الأقل للتعديل.');
      return;
    }

    setBusy(true);
    try {
      setLastUndoSnapshot(toUpdate.map((p) => p.original));
      await bulkSaveMediaToFirestore(toUpdate.map((p) => p.next), adminUid);
      appendActivityLog({
        adminUid,
        adminName,
        rawCommand: 'التعديل الجماعي السريع',
        understoodCommand: `تعديل ${toUpdate.length} عمل دفعة واحدة`,
        operationType: 'bulk_edit',
        operationLabel: 'تعديل جماعي',
        affectedCount: toUpdate.length,
        sampleTitles: toUpdate.slice(0, 5).map((p) => p.next.title),
        status: 'executed',
      });
      onNotify(`تم تحديث ${toUpdate.length} عمل بنجاح في Firestore!`);
    } catch (err) {
      onNotify(`فشل التعديل الجماعي: ${err instanceof Error ? err.message : 'خطأ غير معروف'}`);
    } finally {
      setBusy(false);
    }
  };

  const handleUndoLast = async () => {
    if (!lastUndoSnapshot || lastUndoSnapshot.length === 0) return;
    setBusy(true);
    try {
      await bulkSaveMediaToFirestore(lastUndoSnapshot, adminUid);
      appendActivityLog({
        adminUid,
        adminName,
        rawCommand: 'تراجع عن التعديل الجماعي',
        understoodCommand: `استعادة ${lastUndoSnapshot.length} عمل`,
        operationType: 'bulk_undo',
        operationLabel: 'تراجع تعديل جماعي',
        affectedCount: lastUndoSnapshot.length,
        sampleTitles: lastUndoSnapshot.slice(0, 5).map((m) => m.title),
        status: 'undone',
      });
      onNotify(`تم التراجع واستعادة ${lastUndoSnapshot.length} عمل إلى حالتها السابقة.`);
      setLastUndoSnapshot(null);
    } catch (err) {
      onNotify(`فشل التراجع: ${err instanceof Error ? err.message : 'خطأ غير معروف'}`);
    } finally {
      setBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedItems.length === 0) return;
    setBusy(true);
    try {
      const ids = selectedItems.map((m) => m.id);
      if (isFirestoreSeeded) {
        await bulkDeleteMediaFromFirestore(ids);
      } else {
        onDeleteStarterItems(ids);
      }
      appendActivityLog({
        adminUid,
        adminName,
        rawCommand: 'حذف جماعي من الكتالوج',
        understoodCommand: `حذف ${ids.length} عمل`,
        operationType: 'bulk_delete',
        operationLabel: 'حذف جماعي',
        affectedCount: ids.length,
        sampleTitles: selectedItems.slice(0, 5).map((m) => m.title),
        status: 'executed',
      });
      onNotify(`تم حذف ${ids.length} عمل بنجاح.`);
      setSelectedIds([]);
      setConfirmDelete(false);
    } catch (err) {
      onNotify(`فشل الحذف الجماعي: ${err instanceof Error ? err.message : 'خطأ غير معروف'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-extrabold text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-sky-400" />
              <span>محرر التعديل الجماعي السريع (بدون AI)</span>
            </h2>
            <p className="text-xs text-[#b7c9ef] mt-1">
              حدّد الأعمال المطلوبة، شاهد معاينة التغييرات الدقيقة قبل التنفيذ، وطبق التحديث دفعة واحدة مع إمكانية التراجع الفوري.
            </p>
          </div>

          {lastUndoSnapshot && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleUndoLast()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#f9c400] hover:bg-[#dfb20b] px-4 py-2 text-xs font-black text-[#06131c] cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>تراجع عن آخر عملية ({lastUndoSnapshot.length})</span>
            </button>
          )}
        </div>

        {/* Filter & Multi-select Toolbar */}
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#b7c9ef] absolute right-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث بالاسم أو القسم لتحديد الأعمال..."
              className="w-full rounded-xl bg-[#1a242e] border border-white/10 pr-10 pl-3 py-2.5 text-xs text-white focus:border-[#f9c400] focus:outline-none"
            />
          </div>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as 'all' | MediaKind)}
            className="rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-xs font-bold text-white"
          >
            <option value="all">جميع الأنواع ({catalog.length})</option>
            <option value="movie">أفلام</option>
            <option value="series">مسلسلات</option>
            <option value="tv">برامج / مسرحيات</option>
            <option value="wrestling">مصارعة حرة</option>
          </select>
          <button
            type="button"
            onClick={() => setSelectedIds(filteredItems.map((i) => i.id))}
            className="rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3.5 py-2.5 text-xs font-bold text-white cursor-pointer"
          >
            تحديد الظاهر ({filteredItems.length})
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds([])}
            className="rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3.5 py-2.5 text-xs font-bold text-[#b7c9ef] cursor-pointer"
          >
            إلغاء التحديد
          </button>
        </div>

        {/* Selectable Table */}
        <div className="max-h-72 overflow-y-auto rounded-2xl border border-white/10 bg-[#081118] divide-y divide-white/[0.06]">
          {filteredItems.map((item) => {
            const checked = selectedIds.includes(item.id);
            return (
              <label
                key={item.id}
                className={`flex items-center justify-between gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                  checked ? 'bg-sky-500/10' : 'hover:bg-white/[0.03]'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSelect(item.id)}
                    className="h-4 w-4 accent-[#f9c400]"
                  />
                  <span className="text-xs font-extrabold text-white truncate">{item.title}</span>
                </span>
                <span className="flex items-center gap-2 text-[10px] font-bold text-[#b7c9ef] shrink-0">
                  <span className="rounded bg-white/5 px-2 py-0.5">{KIND_LABELS[item.kind]}</span>
                  <span className="rounded bg-[#f9c400]/15 text-[#f9c400] px-2 py-0.5 font-latin">
                    {item.quality}
                  </span>
                  <span>{item.year}</span>
                  {item.pinned && (
                    <span className="rounded bg-[#D92321]/20 text-[#ff9f9d] px-1.5 py-0.5">مثبت</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Patch Builder + Diff Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-4">
          <h3 className="font-display text-base font-extrabold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#f9c400]" />
            <span>التغييرات المطلوب تطبيقها على المحدد ({selectedItems.length})</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                تعيين الجودة
              </label>
              <input
                type="text"
                value={opQuality}
                onChange={(e) => setOpQuality(e.target.value)}
                placeholder="مثال: 1080p BluRay"
                className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                تعديل السنة
              </label>
              <input
                type="text"
                maxLength={4}
                value={opYear}
                onChange={(e) => setOpYear(e.target.value)}
                placeholder="مثال: 2026"
                className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white font-latin"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                إضافة قسم (Category)
              </label>
              <input
                type="text"
                value={opCategoryAdd}
                onChange={(e) => setOpCategoryAdd(e.target.value)}
                placeholder="مثال: مسلسلات رمضان 2026"
                className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                إضافة تصنيف (Genre)
              </label>
              <input
                type="text"
                value={opGenreAdd}
                onChange={(e) => setOpGenreAdd(e.target.value)}
                placeholder="مثال: أكشن"
                className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                تثبيت في السلايدر
              </label>
              <select
                value={opPinned}
                onChange={(e) => setOpPinned(e.target.value as 'unchanged' | 'true' | 'false')}
                className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
              >
                <option value="unchanged">بدون تغيير</option>
                <option value="true">تثبيت الكل</option>
                <option value="false">إلغاء تثبيت الكل</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                شارة "جديد"
              </label>
              <select
                value={opIsNew}
                onChange={(e) => setOpIsNew(e.target.value as 'unchanged' | 'true' | 'false')}
                className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
              >
                <option value="unchanged">بدون تغيير</option>
                <option value="true">تفعيل شارة جديد</option>
                <option value="false">إزالة شارة جديد</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                حالة "قريباً"
              </label>
              <select
                value={opComingSoon}
                onChange={(e) => setOpComingSoon(e.target.value as 'unchanged' | 'true' | 'false')}
                className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
              >
                <option value="unchanged">بدون تغيير</option>
                <option value="true">تحويل لقريباً</option>
                <option value="false">نشر عادي (إلغاء قريباً)</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-white/10">
            <button
              type="button"
              disabled={busy || changedCount === 0}
              onClick={() => void handleApplyBulkChanges()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-50 px-5 py-2.5 text-xs font-extrabold text-white cursor-pointer"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              <span>تطبيق التعديل على {changedCount} عمل</span>
            </button>

            {!confirmDelete ? (
              <button
                type="button"
                disabled={busy || selectedItems.length === 0}
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#D92321]/15 hover:bg-[#D92321] disabled:opacity-40 border border-[#D92321]/40 px-4 py-2.5 text-xs font-extrabold text-[#ff9f9d] hover:text-white cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>حذف المحدد ({selectedItems.length})</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleBulkDelete()}
                  className="rounded-xl bg-[#D92321] px-4 py-2 text-xs font-black text-white cursor-pointer"
                >
                  تأكيد الحذف النهائي ({selectedItems.length})
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Live Diff Preview */}
        <div className="lg:col-span-6 rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-3">
          <h3 className="font-display text-base font-extrabold text-white flex items-center gap-2">
            <Eye className="w-4 h-4 text-[#f9c400]" />
            <span>معاينة الفروقات قبل التنفيذ</span>
          </h3>

          {selectedItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 py-14 text-center text-xs text-[#b7c9ef]">
              اختر عملاً واحداً أو أكثر من القائمة أعلاه لرؤية معاينة التعديلات.
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
              {previewPatches.map(({ original, changes }) => (
                <div
                  key={original.id}
                  className="rounded-2xl bg-[#1a242e]/65 border border-white/[0.07] p-3 flex flex-col gap-1"
                >
                  <p className="text-xs font-extrabold text-white">{original.title}</p>
                  {changes.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {changes.map((ch, idx) => (
                        <span
                          key={idx}
                          className="rounded-md bg-[#4CAF50]/15 border border-[#4CAF50]/35 px-2 py-0.5 text-[10px] font-bold text-[#a6f5a9]"
                        >
                          {ch}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[10px] text-[#b7c9ef]/70">لا توجد تغييرات بعد</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
