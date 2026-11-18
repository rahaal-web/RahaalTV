import { FormEvent, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Eye,
  Film,
  Loader2,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Wand2,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { resolveApiEndpoint } from '../lib/clientScraper';
import { bulkSaveMediaToFirestore, bulkUpdateMediaInFirestore } from '../lib/firebase';
import { buildDedicatedMediaUrl, generateCleanSlug } from '../lib/permalink';
import { MediaItem, MediaKind } from '../types/media';

interface AdminAiBulkEditorProps {
  user: User;
  catalog: MediaItem[];
  isFirestoreSeeded: boolean;
  onNotify: (msg: string) => void;
  onPreviewMedia: (item: MediaItem) => void;
  onSavedToCatalog?: () => void;
}

interface AiPatchProposal {
  id: string;
  title?: string;
  englishTitle?: string;
  kind?: MediaKind;
  categories?: string[];
  genres?: string[];
  year?: string;
  country?: string;
  language?: string;
  quality?: string;
  duration?: string;
  tagline?: string;
  story?: string;
  pinned?: boolean;
  isNew?: boolean;
  comingSoon?: boolean;
}

interface ProposalEntry {
  original: MediaItem;
  updated: MediaItem;
  changedFields: {
    key: string;
    label: string;
    before: string;
    after: string;
  }[];
  selected: boolean;
}

const KIND_LABELS: Record<MediaKind, string> = {
  movie: 'فيلم',
  series: 'مسلسل',
  tv: 'برنامج / مسرحية',
  wrestling: 'مصارعة حرة',
};

const QUICK_AI_PRESETS = [
  {
    label: 'حذف كلمة "فيلم" من العناوين',
    instruction:
      'احذف كلمة "فيلم" من بداية أو نص جميع عناوين الأفلام ونظف المسافات الزائدة مع الإبقاء على اسم الفيلم الأساسي والسنة كما هي.',
  },
  {
    label: 'تنظيف العناوين من الزوائد',
    instruction:
      'أزل العبارات الترويجية الزائدة من العناوين مثل "مترجم اون لاين" و"بجودة عالية" و"مشاهدة وتحميل" واترك عنوان العمل النظيف فقط.',
  },
  {
    label: 'توحيد الجودة إلى 1080p WEB-DL',
    instruction: 'حدّث حقل الجودة (quality) لجميع الأعمال المحددة إلى "1080p WEB-DL".',
  },
  {
    label: 'تحسين القصة والشعار الترويجي',
    instruction:
      'أعد صياغة القصة (story) والشعار الترويجي (tagline) بأسلوب عربي سينمائي احترافي، مشوّق، وخالٍ من التكرار أو الكلمات الدعائية.',
  },
  {
    label: 'ضبط الاسم الإنجليزي والأنواع',
    instruction:
      'اضبط حقل englishTitle ليكون باللغة الإنجليزية بشكل سليم، ونظّم مصفوفتي التصنيفات (categories) والأنواع (genres) بشكل متناسق.',
  },
  {
    label: 'تفعيل شارة "جديد" لأعمال 2026',
    instruction: 'اجعل حقل isNew يساوي true لجميع الأعمال الصادرة في سنة 2026.',
  },
];

function formatArray(arr: string[] | undefined): string {
  return (arr || []).join('، ');
}

function buildDiffFields(original: MediaItem, patch: AiPatchProposal): ProposalEntry['changedFields'] {
  const diffs: ProposalEntry['changedFields'] = [];

  if (patch.title !== undefined && patch.title !== original.title) {
    diffs.push({ key: 'title', label: 'العنوان', before: original.title, after: patch.title });
  }
  if (patch.englishTitle !== undefined && patch.englishTitle !== original.englishTitle) {
    diffs.push({
      key: 'englishTitle',
      label: 'الاسم الإنجليزي',
      before: original.englishTitle,
      after: patch.englishTitle,
    });
  }
  if (patch.kind !== undefined && patch.kind !== original.kind) {
    diffs.push({
      key: 'kind',
      label: 'نوع القسم',
      before: KIND_LABELS[original.kind],
      after: KIND_LABELS[patch.kind],
    });
  }
  if (
    patch.categories !== undefined &&
    formatArray(patch.categories) !== formatArray(original.categories)
  ) {
    diffs.push({
      key: 'categories',
      label: 'التصنيفات',
      before: formatArray(original.categories),
      after: formatArray(patch.categories),
    });
  }
  if (patch.genres !== undefined && formatArray(patch.genres) !== formatArray(original.genres)) {
    diffs.push({
      key: 'genres',
      label: 'الأنواع',
      before: formatArray(original.genres),
      after: formatArray(patch.genres),
    });
  }
  if (patch.year !== undefined && patch.year !== original.year) {
    diffs.push({ key: 'year', label: 'السنة', before: original.year, after: patch.year });
  }
  if (patch.country !== undefined && patch.country !== original.country) {
    diffs.push({ key: 'country', label: 'البلد', before: original.country, after: patch.country });
  }
  if (patch.language !== undefined && patch.language !== original.language) {
    diffs.push({ key: 'language', label: 'اللغة', before: original.language, after: patch.language });
  }
  if (patch.quality !== undefined && patch.quality !== original.quality) {
    diffs.push({ key: 'quality', label: 'الجودة', before: original.quality, after: patch.quality });
  }
  if (patch.duration !== undefined && patch.duration !== original.duration) {
    diffs.push({ key: 'duration', label: 'المدة', before: original.duration, after: patch.duration });
  }
  if (patch.tagline !== undefined && patch.tagline !== original.tagline) {
    diffs.push({
      key: 'tagline',
      label: 'الشعار الترويجي',
      before: original.tagline || '—',
      after: patch.tagline || '—',
    });
  }
  if (patch.story !== undefined && patch.story !== original.story) {
    diffs.push({ key: 'story', label: 'القصة', before: original.story, after: patch.story });
  }
  if (patch.pinned !== undefined && patch.pinned !== Boolean(original.pinned)) {
    diffs.push({
      key: 'pinned',
      label: 'مثبت بالسلايدر',
      before: original.pinned ? 'نعم' : 'لا',
      after: patch.pinned ? 'نعم' : 'لا',
    });
  }
  if (patch.isNew !== undefined && patch.isNew !== Boolean(original.isNew)) {
    diffs.push({
      key: 'isNew',
      label: 'شارة جديد',
      before: original.isNew ? 'نعم' : 'لا',
      after: patch.isNew ? 'نعم' : 'لا',
    });
  }
  if (patch.comingSoon !== undefined && patch.comingSoon !== Boolean(original.comingSoon)) {
    diffs.push({
      key: 'comingSoon',
      label: 'قريباً',
      before: original.comingSoon ? 'نعم' : 'لا',
      after: patch.comingSoon ? 'نعم' : 'لا',
    });
  }

  return diffs;
}

export function AdminAiBulkEditor({
  user,
  catalog,
  isFirestoreSeeded,
  onNotify,
  onPreviewMedia,
  onSavedToCatalog,
}: AdminAiBulkEditorProps) {
  const [scopeKind, setScopeKind] = useState<'all' | MediaKind>('all');
  const [scopeCategory, setScopeCategory] = useState<string>('all');
  const [scopeSearch, setScopeSearch] = useState<string>('');
  const [instruction, setInstruction] = useState<string>('');
  const [regenerateSlugOnRename, setRegenerateSlugOnRename] = useState<boolean>(false);

  const [generating, setGenerating] = useState<boolean>(false);
  const [progressText, setProgressText] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [noChangeInfo, setNoChangeInfo] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ProposalEntry[]>([]);

  const allCategories = useMemo(() => {
    const set = new Set<string>();
    catalog.forEach((item) => item.categories.forEach((c) => c && set.add(c)));
    return Array.from(set);
  }, [catalog]);

  const targetedItems = useMemo(() => {
    const q = scopeSearch.trim().toLowerCase();
    return catalog.filter((item) => {
      if (scopeKind !== 'all' && item.kind !== scopeKind) return false;
      if (scopeCategory !== 'all' && !item.categories.includes(scopeCategory)) return false;
      if (q) {
        const matchTitle = item.title.toLowerCase().includes(q);
        const matchEng = item.englishTitle.toLowerCase().includes(q);
        if (!matchTitle && !matchEng) return false;
      }
      return true;
    });
  }, [catalog, scopeKind, scopeCategory, scopeSearch]);

  const selectedProposalsCount = useMemo(
    () => proposals.filter((p) => p.selected).length,
    [proposals]
  );

  const handleGeneratePreview = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setAiSummary(null);

    if (!instruction.trim()) {
      setErrorMsg('يرجى كتابة الأمر الذي تريد تطبيقه على المحتوى أولاً.');
      return;
    }
    if (targetedItems.length === 0) {
      setErrorMsg('لا توجد أعمال تطابق نطاق التصفية المحدد.');
      return;
    }

    setGenerating(true);
    setProgressText('');
    setNoChangeInfo(null);
    setProposals([]);

    try {
      const compactItems = targetedItems.slice(0, 400).map((item) => ({
        id: item.id,
        title: item.title,
        englishTitle: item.englishTitle,
        kind: item.kind,
        categories: item.categories,
        genres: item.genres,
        year: item.year,
        country: item.country,
        language: item.language,
        quality: item.quality,
        duration: item.duration,
        tagline: item.tagline,
        story: item.story,
        pinned: Boolean(item.pinned),
        isNew: Boolean(item.isNew),
        comingSoon: Boolean(item.comingSoon),
      }));

      const CLIENT_BATCH_SIZE = 9;
      const chunks: typeof compactItems[] = [];
      for (let i = 0; i < compactItems.length; i += CLIENT_BATCH_SIZE) {
        chunks.push(compactItems.slice(i, i + CLIENT_BATCH_SIZE));
      }

      const callAiEndpoint = async (batchItems: typeof compactItems) => {
        const trySingleEndpoint = async (endpoint: string) => {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              instruction: instruction.trim(),
              items: batchItems,
            }),
          });
          const ct = response.headers.get('content-type') || '';
          if (!ct.includes('application/json')) {
            return { kind: 'non-json' as const };
          }

          const json = (await response.json()) as {
            ok?: boolean;
            error?: string;
            service?: string;
            summary?: string;
            processedCount?: number;
            updates?: AiPatchProposal[];
          };

          if (json.service === 'RahaL TV Proxy Worker') {
            return { kind: 'proxy-worker' as const };
          }

          if (!response.ok || !json.ok || !Array.isArray(json.updates)) {
            return {
              kind: 'api-error' as const,
              error: json.error || 'تعذر تنفيذ المعالجة بالذكاء الاصطناعي.',
            };
          }

          return { kind: 'ok' as const, data: json };
        };

        // 1. Always try same-origin Express endpoint first
        try {
          const primary = await trySingleEndpoint('/api/ai-bulk-edit');
          if (primary.kind === 'ok') return primary.data;
          if (primary.kind === 'api-error') {
            // Real backend error: surface it directly without falling back to proxy worker
            throw new Error(primary.error);
          }
        } catch (err) {
          // Re-throw explicit backend API errors; only fall back on non-JSON / network miss on static hosting
          if (
            err instanceof Error &&
            err.message &&
            !/failed to fetch|networkerror|load failed/i.test(err.message)
          ) {
            throw err;
          }
        }

        // 2. Fallback to custom API base URL (only if it is an Express/Node backend, NOT the Cloudflare CORS proxy worker)
        const customUrl = resolveApiEndpoint('/api/ai-bulk-edit');
        if (customUrl && customUrl !== '/api/ai-bulk-edit') {
          const secondary = await trySingleEndpoint(customUrl);
          if (secondary.kind === 'ok') return secondary.data;
          if (secondary.kind === 'api-error') {
            throw new Error(secondary.error);
          }
          if (secondary.kind === 'proxy-worker') {
            throw new Error(
              'خدمة الذكاء الاصطناعي تتطلب خادم التطبيق (/api/ai-bulk-edit)، بينما الرابط المخصص المحفوظ هو بروكسي السحب (Cloudflare Proxy Worker) فقط. افتح لوحة الإدارة من خادم التطبيق الكامل أو ضع رابط خادم Node/Express في إعدادات الـ API.'
            );
          }
        }

        throw new Error(
          'تعذر العثور على نقطة الذكاء الاصطناعي (/api/ai-bulk-edit) على هذا الاستضافة. افتح لوحة الإدارة من خادم التطبيق الرئيسي لتشغيل التعديل بالذكاء الاصطناعي.'
        );
      };

      const allUpdates: AiPatchProposal[] = [];
      const summaries: string[] = [];

      for (let i = 0; i < chunks.length; i++) {
        setProgressText(
          chunks.length > 1
            ? `الدفعة ${i + 1} من ${chunks.length} (${Math.min((i + 1) * CLIENT_BATCH_SIZE, compactItems.length)} / ${compactItems.length} عمل)`
            : `${compactItems.length} عمل`
        );
        const batchRes = await callAiEndpoint(chunks[i]);
        if (batchRes.summary) summaries.push(batchRes.summary);
        if (Array.isArray(batchRes.updates)) {
          allUpdates.push(...batchRes.updates);
        }
      }

      const mergedPatches = new Map<string, AiPatchProposal>();
      for (const patch of allUpdates) {
        if (!patch?.id) continue;
        const prev = mergedPatches.get(patch.id) || { id: patch.id };
        mergedPatches.set(patch.id, { ...prev, ...patch });
      }

      const byId = new Map(targetedItems.map((it) => [it.id, it]));
      const entries: ProposalEntry[] = [];

      for (const patch of mergedPatches.values()) {
        const original = byId.get(patch.id);
        if (!original) continue;
        const changedFields = buildDiffFields(original, patch);
        if (changedFields.length === 0) continue;

        const nextTitle = patch.title ?? original.title;
        const nextEng = patch.englishTitle ?? original.englishTitle;
        const titleRenamed = nextTitle !== original.title || nextEng !== original.englishTitle;

        const nextSlug =
          regenerateSlugOnRename && titleRenamed
            ? generateCleanSlug(nextEng, nextTitle, original.id)
            : original.slug;
        const nextShortUrl =
          regenerateSlugOnRename && titleRenamed
            ? buildDedicatedMediaUrl({ id: original.id, slug: nextSlug })
            : original.shortUrl;

        const updated: MediaItem = {
          ...original,
          title: nextTitle,
          englishTitle: nextEng,
          slug: nextSlug,
          shortUrl: nextShortUrl,
          kind: patch.kind ?? original.kind,
          categories: patch.categories ?? original.categories,
          genres: patch.genres ?? original.genres,
          year: patch.year ?? original.year,
          country: patch.country ?? original.country,
          language: patch.language ?? original.language,
          quality: patch.quality ?? original.quality,
          duration: patch.duration ?? original.duration,
          tagline: patch.tagline ?? original.tagline,
          story: patch.story ?? original.story,
          pinned: patch.pinned !== undefined ? patch.pinned : original.pinned,
          isNew: patch.isNew !== undefined ? patch.isNew : original.isNew,
          comingSoon: patch.comingSoon !== undefined ? patch.comingSoon : original.comingSoon,
        };

        entries.push({
          original,
          updated,
          changedFields,
          selected: true,
        });
      }

      const combinedSummary =
        entries.length > 0
          ? `تم فحص ${compactItems.length} عملًا وتجهيز التعديلات المقترحة لـ ${entries.length} عملًا.`
          : summaries.filter(Boolean).slice(0, 2).join(' — ') || null;
      setAiSummary(combinedSummary);
      setProposals(entries);

      if (entries.length === 0) {
        const info =
          combinedSummary ||
          `تم فحص ${compactItems.length} عملًا، ولم يجد الذكاء الاصطناعي قيماً تحتاج تعديلاً بناءً على هذا الأمر. جرّب توضيح الحقل المطلوب تعديله (مثل العنوان أو القصة أو الجودة) أو التحقق من نطاق الأعمال المختار.`;
        setNoChangeInfo(info);
        onNotify('لم تستدعِ أي أعمال تغييراً بناءً على الأمر المكتوب.');
      } else {
        onNotify(`تم تجهيز معاينة التعديلات على ${entries.length} عملًا — راجعها ثم اعتمد الحفظ.`);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error && err.message
          ? err.message
          : 'تعذر الاتصال بخدمة الذكاء الاصطناعي على الخادم.'
      );
    } finally {
      setGenerating(false);
      setProgressText('');
    }
  };

  const handleToggleProposal = (id: string) => {
    setProposals((prev) =>
      prev.map((p) => (p.original.id === id ? { ...p, selected: !p.selected } : p))
    );
  };

  const handleSelectAllProposals = (selected: boolean) => {
    setProposals((prev) => prev.map((p) => ({ ...p, selected })));
  };

  const handleApplyAndSave = async () => {
    const approved = proposals.filter((p) => p.selected);
    if (approved.length === 0) {
      onNotify('يرجى تحديد عمل واحد على الأقل لاعتماد حفظه.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      const updatedItems = approved.map((p) => p.updated);

      if (isFirestoreSeeded) {
        const count = await bulkUpdateMediaInFirestore(updatedItems, user.uid);
        onNotify(`تم حفظ التعديلات الشاملة على ${count} عملًا في قاعدة بيانات Firestore!`);
      } else {
        const updatedMap = new Map(updatedItems.map((it) => [it.id, it]));
        const fullMergedCatalog = catalog.map((it) => updatedMap.get(it.id) || it);
        await bulkSaveMediaToFirestore(fullMergedCatalog, user.uid);
        onNotify(
          `تم ترحيل المكتبة وحفظ التعديلات على ${updatedItems.length} عملًا في قاعدة البيانات!`
        );
      }

      setProposals([]);
      setAiSummary(null);
      onSavedToCatalog?.();
    } catch {
      setErrorMsg('حدث خطأ أثناء حفظ التعديلات في قاعدة البيانات. تأكد من صلاحيات المشرف.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Intro Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-l from-[#102131] via-[#0c1821] to-[#1a1322] border border-white/[0.1] p-6 shadow-xl">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-[#f9c400] via-[#D92321] to-[#4CAF50]" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 rounded-xl bg-[#f9c400]/15 border border-[#f9c400]/30 px-3 py-1 text-xs font-black text-[#f9c400]">
              <Sparkles className="w-3.5 h-3.5" />
              <span>وضع الذكاء الاصطناعي للتعديلات الشاملة</span>
            </div>
            <h2 className="font-display text-xl sm:text-2xl font-extrabold text-white">
              محرر المكتبة الذكي (AI Bulk Editor)
            </h2>
            <p className="text-xs sm:text-sm text-[#b7c9ef] max-w-2xl leading-relaxed">
              اكتب أمراً واحداً بالعربية لتعديل عشرات أو مئات الأعمال دفعة واحدة — مثل حذف كلمة
              &laquo;فيلم&raquo; من جميع العناوين، تنظيف الزوائد، توحيد الجودة، أو تحسين القصص
              والتصنيفات مع معاينة كاملة قبل الحفظ.
            </p>
          </div>
          <div className="shrink-0 rounded-2xl bg-[#15222d] border border-white/10 px-4 py-3 text-center">
            <p className="font-latin text-2xl font-black text-[#f9c400]">{targetedItems.length}</p>
            <p className="text-[11px] font-bold text-[#b7c9ef]">عمل ضمن النطاق الحالي</p>
          </div>
        </div>
      </div>

      {/* Scope & Prompt Form */}
      <form
        onSubmit={handleGeneratePreview}
        className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 sm:p-6 space-y-5 shadow-xl"
      >
        {/* Step 1: Target Scope */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-sm sm:text-base font-extrabold text-white flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#D92321] text-xs font-black text-white">
                1
              </span>
              <span>تحديد نطاق الأعمال المستهدفة</span>
            </h3>
            <span className="text-xs font-bold text-[#b7c9ef]">
              المحدد للمعالجة: <strong className="text-white">{targetedItems.length}</strong> من أصل{' '}
              {catalog.length}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: 'all', label: `كل المكتبة (${catalog.length})` },
                {
                  id: 'movie',
                  label: `الأفلام فقط (${catalog.filter((i) => i.kind === 'movie').length})`,
                },
                {
                  id: 'series',
                  label: `المسلسلات فقط (${catalog.filter((i) => i.kind === 'series').length})`,
                },
                {
                  id: 'tv',
                  label: `البرامج والمسرحيات (${catalog.filter((i) => i.kind === 'tv').length})`,
                },
                {
                  id: 'wrestling',
                  label: `المصارعة الحرة (${catalog.filter((i) => i.kind === 'wrestling').length})`,
                },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setScopeKind(opt.id)}
                className={`rounded-xl px-3.5 py-2 text-xs font-extrabold border transition-colors cursor-pointer ${
                  scopeKind === opt.id
                    ? 'bg-[#D92321] border-[#D92321] text-white shadow-md'
                    : 'bg-[#1a242e] border-white/10 text-[#b7c9ef] hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1.5">
                تصفية حسب التصنيف (اختياري)
              </label>
              <select
                value={scopeCategory}
                onChange={(e) => setScopeCategory(e.target.value)}
                className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-xs font-bold text-white focus:border-[#f9c400] focus:outline-none"
              >
                <option value="all">جميع التصنيفات</option>
                {allCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1.5">
                تصفية بكلمة مفتاحية في العنوان (اختياري)
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-[#b7c9ef] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={scopeSearch}
                  onChange={(e) => setScopeSearch(e.target.value)}
                  placeholder="مثال: فيلم، 2026، مترجم..."
                  className="w-full rounded-xl bg-[#1a242e] border border-white/10 pr-9 pl-3 py-2.5 text-xs text-white placeholder:text-white/40 focus:border-[#f9c400] focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Step 2: Instruction + Presets */}
        <div className="pt-4 border-t border-white/[0.06] space-y-3">
          <h3 className="font-display text-sm sm:text-base font-extrabold text-white flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#f9c400] text-xs font-black text-[#06131c]">
              2
            </span>
            <span>اكتب أمر التعديل الشامل</span>
          </h3>

          {/* Quick Preset Chips */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-[#b7c9ef]">أوامر جاهزة سريعة (اضغط للتعبئة):</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_AI_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setInstruction(preset.instruction)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#15222d] hover:bg-[#f9c400]/15 border border-white/10 hover:border-[#f9c400]/45 px-3 py-1.5 text-[11px] font-bold text-white transition-colors cursor-pointer"
                >
                  <Wand2 className="w-3 h-3 text-[#f9c400]" />
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>
          </div>

          <textarea
            rows={3}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder='مثال: احذف كلمة "فيلم" من كل عناوين الأفلام ونظف عبارة "مترجم اون لاين بجودة عالية" من النهاية...'
            className="w-full rounded-2xl bg-[#1a242e] border border-white/15 p-4 text-sm text-white placeholder:text-white/40 focus:border-[#f9c400] focus:outline-none leading-relaxed"
          />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs font-bold text-[#b7c9ef] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={regenerateSlugOnRename}
                onChange={(e) => setRegenerateSlugOnRename(e.target.checked)}
                className="h-4 w-4 rounded accent-[#f9c400]"
              />
              <span>تحديث الرابط المختصر (Slug) تلقائياً عند تغيير العنوان</span>
            </label>

            <button
              type="submit"
              disabled={generating || targetedItems.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-[#D92321] to-[#b5141a] hover:brightness-110 disabled:opacity-50 px-6 py-3 text-sm font-extrabold text-white shadow-[0_10px_25px_rgba(217,35,33,0.35)] transition-all cursor-pointer"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    جارٍ معالجة {progressText || `${targetedItems.length} عمل`} بالذكاء الاصطناعي...
                  </span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-[#f9c400]" />
                  <span>معاينة التعديلات بالذكاء الاصطناعي</span>
                </>
              )}
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-[#D92321]/15 border border-[#D92321]/40 p-4 text-xs sm:text-sm font-bold text-white">
            <AlertTriangle className="w-4 h-4 text-[#D92321] shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {noChangeInfo && !errorMsg && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-[#f9c400]/10 border border-[#f9c400]/35 p-4 text-xs sm:text-sm font-bold text-[#f9c400]">
            <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-1 text-white">
              <p className="font-extrabold text-[#f9c400]">نتيجة الفحص:</p>
              <p className="text-xs sm:text-sm text-[#b7c9ef]">{noChangeInfo}</p>
            </div>
          </div>
        )}
      </form>

      {/* Step 3: Preview & Approve Diffs */}
      {proposals.length > 0 && (
        <div className="rounded-3xl bg-[#0c1821] border border-[#f9c400]/30 p-5 sm:p-6 space-y-5 shadow-2xl">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-[#4CAF50]" />
                <h3 className="font-display text-lg font-extrabold text-white">
                  معاينة التعديلات المقترحة ({proposals.length} عمل)
                </h3>
              </div>
              {aiSummary && <p className="text-xs sm:text-sm text-[#b7c9ef]">{aiSummary}</p>}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleSelectAllProposals(true)}
                className="rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3 py-2 text-xs font-bold text-white cursor-pointer"
              >
                تحديد الكل
              </button>
              <button
                type="button"
                onClick={() => handleSelectAllProposals(false)}
                className="rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3 py-2 text-xs font-bold text-[#b7c9ef] cursor-pointer"
              >
                إلغاء التحديد
              </button>
              <button
                type="button"
                onClick={() => {
                  setProposals([]);
                  setAiSummary(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-[#D92321]/20 border border-white/10 px-3 py-2 text-xs font-bold text-[#b7c9ef] hover:text-white cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>تجاهل المعاينة</span>
              </button>
              <button
                type="button"
                disabled={saving || selectedProposalsCount === 0}
                onClick={() => void handleApplyAndSave()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-50 px-5 py-2.5 text-xs sm:text-sm font-extrabold text-white shadow-lg cursor-pointer"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>
                  {saving
                    ? 'جارٍ الحفظ في قاعدة البيانات...'
                    : `اعتماد وحفظ (${selectedProposalsCount}) عمل`}
                </span>
              </button>
            </div>
          </div>

          <div className="space-y-3 max-h-[650px] overflow-y-auto pl-1">
            {proposals.map((entry) => (
              <div
                key={entry.original.id}
                className={`rounded-2xl border p-4 transition-colors ${
                  entry.selected
                    ? 'bg-[#15222d]/90 border-[#4CAF50]/35'
                    : 'bg-[#111b24]/60 border-white/[0.06] opacity-65'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <label className="flex items-center gap-3 cursor-pointer min-w-0">
                    <button
                      type="button"
                      onClick={() => handleToggleProposal(entry.original.id)}
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors cursor-pointer ${
                        entry.selected
                          ? 'bg-[#4CAF50] border-[#4CAF50] text-white'
                          : 'bg-[#0c1821] border-white/25'
                      }`}
                    >
                      {entry.selected && <Check className="w-3.5 h-3.5" />}
                    </button>
                    <Film className="w-4 h-4 text-[#f9c400] shrink-0" />
                    <span className="text-sm font-extrabold text-white truncate">
                      {entry.updated.title}
                    </span>
                    <span className="font-latin rounded-md bg-[#0c1821] px-2 py-0.5 text-[10px] font-bold text-[#b7c9ef]">
                      {entry.changedFields.length} تعديل
                    </span>
                  </label>

                  <button
                    type="button"
                    onClick={() => onPreviewMedia(entry.updated)}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#0c1821] border border-white/10 px-2.5 py-1 text-[11px] font-bold text-[#b7c9ef] hover:text-white hover:border-white/25 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>معاينة</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {entry.changedFields.map((diff) => (
                    <div
                      key={diff.key}
                      className="grid grid-cols-1 lg:grid-cols-12 gap-2 items-center rounded-xl bg-[#0c1821]/80 border border-white/[0.05] p-2.5 text-xs"
                    >
                      <div className="lg:col-span-2 font-extrabold text-[#f9c400]">
                        {diff.label}
                      </div>
                      <div className="lg:col-span-4 rounded-lg bg-[#D92321]/10 border border-[#D92321]/25 px-2.5 py-1.5 text-white/75 line-through break-words">
                        {diff.before}
                      </div>
                      <div className="hidden lg:flex lg:col-span-1 justify-center text-[#b7c9ef]">
                        <ArrowLeft className="w-4 h-4" />
                      </div>
                      <div className="lg:col-span-5 rounded-lg bg-[#4CAF50]/10 border border-[#4CAF50]/30 px-2.5 py-1.5 font-bold text-white break-words">
                        {diff.after}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
