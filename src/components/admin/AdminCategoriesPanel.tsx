import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Film,
  Layers,
  Loader2,
  Pin,
  Sparkles,
  Tag,
} from 'lucide-react';
import { appendActivityLog } from '../../lib/adminAssistantDb';
import { bulkSaveMediaToFirestore } from '../../lib/firebase';
import { MediaItem, MediaKind } from '../../types/media';
import type { AdminTab } from './adminNavigation';

interface AdminCategoriesPanelProps {
  catalog: MediaItem[];
  adminUid: string;
  adminName: string;
  isFirestoreSeeded: boolean;
  onNavigateTab: (tab: AdminTab) => void;
  onNotify: (msg: string) => void;
}

const KIND_LABELS: Record<MediaKind, string> = {
  movie: 'أفلام',
  series: 'مسلسلات',
  tv: 'برامج ومسرحيات',
  wrestling: 'مصارعة حرة',
};

export function AdminCategoriesPanel({
  catalog,
  adminUid,
  adminName,
  isFirestoreSeeded,
  onNavigateTab,
  onNotify,
}: AdminCategoriesPanelProps) {
  const [renameField, setRenameField] = useState<'categories' | 'genres'>('categories');
  const [sourceTag, setSourceTag] = useState('');
  const [targetTag, setTargetTag] = useState('');
  const [busy, setBusy] = useState(false);

  const categoryStats = useMemo(() => {
    const map = new Map<string, { count: number; views: number }>();
    for (const item of catalog) {
      for (const c of item.categories || []) {
        const clean = c.trim();
        if (!clean) continue;
        const curr = map.get(clean) || { count: 0, views: 0 };
        curr.count += 1;
        curr.views += item.views || 0;
        map.set(clean, curr);
      }
    }
    return Array.from(map.entries())
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.count - a.count);
  }, [catalog]);

  const genreStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of catalog) {
      for (const g of item.genres || []) {
        const clean = g.trim();
        if (!clean) continue;
        map.set(clean, (map.get(clean) || 0) + 1);
      }
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [catalog]);

  const flagStats = useMemo(() => {
    return {
      pinned: catalog.filter((c) => c.pinned).length,
      isNew: catalog.filter((c) => c.isNew).length,
      comingSoon: catalog.filter((c) => c.comingSoon).length,
    };
  }, [catalog]);

  const affectedItems = useMemo(() => {
    const from = sourceTag.trim();
    if (!from) return [];
    return catalog.filter((item) =>
      renameField === 'categories'
        ? (item.categories || []).includes(from)
        : (item.genres || []).includes(from)
    );
  }, [catalog, renameField, sourceTag]);

  const handleApplyTaxonomyRename = async () => {
    const from = sourceTag.trim();
    const to = targetTag.trim();
    if (!from || !to || from === to) {
      onNotify('اختر التصنيف الحالي وأدخل الاسم الجديد المختلف.');
      return;
    }
    if (!isFirestoreSeeded) {
      onNotify('يجب استيراد المكتبة إلى Firestore أولاً لتطبيق الدمج الجماعي.');
      return;
    }
    if (affectedItems.length === 0) {
      onNotify('لا توجد أعمال تستخدم هذا التصنيف.');
      return;
    }

    setBusy(true);
    try {
      const updated = affectedItems.map((item) => {
        const currentList = renameField === 'categories' ? item.categories || [] : item.genres || [];
        const nextList = Array.from(
          new Set(currentList.map((entry) => (entry.trim() === from ? to : entry.trim())).filter(Boolean))
        );
        return renameField === 'categories'
          ? { ...item, categories: nextList }
          : { ...item, genres: nextList };
      });
      await bulkSaveMediaToFirestore(updated, adminUid);
      await appendActivityLog({
        adminUid,
        adminName,
        rawCommand: `توحيد ${renameField === 'categories' ? 'القسم' : 'النوع'}: ${from} -> ${to}`,
        understoodCommand: `استبدال "${from}" بـ "${to}" في ${updated.length} عمل`,
        operationType: 'category_merge',
        operationLabel: `توحيد ${renameField === 'categories' ? 'القسم' : 'النوع'} "${from}" ← "${to}" عبر ${updated.length} عمل`,
        affectedCount: updated.length,
        sampleTitles: updated.slice(0, 5).map((u) => u.title),
        status: 'executed',
      });
      onNotify(`تم تحديث "${from}" إلى "${to}" في ${updated.length} عمل بنجاح.`);
      setSourceTag('');
      setTargetTag('');
    } catch {
      onNotify('تعذر حفظ تعديلات التصنيف في Firestore.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-extrabold text-white flex items-center gap-2">
            <Tag className="w-5 h-5 text-[#f9c400]" />
            <span>إدارة التصنيفات والأقسام والوسوم</span>
          </h2>
          <p className="text-xs text-[#b7c9ef] mt-1">
            جرد فوري لجميع الأقسام، الأنواع الدرامية، حالات العرض (المثبت/الجديد/قريباً)، مع أداة توحيد ودمج التصنيفات جماعياً.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onNavigateTab('bulk_editor')}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3.5 py-2 text-xs font-extrabold text-white cursor-pointer whitespace-nowrap shrink-0"
        >
          <Layers className="w-4 h-4 text-sky-400" />
          <span>فتح التعديل الجماعي</span>
        </button>
      </div>

      {/* Kinds & Special Flags Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(['movie', 'series', 'tv', 'wrestling'] as MediaKind[]).map((k) => {
          const count = catalog.filter((m) => m.kind === k).length;
          return (
            <div key={k} className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-4">
              <div className="flex items-center justify-between text-xs text-[#b7c9ef] mb-1">
                <span>{KIND_LABELS[k]}</span>
                <Film className="w-4 h-4 text-[#D92321]" />
              </div>
              <p className="text-2xl font-black text-white tabular-nums">{count}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-[#b7c9ef] font-bold">مثبت في السلايدر (Pinned)</p>
            <p className="text-2xl font-black text-[#f9c400] tabular-nums mt-1">{flagStats.pinned}</p>
          </div>
          <Pin className="w-5 h-5 text-[#f9c400]" />
        </div>
        <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-[#b7c9ef] font-bold">أعمال جديدة (isNew)</p>
            <p className="text-2xl font-black text-[#4CAF50] tabular-nums mt-1">{flagStats.isNew}</p>
          </div>
          <Sparkles className="w-5 h-5 text-[#4CAF50]" />
        </div>
        <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-[#b7c9ef] font-bold">قريباً (Coming Soon)</p>
            <p className="text-2xl font-black text-sky-300 tabular-nums mt-1">{flagStats.comingSoon}</p>
          </div>
          <Layers className="w-5 h-5 text-sky-300" />
        </div>
      </div>

      {/* Taxonomy Merge / Rename Tool */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-4">
        <div>
          <h3 className="font-display text-sm font-extrabold text-white">
            توحيد أو إعادة تسمية قسم / تصنيف في جميع الأعمال
          </h3>
          <p className="text-[11px] text-[#b7c9ef] mt-0.5">
            مفيد لتوحيد المسميات المتشابهة (مثلاً: دمج &quot;أفلام أجنبي&quot; إلى &quot;افلام اجنبية&quot;).
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
          <div className="sm:col-span-3">
            <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">الحقل المستهدف</label>
            <select
              value={renameField}
              onChange={(e) => {
                setRenameField(e.target.value as 'categories' | 'genres');
                setSourceTag('');
              }}
              className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2.5 text-xs font-bold text-white"
            >
              <option value="categories">الأقسام (Categories)</option>
              <option value="genres">الأنواع (Genres)</option>
            </select>
          </div>

          <div className="sm:col-span-3">
            <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">القيمة الحالية</label>
            <select
              value={sourceTag}
              onChange={(e) => setSourceTag(e.target.value)}
              className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2.5 text-xs font-bold text-white"
            >
              <option value="">اختر اسماً...</option>
              {(renameField === 'categories' ? categoryStats : genreStats).map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name} ({entry.count})
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-3">
            <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">الاسم الجديد الموحد</label>
            <input
              type="text"
              value={targetTag}
              onChange={(e) => setTargetTag(e.target.value)}
              placeholder="أدخل الاسم الجديد..."
              className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2.5 text-xs text-white focus:border-[#f9c400] focus:outline-none"
            />
          </div>

          <div className="sm:col-span-3">
            <button
              type="button"
              disabled={busy || !sourceTag || !targetTag.trim()}
              onClick={() => void handleApplyTaxonomyRename()}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-45 px-4 py-2.5 text-xs font-extrabold text-white cursor-pointer whitespace-nowrap shrink-0"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              <span>تطبيق ({affectedItems.length} عمل)</span>
            </button>
          </div>
        </div>
      </div>

      {/* Category & Genre Inventory Grids */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-3">
          <h3 className="font-display text-sm font-extrabold text-white">
            الأقسام الرئيسية والفرعية ({categoryStats.length})
          </h3>
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {categoryStats.map((cat) => (
              <div
                key={cat.name}
                className="flex items-center justify-between gap-2 rounded-xl bg-[#1a242e]/65 border border-white/[0.06] px-3.5 py-2 text-xs"
              >
                <span className="font-extrabold text-white truncate">{cat.name}</span>
                <div className="flex items-center gap-3 shrink-0 text-[11px] tabular-nums">
                  <span className="text-[#b7c9ef]">{cat.views.toLocaleString('en-US')} مشاهدة</span>
                  <span className="rounded-md bg-[#D92321]/20 px-2 py-0.5 font-black text-[#ff9f9d]">
                    {cat.count} عمل
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-3">
          <h3 className="font-display text-sm font-extrabold text-white">
            الأنواع والوسوم الدرامية ({genreStats.length})
          </h3>
          <div className="flex flex-wrap gap-2 max-h-80 overflow-y-auto">
            {genreStats.map((g) => (
              <button
                key={g.name}
                type="button"
                onClick={() => {
                  setRenameField('genres');
                  setSourceTag(g.name);
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-[#1a242e] hover:border-[#f9c400]/50 border border-white/10 px-3 py-1.5 text-xs cursor-pointer"
              >
                <span className="font-bold text-white">{g.name}</span>
                <span className="font-latin text-[11px] font-black text-[#f9c400] tabular-nums">
                  {g.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
