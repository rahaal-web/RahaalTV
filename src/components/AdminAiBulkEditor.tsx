import { FormEvent, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Database,
  Eye,
  Film,
  History,
  Info,
  Loader2,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  Wand2,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  AdminActivityLogEntry,
  appendActivityLog,
  clearActivityLog,
  countMediaInFirestore,
  executeApprovedPlanInDatabase,
  fetchScopedMediaFromFirestore,
  fetchTopMediaFromFirestore,
  hasPlanAlreadyExecuted,
  loadActivityLog,
  loadLastUndoSnapshot,
  undoAssistantBatchInDatabase,
  UndoBatchSnapshot,
} from '../lib/adminAssistantDb';
import {
  buildExecutionPreviewPlan,
  CommandProposalEntry,
  ExecutionPreviewPlan,
  normalizeArabic,
  parseArabicAdminCommand,
} from '../lib/localAdminNlp';
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

const KIND_LABELS: Record<MediaKind, string> = {
  movie: 'فيلم',
  series: 'مسلسل',
  tv: 'برنامج / مسرحية',
  wrestling: 'مصارعة حرة',
};

const QUICK_LOCAL_PRESETS = [
  {
    label: 'حذف كلمة "فيلم" من عناوين الأفلام',
    instruction: 'احذف كلمة "فيلم" من عناوين الأفلام',
  },
  {
    label: 'تنظيف العناوين من الزوائد',
    instruction:
      'أزل العبارات الترويجية الزائدة من العناوين مثل "مترجم اون لاين" و"بجودة عالية" و"مشاهدة وتحميل" واترك عنوان العمل النظيف فقط.',
  },
  {
    label: 'عرض أحدث 10 أفلام',
    instruction: 'اعرض أحدث 10 أفلام',
  },
  {
    label: 'عرض عدد الأفلام والمكتبة',
    instruction: 'اعرض عدد الأفلام الموجودة',
  },
  {
    label: 'توحيد الجودة إلى 1080p WEB-DL',
    instruction: 'حدّث حقل الجودة (quality) لجميع الأعمال المحددة إلى "1080p WEB-DL".',
  },
  {
    label: 'تفعيل شارة "جديد" لأعمال 2026',
    instruction: 'اجعل حقل isNew يساوي true لجميع الأعمال الصادرة في سنة 2026.',
  },
];

function formatTimestamp(ts: number): string {
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    }).format(new Date(ts));
  } catch {
    return '';
  }
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

  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [executing, setExecuting] = useState<boolean>(false);
  const [undoing, setUndoing] = useState<boolean>(false);
  const [awaitingConfirm, setAwaitingConfirm] = useState<boolean>(false);
  const [showActivityLog, setShowActivityLog] = useState<boolean>(true);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewPlan, setPreviewPlan] = useState<ExecutionPreviewPlan | null>(null);
  const [proposals, setProposals] = useState<CommandProposalEntry[]>([]);

  const [lastResult, setLastResult] = useState<{
    message: string;
    operation: 'update' | 'delete' | 'undo';
    count: number;
    canUndo: boolean;
  } | null>(null);

  const [lastUndoSnapshot, setLastUndoSnapshot] = useState<UndoBatchSnapshot | null>(() =>
    loadLastUndoSnapshot()
  );
  const [activityLog, setActivityLog] = useState<AdminActivityLogEntry[]>(() =>
    loadActivityLog()
  );

  const executionLockRef = useRef<boolean>(false);

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

  const recordLog = (entry: Omit<AdminActivityLogEntry, 'id' | 'timestamp'>) => {
    const next = appendActivityLog(entry);
    setActivityLog(next);
  };

  const applySlugOptionsToProposals = (rawProposals: CommandProposalEntry[]) => {
    return rawProposals.map((entry) => {
      if (
        !regenerateSlugOnRename ||
        (entry.updated.title === entry.original.title &&
          entry.updated.englishTitle === entry.original.englishTitle)
      ) {
        return entry;
      }
      const nextSlug = generateCleanSlug(
        entry.updated.englishTitle,
        entry.updated.title,
        entry.original.id
      );
      const nextShortUrl = buildDedicatedMediaUrl({ id: entry.original.id, slug: nextSlug });
      return {
        ...entry,
        updated: {
          ...entry.updated,
          slug: nextSlug,
          shortUrl: nextShortUrl,
        },
      };
    });
  };

  const handleAnalyzeAndPreview = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setAwaitingConfirm(false);
    setLastResult(null);

    const trimmed = instruction.trim();
    if (!trimmed) {
      setErrorMsg('يرجى كتابة الأمر الذي تريد تنفيذه أو استعلامه أولاً.');
      return;
    }

    setAnalyzing(true);
    setPreviewPlan(null);
    setProposals([]);

    try {
      // 1. Parse Arabic command locally (100% Rule-Based NLP, zero external AI)
      const parsed = parseArabicAdminCommand(trimmed, scopeKind);

      if (parsed.blockedReason || parsed.operationType === 'unknown') {
        const blockedPlan = buildExecutionPreviewPlan(parsed, []);
        setPreviewPlan(blockedPlan);
        setErrorMsg(parsed.blockedReason || 'تعذر فهم الأمر.');
        recordLog({
          adminUid: user.uid,
          adminName: user.displayName || user.email || 'مشرف',
          rawCommand: trimmed,
          understoodCommand: parsed.understoodCommand,
          operationType: parsed.operationType,
          operationLabel: parsed.operationLabel,
          affectedCount: 0,
          sampleTitles: [],
          status: 'blocked',
          note: parsed.blockedReason,
        });
        return;
      }

      // 2. Execute optimal database query path (no full dump when Firestore is seeded)
      let scopedPool: MediaItem[] = [];
      let fullStats: ExecutionPreviewPlan['countSummary'] | undefined;

      if (isFirestoreSeeded) {
        if (parsed.operationType === 'query_count' && !scopeSearch.trim() && scopeCategory === 'all') {
          fullStats = await countMediaInFirestore(parsed.filterYear);
          // Fetch up to 12 sample items if filtered by kind/year
          scopedPool = await fetchTopMediaFromFirestore(parsed.scopeKind, 12, 'latest');
        } else if (
          parsed.operationType === 'query_latest' &&
          !parsed.filterYear &&
          !scopeSearch.trim() &&
          scopeCategory === 'all'
        ) {
          scopedPool = await fetchTopMediaFromFirestore(
            parsed.scopeKind,
            parsed.limitCount || 10,
            parsed.sortBy || 'latest'
          );
        } else {
          scopedPool = await fetchScopedMediaFromFirestore({
            scopeKind: parsed.scopeKind !== 'all' ? parsed.scopeKind : scopeKind,
            scopeCategory,
            filterYear: parsed.filterYear,
            maxScan: 1500,
          });
        }
      } else {
        scopedPool = targetedItems;
      }

      // Apply optional UI keyword/category filters on top of DB-scoped pool
      const qNorm = normalizeArabic(scopeSearch).toLowerCase();
      if (scopeCategory !== 'all' || qNorm) {
        scopedPool = scopedPool.filter((item) => {
          if (scopeCategory !== 'all' && !item.categories.includes(scopeCategory)) return false;
          if (qNorm) {
            const t = normalizeArabic(item.title).toLowerCase();
            const eng = normalizeArabic(item.englishTitle).toLowerCase();
            if (!t.includes(qNorm) && !eng.includes(qNorm)) return false;
          }
          return true;
        });
      }

      // 3. Build deterministic preview plan (read-only)
      const plan = buildExecutionPreviewPlan(parsed, scopedPool, fullStats);
      const finalizedProposals = applySlugOptionsToProposals(plan.proposals);
      const finalizedPlan: ExecutionPreviewPlan = {
        ...plan,
        proposals: finalizedProposals,
      };

      setPreviewPlan(finalizedPlan);
      setProposals(finalizedProposals);

      if (parsed.isReadOnly) {
        recordLog({
          adminUid: user.uid,
          adminName: user.displayName || user.email || 'مشرف',
          rawCommand: trimmed,
          understoodCommand: parsed.understoodCommand,
          operationType: parsed.operationType,
          operationLabel: parsed.operationLabel,
          affectedCount: finalizedPlan.affectedCount,
          sampleTitles: finalizedPlan.matchedItems.slice(0, 4).map((i) => i.title),
          status: 'queried',
        });
        onNotify(`تم تنفيذ الاستعلام محلياً بنجاح (${finalizedPlan.affectedCount} نتيجة).`);
      } else if (finalizedProposals.length === 0) {
        onNotify('لم تطابق أي أعمال هذا التعديل — لم تتغير أي بيانات.');
      } else {
        onNotify(
          `تم تجهيز معاينة آمنة على ${finalizedProposals.length} عملًا — راجع التغييرات ثم أكد التنفيذ.`
        );
      }
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'تعذر قراءة البيانات من قاعدة البيانات لتجهيز المعاينة.';
      setErrorMsg(msg);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleToggleProposal = (id: string) => {
    setAwaitingConfirm(false);
    setProposals((prev) =>
      prev.map((p) => (p.original.id === id ? { ...p, selected: !p.selected } : p))
    );
  };

  const handleSelectAllProposals = (selected: boolean) => {
    setAwaitingConfirm(false);
    setProposals((prev) => prev.map((p) => ({ ...p, selected })));
  };

  const handleRequestExecution = () => {
    if (!previewPlan || executing || executionLockRef.current) return;
    if (hasPlanAlreadyExecuted(previewPlan.planId)) {
      setErrorMsg('تم تنفيذ هذه الخطة مسبقاً. اكتب أمراً جديداً إذا رغبت في عملية أخرى.');
      return;
    }

    const approved = proposals.filter((p) => p.selected);
    if (approved.length === 0) {
      onNotify('يرجى تحديد عمل واحد على الأقل للتنفيذ.');
      return;
    }

    // Require explicit two-step confirmation for ANY destructive delete or bulk (>1 item) mutation
    const needsConfirm =
      previewPlan.command.isDestructive ||
      previewPlan.command.requiresConfirmation ||
      approved.length > 1;

    if (needsConfirm && !awaitingConfirm) {
      setAwaitingConfirm(true);
      return;
    }

    void executeConfirmedBatch(approved);
  };

  const executeConfirmedBatch = async (approved: CommandProposalEntry[]) => {
    if (!previewPlan || executionLockRef.current) return;
    if (hasPlanAlreadyExecuted(previewPlan.planId)) return;

    executionLockRef.current = true;
    setExecuting(true);
    setErrorMsg(null);

    try {
      const result = await executeApprovedPlanInDatabase({
        planId: previewPlan.planId,
        command: previewPlan.command,
        approvedProposals: approved.map((p) => ({ original: p.original, updated: p.updated })),
        fullCatalogFallback: catalog,
        isFirestoreSeeded,
        uid: user.uid,
      });

      setLastUndoSnapshot(result.undoSnapshot);
      setAwaitingConfirm(false);
      setProposals([]);

      const successText =
        result.operation === 'delete'
          ? `تم حذف ${result.affectedCount} عملًا من قاعدة البيانات بنجاح.`
          : `تم تنفيذ التعديل وحفظ ${result.affectedCount} عملًا في قاعدة بيانات الموقع بنجاح.`;

      setLastResult({
        message: successText,
        operation: result.operation,
        count: result.affectedCount,
        canUndo: true,
      });

      recordLog({
        adminUid: user.uid,
        adminName: user.displayName || user.email || 'مشرف',
        rawCommand: previewPlan.command.rawInput,
        understoodCommand: previewPlan.command.understoodCommand,
        operationType: previewPlan.command.operationType,
        operationLabel: previewPlan.command.operationLabel,
        affectedCount: result.affectedCount,
        sampleTitles: approved.slice(0, 5).map((p) => p.original.title),
        status: 'executed',
      });

      onNotify(successText);
      onSavedToCatalog?.();
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'حدث خطأ أثناء تنفيذ العملية على قاعدة البيانات. تأكد من صلاحيات المشرف.';
      setErrorMsg(msg);
      recordLog({
        adminUid: user.uid,
        adminName: user.displayName || user.email || 'مشرف',
        rawCommand: previewPlan.command.rawInput,
        understoodCommand: previewPlan.command.understoodCommand,
        operationType: previewPlan.command.operationType,
        operationLabel: previewPlan.command.operationLabel,
        affectedCount: 0,
        sampleTitles: [],
        status: 'failed',
        note: msg,
      });
    } finally {
      executionLockRef.current = false;
      setExecuting(false);
    }
  };

  const handleUndoLastOperation = async () => {
    if (!lastUndoSnapshot || undoing || executionLockRef.current) return;
    executionLockRef.current = true;
    setUndoing(true);
    setErrorMsg(null);

    try {
      const restoredCount = await undoAssistantBatchInDatabase(lastUndoSnapshot, user.uid);
      const msg =
        lastUndoSnapshot.action === 'delete'
          ? `تم التراجع عن الحذف واستعادة ${restoredCount} عملًا إلى قاعدة البيانات!`
          : `تم التراجع عن آخر تعديل واسترجاع البيانات السابقة لـ ${restoredCount} عملًا!`;

      recordLog({
        adminUid: user.uid,
        adminName: user.displayName || user.email || 'مشرف',
        rawCommand: `تراجع عن: ${lastUndoSnapshot.commandText}`,
        understoodCommand: `استرجاع النسخة السابقة قبل (${lastUndoSnapshot.operationLabel})`,
        operationType: 'undo',
        operationLabel: 'تراجع عن آخر عملية',
        affectedCount: restoredCount,
        sampleTitles: lastUndoSnapshot.beforeItems.slice(0, 5).map((i) => i.title),
        status: 'undone',
      });

      setLastUndoSnapshot(null);
      setLastResult({
        message: msg,
        operation: 'undo',
        count: restoredCount,
        canUndo: false,
      });
      onNotify(msg);
      onSavedToCatalog?.();
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'تعذر التراجع عن العملية السابقة.';
      setErrorMsg(msg);
    } finally {
      executionLockRef.current = false;
      setUndoing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Intro Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-l from-[#102131] via-[#0c1821] to-[#1a1322] border border-white/[0.1] p-6 shadow-xl">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-[#f9c400] via-[#D92321] to-[#4CAF50]" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 rounded-xl bg-[#4CAF50]/15 border border-[#4CAF50]/35 px-3 py-1 text-xs font-black text-[#4CAF50]">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>محرك إدارة ذكي محلي 100% — بدون أي API خارجي</span>
            </div>
            <h2 className="font-display text-xl sm:text-2xl font-extrabold text-white">
              مساعد الإدارة الذكي المحلي (Local Admin Assistant)
            </h2>
            <p className="text-xs sm:text-sm text-[#b7c9ef] max-w-2xl leading-relaxed">
              اكتب أوامرك باللغة العربية مباشرة — مثل حذف كلمة &laquo;فيلم&raquo; من العناوين، تغيير
              اسم فيلم محدد، البحث والإحصائيات، إدارة المواسم والحلقات، أو التعديل الجماعي الآمن
              مع معاينة قبل التنفيذ وإمكانية التراجع.
            </p>
          </div>
          <div className="shrink-0 rounded-2xl bg-[#15222d] border border-white/10 px-4 py-3 text-center">
            <p className="font-latin text-2xl font-black text-[#f9c400]">{targetedItems.length}</p>
            <p className="text-[11px] font-bold text-[#b7c9ef]">عمل ضمن النطاق الحالي</p>
          </div>
        </div>
      </div>

      {/* Execution Result Banner + Quick Undo */}
      {lastResult && (
        <div className="rounded-3xl bg-[#4CAF50]/10 border border-[#4CAF50]/40 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-[#4CAF50] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-extrabold text-white">نتيجة العملية المنفذة</p>
              <p className="text-xs sm:text-sm text-[#b7c9ef]">{lastResult.message}</p>
            </div>
          </div>

          {lastResult.canUndo && lastUndoSnapshot && (
            <button
              type="button"
              disabled={undoing}
              onClick={() => void handleUndoLastOperation()}
              className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-[#f9c400] hover:bg-[#eab308] disabled:opacity-50 px-4 py-2.5 text-xs font-black text-[#06131c] shadow-md cursor-pointer"
            >
              {undoing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Undo2 className="w-4 h-4" />
              )}
              <span>تراجع عن آخر عملية ({lastUndoSnapshot.beforeItems.length})</span>
            </button>
          )}
        </div>
      )}

      {/* Persistent Undo Bar if snapshot exists even after refresh */}
      {!lastResult && lastUndoSnapshot && (
        <div className="rounded-2xl bg-[#15222d] border border-[#f9c400]/30 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-[#b7c9ef]">
            <History className="w-4 h-4 text-[#f9c400] shrink-0" />
            <span>
              آخر عملية قابلة للتراجع:{' '}
              <strong className="text-white">{lastUndoSnapshot.operationLabel}</strong> (
              {lastUndoSnapshot.beforeItems.length} عمل) — {formatTimestamp(lastUndoSnapshot.timestamp)}
            </span>
          </div>
          <button
            type="button"
            disabled={undoing}
            onClick={() => void handleUndoLastOperation()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#f9c400]/15 hover:bg-[#f9c400] border border-[#f9c400]/40 px-3.5 py-1.5 text-xs font-extrabold text-[#f9c400] hover:text-[#06131c] transition-colors cursor-pointer"
          >
            {undoing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
            <span>التراجع عن هذه العملية</span>
          </button>
        </div>
      )}

      {/* Scope & Command Form */}
      <form
        onSubmit={handleAnalyzeAndPreview}
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
            <span>اكتب الأمر الإداري باللغة العربية</span>
          </h3>

          {/* Quick Preset Chips */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-[#b7c9ef]">أوامر جاهزة سريعة (اضغط للتعبئة):</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_LOCAL_PRESETS.map((preset) => (
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
            placeholder='أمثلة: احذف كلمة "فيلم" من عناوين الأفلام • غير اسم الفيلم من "الرجل الهارب" إلى "المطارد" • احذف جميع المسلسلات التي تحتوي على كلمة "تجريبي" • اعرض أحدث 10 أفلام'
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
              disabled={analyzing}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-[#D92321] to-[#b5141a] hover:brightness-110 disabled:opacity-50 px-6 py-3 text-sm font-extrabold text-white shadow-[0_10px_25px_rgba(217,35,33,0.35)] transition-all cursor-pointer"
            >
              {analyzing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>جارٍ تحليل الأمر وفحص قاعدة البيانات محلياً...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-[#f9c400]" />
                  <span>تحليل الأمر ومعاينة النتيجة</span>
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
      </form>

      {/* Step 3: Understood Command + Operation Type + Affected Count + Preview */}
      {previewPlan && previewPlan.command.operationType !== 'unknown' && (
        <div className="rounded-3xl bg-[#0c1821] border border-[#f9c400]/30 p-5 sm:p-6 space-y-5 shadow-2xl">
          {/* Structured Understanding Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-2xl bg-[#15222d] border border-white/[0.07] p-3.5 space-y-1">
              <span className="text-[11px] font-bold text-[#b7c9ef]">الأمر الذي فهمه المساعد</span>
              <p className="text-xs sm:text-sm font-extrabold text-white leading-relaxed">
                {previewPlan.command.understoodCommand}
              </p>
            </div>
            <div className="rounded-2xl bg-[#15222d] border border-white/[0.07] p-3.5 space-y-1">
              <span className="text-[11px] font-bold text-[#b7c9ef]">نوع العملية</span>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-black ${
                    previewPlan.command.isDestructive
                      ? 'bg-[#D92321]/20 text-[#ff6b69] border border-[#D92321]/40'
                      : previewPlan.command.isReadOnly
                        ? 'bg-[#4CAF50]/15 text-[#4CAF50] border border-[#4CAF50]/35'
                        : 'bg-[#f9c400]/15 text-[#f9c400] border border-[#f9c400]/35'
                  }`}
                >
                  {previewPlan.command.isDestructive ? (
                    <Trash2 className="w-3.5 h-3.5" />
                  ) : previewPlan.command.isReadOnly ? (
                    <Database className="w-3.5 h-3.5" />
                  ) : (
                    <Wand2 className="w-3.5 h-3.5" />
                  )}
                  <span>{previewPlan.command.operationLabel}</span>
                </span>
              </div>
            </div>
            <div className="rounded-2xl bg-[#15222d] border border-white/[0.07] p-3.5 space-y-1">
              <span className="text-[11px] font-bold text-[#b7c9ef]">عدد العناصر المتأثرة / المطابقة</span>
              <p className="font-latin text-xl font-black text-[#f9c400]">
                {previewPlan.affectedCount}{' '}
                <span className="text-xs font-bold text-[#b7c9ef]">
                  (من أصل {previewPlan.scannedCount} تم فحصها)
                </span>
              </p>
            </div>
          </div>

          {/* No Change / Empty Result Info */}
          {previewPlan.noChangeReason && (
            <div className="flex items-start gap-2.5 rounded-2xl bg-[#f9c400]/10 border border-[#f9c400]/35 p-4 text-xs sm:text-sm font-bold text-white">
              <Info className="w-4 h-4 text-[#f9c400] shrink-0 mt-0.5" />
              <span>{previewPlan.noChangeReason}</span>
            </div>
          )}

          {/* Read-Only: Count Aggregation Display */}
          {previewPlan.countSummary && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: 'إجمالي المكتبة', value: previewPlan.countSummary.total, accent: 'text-[#f9c400]' },
                { label: 'الأفلام', value: previewPlan.countSummary.movies, accent: 'text-white' },
                { label: 'المسلسلات', value: previewPlan.countSummary.series, accent: 'text-white' },
                { label: 'البرامج والمسرحيات', value: previewPlan.countSummary.tv, accent: 'text-white' },
                { label: 'المصارعة الحرة', value: previewPlan.countSummary.wrestling, accent: 'text-white' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-2xl bg-[#15222d] border border-white/10 p-4 text-center"
                >
                  <p className={`font-latin text-2xl font-black ${stat.accent}`}>{stat.value}</p>
                  <p className="text-[11px] font-bold text-[#b7c9ef] mt-1">{stat.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Read-Only: Matched / Latest Items List */}
          {previewPlan.command.isReadOnly && previewPlan.matchedItems.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-xs sm:text-sm font-extrabold text-white">
                نتائج الاستعلام ({previewPlan.matchedItems.length} عنصر):
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[520px] overflow-y-auto pl-1">
                {previewPlan.matchedItems.map((item, idx) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-2xl bg-[#15222d] border border-white/[0.08] p-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-latin flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0c1821] text-xs font-black text-[#f9c400]">
                        {idx + 1}
                      </span>
                      <img
                        src={item.poster}
                        alt={item.title}
                        className="h-12 w-9 rounded-lg object-cover bg-[#0c1821] shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-extrabold text-white truncate">
                          {item.title}
                        </p>
                        <p className="text-[11px] text-[#b7c9ef] truncate">
                          {KIND_LABELS[item.kind]} • {item.year} • {item.quality} • IMDb{' '}
                          {item.imdb.toFixed(1)}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onPreviewMedia(item)}
                      className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-[#0c1821] border border-white/10 px-2.5 py-1.5 text-[11px] font-bold text-[#b7c9ef] hover:text-white cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>معاينة</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mutation Preview & Approval Controls */}
          {!previewPlan.command.isReadOnly && proposals.length > 0 && (
            <>
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-[#4CAF50]" />
                    <h3 className="font-display text-lg font-extrabold text-white">
                      معاينة التغييرات قبل التنفيذ ({proposals.length} عمل)
                    </h3>
                  </div>
                  <p className="text-xs text-[#b7c9ef]">
                    راجع القيم قبل وبعد التعديل، ويمكنك إلغاء تحديد أي عنصر لا تريد شموله.
                  </p>
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
                      setPreviewPlan(null);
                      setAwaitingConfirm(false);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-[#D92321]/20 border border-white/10 px-3 py-2 text-xs font-bold text-[#b7c9ef] hover:text-white cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>تجاهل المعاينة</span>
                  </button>
                  <button
                    type="button"
                    disabled={executing || selectedProposalsCount === 0}
                    onClick={handleRequestExecution}
                    className={`inline-flex items-center gap-2 rounded-xl disabled:opacity-50 px-5 py-2.5 text-xs sm:text-sm font-extrabold text-white shadow-lg cursor-pointer ${
                      previewPlan.command.isDestructive
                        ? 'bg-[#D92321] hover:bg-[#b5141a]'
                        : 'bg-[#4CAF50] hover:bg-[#43a047]'
                    }`}
                  >
                    {executing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : previewPlan.command.isDestructive ? (
                      <Trash2 className="w-4 h-4" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    <span>
                      {executing
                        ? 'جارٍ التنفيذ في قاعدة البيانات...'
                        : previewPlan.command.isDestructive
                          ? `حذف (${selectedProposalsCount}) عمل`
                          : `تنفيذ وحفظ (${selectedProposalsCount}) عمل`}
                    </span>
                  </button>
                </div>
              </div>

              {/* Explicit Confirmation Box for Sensitive / Bulk / Delete Operations */}
              {awaitingConfirm && (
                <div className="rounded-2xl bg-[#D92321]/15 border-2 border-[#D92321]/60 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <ShieldAlert className="w-6 h-6 text-[#f9c400] shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-sm font-extrabold text-white">
                        تأكيد العملية الحساسة قبل الكتابة في قاعدة البيانات
                      </p>
                      <p className="text-xs text-[#b7c9ef] leading-relaxed">
                        أنت على وشك{' '}
                        <strong className="text-white">
                          {previewPlan.command.isDestructive ? 'حذف' : 'تعديل'} {selectedProposalsCount}{' '}
                          عمل
                        </strong>{' '}
                        ({previewPlan.command.operationLabel}). سيتم حفظ نسخة احتياطية فورية لإتاحة
                        التراجع بعد التنفيذ.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={executing}
                      onClick={() => setAwaitingConfirm(false)}
                      className="rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/15 px-4 py-2 text-xs font-bold text-white cursor-pointer"
                    >
                      إلغاء
                    </button>
                    <button
                      type="button"
                      disabled={executing}
                      onClick={() => void executeConfirmedBatch(proposals.filter((p) => p.selected))}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#D92321] hover:bg-[#f40612] px-5 py-2 text-xs font-black text-white shadow-lg cursor-pointer"
                    >
                      {executing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="w-4 h-4" />
                      )}
                      <span>نعم، تأكيد التنفيذ الآن</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Diff Proposals List */}
              <div className="space-y-3 max-h-[650px] overflow-y-auto pl-1">
                {proposals.map((entry) => (
                  <div
                    key={entry.original.id}
                    className={`rounded-2xl border p-4 transition-colors ${
                      entry.selected
                        ? previewPlan.command.isDestructive
                          ? 'bg-[#251319]/80 border-[#D92321]/45'
                          : 'bg-[#15222d]/90 border-[#4CAF50]/35'
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
                          {entry.changedFields.length} تغيير
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
            </>
          )}
        </div>
      )}

      {/* Admin Activity Log */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setShowActivityLog((v) => !v)}
            className="flex items-center gap-2 text-sm sm:text-base font-extrabold text-white cursor-pointer"
          >
            <History className="w-4 h-4 text-[#f9c400]" />
            <span>سجل نشاطات المساعد الإداري ({activityLog.length})</span>
          </button>

          {activityLog.length > 0 && (
            <button
              type="button"
              onClick={() => setActivityLog(clearActivityLog())}
              className="rounded-xl bg-[#1a242e] hover:bg-[#D92321]/20 border border-white/10 px-3 py-1.5 text-[11px] font-bold text-[#b7c9ef] hover:text-white cursor-pointer"
            >
              مسح السجل
            </button>
          )}
        </div>

        {showActivityLog && (
          <>
            {activityLog.length === 0 ? (
              <p className="text-xs text-[#b7c9ef]">
                لم يتم تسجيل أي عمليات بعد. كل أمر يتم تنفيذه أو استعلامه سيظهر هنا مع التفاصيل.
              </p>
            ) : (
              <div className="space-y-2 max-h-[340px] overflow-y-auto pl-1">
                {activityLog.slice(0, 30).map((log) => (
                  <div
                    key={log.id}
                    className="rounded-2xl bg-[#15222d]/80 border border-white/[0.06] p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-black ${
                            log.status === 'executed'
                              ? 'bg-[#4CAF50]/20 text-[#4CAF50]'
                              : log.status === 'undone'
                                ? 'bg-[#f9c400]/20 text-[#f9c400]'
                                : log.status === 'blocked' || log.status === 'failed'
                                  ? 'bg-[#D92321]/20 text-[#ff6b69]'
                                  : 'bg-white/10 text-[#b7c9ef]'
                          }`}
                        >
                          {log.operationLabel}
                        </span>
                        <span className="font-bold text-white truncate">{log.rawCommand}</span>
                      </div>
                      <p className="text-[11px] text-[#b7c9ef]">
                        {log.understoodCommand} • المتأثر:{' '}
                        <strong className="text-white">{log.affectedCount}</strong>
                        {log.sampleTitles.length > 0
                          ? ` • أمثلة: ${log.sampleTitles.join('، ')}`
                          : ''}
                        {log.note ? ` • ملاحظة: ${log.note}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-[#b7c9ef] shrink-0">
                      <Clock className="w-3 h-3" />
                      <span>{formatTimestamp(log.timestamp)}</span>
                      <span>• {log.adminName}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
