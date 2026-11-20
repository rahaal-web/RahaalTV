import { ChangeEvent, FormEvent, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Code2,
  Download,
  Edit3,
  Eye,
  FileCode2,
  FlaskConical,
  Globe,
  History,
  Layers,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import { User } from 'firebase/auth';
import {
  getCustomApiBaseUrl,
  resolveApiEndpoint,
  shouldSkipBackendApiCalls,
} from '../lib/clientScraper';
import {
  analyzeSiteStructureInBrowser,
  testAdapterCandidateInBrowser,
} from '../lib/clientAdapterEngine';
import {
  buildAdapterIdFromDomain,
  createDefaultScraperAdapter,
  exportAdaptersBundleJson,
  matchAdapterForUrl,
  normalizeAdapterDomain,
  normalizeScraperAdapter,
  parseImportedAdaptersJson,
} from '../lib/scraperAdapterUtils';
import {
  deleteScraperAdapter,
  fetchAdapterVersions,
  saveScraperAdapterWithVersion,
  toggleScraperAdapterEnabled,
} from '../lib/scraperAdaptersDb';
import {
  AdapterContentTypeHint,
  AdapterStatus,
  AdapterVerifyMode,
  DiagnosticSeverity,
  ScraperAdapter,
  ScraperAdapterVersionRecord,
  ScraperSiteAnalysisReport,
  ScraperTestResult,
} from '../types/scraperAdapter';

interface ScraperAdapterBuilderPanelProps {
  user: User | null;
  adapters: ScraperAdapter[];
  cloudSynced: boolean;
  onAdaptersChanged?: (next: ScraperAdapter[]) => void;
  onOpenInSingleScraper?: (url: string) => void;
  onNotify: (msg: string) => void;
}

const STATUS_META: Record<
  AdapterStatus,
  { label: string; textCls: string; dotCls: string }
> = {
  supported: {
    label: 'مدعوم',
    textCls: 'text-[#4CAF50]',
    dotCls: 'bg-[#4CAF50]',
  },
  needs_fix: {
    label: 'يحتاج إصلاحاً',
    textCls: 'text-[#f9c400]',
    dotCls: 'bg-[#f9c400]',
  },
  failed: {
    label: 'فشل التحليل',
    textCls: 'text-[#ff7b79]',
    dotCls: 'bg-[#D92321]',
  },
};

const CONTENT_TYPE_OPTIONS: { id: AdapterContentTypeHint; label: string }[] = [
  { id: 'auto', label: 'اكتشاف تلقائي' },
  { id: 'series', label: 'مسلسل' },
  { id: 'movie', label: 'فيلم' },
  { id: 'episode', label: 'صفحة حلقة' },
];

const SEVERITY_META: Record<
  DiagnosticSeverity,
  { label: string; textCls: string; borderCls: string }
> = {
  critical: {
    label: 'سبب حرج',
    textCls: 'text-[#ff8a88]',
    borderCls: 'border-[#D92321]/40 bg-[#D92321]/10',
  },
  warning: {
    label: 'تنبيه بنية',
    textCls: 'text-[#f9c400]',
    borderCls: 'border-[#f9c400]/35 bg-[#f9c400]/5',
  },
  info: {
    label: 'معلومة تقنية',
    textCls: 'text-sky-300',
    borderCls: 'border-sky-400/30 bg-sky-500/5',
  },
};

function formatShortDate(ms?: number | string): string {
  if (!ms) return '—';
  const d = typeof ms === 'number' ? new Date(ms) : new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ScraperAdapterBuilderPanel({
  user,
  adapters,
  cloudSynced,
  onAdaptersChanged,
  onOpenInSingleScraper,
  onNotify,
}: ScraperAdapterBuilderPanelProps) {
  const actorUid = user?.uid || 'master-admin';
  // Input & Analysis Form State
  const [targetUrl, setTargetUrl] = useState('');
  const [contentTypeHint, setContentTypeHint] = useState<AdapterContentTypeHint>('auto');
  const [showRawHtmlBox, setShowRawHtmlBox] = useState(false);
  const [rawHtml, setRawHtml] = useState('');

  // Active Workflow State
  const [analyzing, setAnalyzing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);

  const [analysisReport, setAnalysisReport] = useState<ScraperSiteAnalysisReport | null>(null);
  const [candidateAdapter, setCandidateAdapter] = useState<ScraperAdapter | null>(null);
  const [editingBaseAdapter, setEditingBaseAdapter] = useState<ScraperAdapter | null>(null);
  const [testResult, setTestResult] = useState<ScraperTestResult | null>(null);

  // Rules Editor & Preview Subtabs
  const [showRulesEditor, setShowRulesEditor] = useState(false);
  const [rulesSubTab, setRulesSubTab] = useState<
    'basic' | 'episodes' | 'servers' | 'navigation'
  >('basic');
  const [previewSubTab, setPreviewSubTab] = useState<'episodes' | 'issues' | 'media'>('episodes');

  // Confirmation & Saving State
  const [saveStatusOverride, setSaveStatusOverride] = useState<AdapterStatus>('needs_fix');
  const [changeNote, setChangeNote] = useState('');
  const [confirmOverwriteChecked, setConfirmOverwriteChecked] = useState(false);

  // List Filter & Search
  const [listSearch, setListSearch] = useState('');
  const [listStatusFilter, setListStatusFilter] = useState<'all' | AdapterStatus>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Version History Drawer/Modal
  const [historyAdapter, setHistoryAdapter] = useState<ScraperAdapter | null>(null);
  const [historyVersions, setHistoryVersions] = useState<ScraperAdapterVersionRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // JSON Import Modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [importingJson, setImportingJson] = useState(false);

  // Match existing adapter from typed URL automatically
  const matchedExistingFromUrl = useMemo(() => {
    if (!targetUrl.trim()) return null;
    return matchAdapterForUrl(targetUrl.trim(), adapters, { includeDisabled: true });
  }, [targetUrl, adapters]);

  const filteredAdapters = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return adapters.filter((adp) => {
      if (listStatusFilter !== 'all' && adp.status !== listStatusFilter) return false;
      if (!q) return true;
      return (
        adp.name.toLowerCase().includes(q) ||
        adp.domain.toLowerCase().includes(q) ||
        adp.id.toLowerCase().includes(q) ||
        adp.domainAliases.some((al) => al.toLowerCase().includes(q))
      );
    });
  }, [adapters, listSearch, listStatusFilter]);

  const statusCounts = useMemo(() => {
    const counts = { all: adapters.length, supported: 0, needs_fix: 0, failed: 0 };
    adapters.forEach((a) => {
      counts[a.status] += 1;
    });
    return counts;
  }, [adapters]);

  const hasCustomWorker = Boolean(getCustomApiBaseUrl());
  const isStaticBrowserMode = shouldSkipBackendApiCalls();

  // 1. Analyze Site Structure (Backend when available, Browser/Worker/CORS engine on GitHub Pages)
  const runAnalyzeSite = async (e?: FormEvent) => {
    e?.preventDefault();
    setWorkflowError(null);
    if (!targetUrl.trim() && rawHtml.trim().length < 30) {
      setWorkflowError('يرجى إدخال رابط الموقع أولاً أو لصق كود HTML.');
      return;
    }

    setAnalyzing(true);
    setTestResult(null);
    setConfirmOverwriteChecked(false);

    try {
      let data: ScraperSiteAnalysisReport | null = null;
      let usedBackend = false;

      if (!shouldSkipBackendApiCalls()) {
        try {
          const response = await fetch(resolveApiEndpoint('/api/adapters/analyze'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: targetUrl.trim() || undefined,
              rawHtml: rawHtml.trim().length > 30 ? rawHtml : undefined,
              contentTypeHint,
              existingAdapters: adapters,
            }),
          });
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const json = (await response.json()) as ScraperSiteAnalysisReport & {
              service?: string;
            };
            const isRealAnalyzeApi =
              Boolean(json && typeof json === 'object') &&
              json.service !== 'RahaL TV Proxy Worker' &&
              ('proposedAdapter' in json || 'diagnostics' in json);
            if (isRealAnalyzeApi) {
              data = json;
              usedBackend = true;
            }
          }
        } catch {
          // Static hosting or unreachable backend -> fall back seamlessly to browser engine
        }
      }

      if (!usedBackend || !data) {
        data = await analyzeSiteStructureInBrowser({
          url: targetUrl.trim(),
          rawHtml: rawHtml.trim().length > 30 ? rawHtml : undefined,
          contentTypeHint,
          existingAdapters: adapters,
        });
      }

      setAnalysisReport(data);

      const existingMatch = data.matchedExistingAdapterId
        ? adapters.find((a) => a.id === data.matchedExistingAdapterId) || matchedExistingFromUrl
        : matchedExistingFromUrl;

      setEditingBaseAdapter(existingMatch || null);

      const proposed = normalizeScraperAdapter(data.proposedAdapter);
      setCandidateAdapter(proposed);
      setSaveStatusOverride(proposed.status);
      setChangeNote(
        existingMatch
          ? `تحديث وتحسين القواعد بناءً على تحليل ${data.domain}`
          : `إنشاء أولي لـ ${data.domain}`
      );
      setShowRulesEditor(true);

      if (!data.ok) {
        setWorkflowError(data.error || 'فشل تحليل الصفحة المستهدفة — راجع التقرير التشخيصي.');
      } else {
        onNotify(
          `تم تحليل ${data.domain} (${usedBackend ? 'الخادم' : 'محرك المتصفح'}) واكتشاف ${data.diagnostics.length} ملاحظات تقنية — يمكنك الآن اختبار الجلب قبل الحفظ.`
        );
      }
    } catch (err) {
      setWorkflowError(
        err instanceof Error ? err.message : 'تعذر تحليل بنية الموقع المستهدف.'
      );
    } finally {
      setAnalyzing(false);
    }
  };

  // 2. Create / Build Support Candidate (or Update Existing) without saving immediately
  const handleCreateOrPrepareCandidate = async () => {
    setWorkflowError(null);
    if (!targetUrl.trim() && !candidateAdapter && rawHtml.trim().length < 30) {
      setWorkflowError('أدخل رابط الموقع أو قم بتحليله أولاً لإنشاء مسودة الـ Adapter.');
      return;
    }
    if (!analysisReport && targetUrl.trim()) {
      await runAnalyzeSite();
      return;
    }
    const base =
      candidateAdapter ||
      createDefaultScraperAdapter(
        targetUrl.trim() || 'custom-site',
        targetUrl.trim(),
        contentTypeHint
      );
    const existing =
      editingBaseAdapter ||
      (targetUrl.trim() ? matchAdapterForUrl(targetUrl.trim(), adapters, { includeDisabled: true }) : null);
    setEditingBaseAdapter(existing);
    setCandidateAdapter(
      normalizeScraperAdapter({
        ...base,
        sampleUrl: targetUrl.trim() || base.sampleUrl,
        contentTypeHint,
        version: existing ? existing.version + 1 : base.version,
      })
    );
    setShowRulesEditor(true);
    onNotify('تم تجهيز مسودة قواعد الـ Adapter — نفّذ "اختبار الجلب" للتحقق من النتائج قبل الاعتماد.');
  };

  // 3. Test Candidate Adapter BEFORE Saving (Backend when available, Browser/Worker engine on GitHub Pages)
  const runTestCandidate = async (overrideAdapter?: ScraperAdapter, overrideUrl?: string) => {
    setWorkflowError(null);
    const urlToTest = (overrideUrl ?? targetUrl).trim() || overrideAdapter?.sampleUrl || '';
    if (!urlToTest && rawHtml.trim().length < 30) {
      setWorkflowError('يرجى إدخال رابط صفحة الاختبار أولاً.');
      return;
    }

    const existing =
      editingBaseAdapter ||
      (urlToTest ? matchAdapterForUrl(urlToTest, adapters, { includeDisabled: true }) : null);

    let adapterToTest = overrideAdapter || candidateAdapter;
    if (!adapterToTest) {
      adapterToTest = existing
        ? normalizeScraperAdapter({ ...existing, version: existing.version + 1 })
        : createDefaultScraperAdapter(urlToTest || 'custom-site', urlToTest, contentTypeHint);
      setCandidateAdapter(adapterToTest);
      setEditingBaseAdapter(existing);
    }

    setTesting(true);
    setConfirmOverwriteChecked(false);

    try {
      let result: ScraperTestResult | null = null;
      let usedBackend = false;

      if (!shouldSkipBackendApiCalls()) {
        try {
          const response = await fetch(resolveApiEndpoint('/api/adapters/test'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: urlToTest || undefined,
              rawHtml: rawHtml.trim().length > 30 ? rawHtml : undefined,
              adapter: adapterToTest,
              previousAdapter: existing && existing.id === adapterToTest.id ? existing : undefined,
              contentTypeHint,
            }),
          });
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const json = (await response.json()) as Partial<ScraperTestResult> & {
              error?: string;
              service?: string;
            };
            const isRealTestApi =
              Boolean(json && typeof json === 'object') &&
              json.service !== 'RahaL TV Proxy Worker' &&
              ('episodesDiscovered' in json ||
                'testedAt' in json ||
                (!response.ok && typeof json.error === 'string'));
            if (isRealTestApi) {
              if (!response.ok && !json.testedAt) {
                setWorkflowError(json.error || 'فشل تشغيل الاختبار.');
                return;
              }
              result = json as ScraperTestResult;
              usedBackend = true;
            }
          }
        } catch {
          // Static hosting or unreachable backend -> fall back seamlessly to browser engine
        }
      }

      if (!usedBackend || !result) {
        result = await testAdapterCandidateInBrowser({
          url: urlToTest,
          rawHtml: rawHtml.trim().length > 30 ? rawHtml : undefined,
          adapter: adapterToTest,
          previousAdapter: existing && existing.id === adapterToTest.id ? existing : undefined,
          contentTypeHint,
        });
      }

      setTestResult(result);
      setSaveStatusOverride(result.recommendedStatus);
      setCandidateAdapter((prev) =>
        prev
          ? {
              ...prev,
              status: result.recommendedStatus,
              lastTestSummary: {
                testedUrl: result.testedUrl,
                contentTypeTested: result.contentTypeHint,
                episodesDiscovered: result.episodesDiscovered,
                totalServersExtracted: result.totalServersExtracted,
                avgServersPerEpisode: result.avgServersPerEpisode,
                minServersPerEpisode: result.minServersPerEpisode,
                maxServersPerEpisode: result.maxServersPerEpisode,
                missingEpisodesCount: result.missingEpisodes.length,
                failedServersCount: result.failedServers.length,
                visibleEpisodesHint: result.visibleComparison.visibleEpisodesHint,
                visibleServersHint: result.visibleComparison.visibleServersHint,
                recommendedStatus: result.recommendedStatus,
                summaryText: result.recommendedStatusReason,
                testedAt: result.testedAt,
              },
            }
          : prev
      );

      if (result.missingEpisodes.length > 0 || result.failedServers.length > 0) {
        setPreviewSubTab('issues');
      } else {
        setPreviewSubTab('episodes');
      }

      onNotify(
        `اكتمل الاختبار (${usedBackend ? 'الخادم' : 'المتصفح'}): ${result.episodesDiscovered} حلقة • ${result.totalServersExtracted} سيرفر (الحالة المقترحة: ${STATUS_META[result.recommendedStatus].label})`
      );
    } catch (err) {
      setWorkflowError(
        err instanceof Error ? err.message : 'تعذر إتمام اختبار الجلب.'
      );
    } finally {
      setTesting(false);
    }
  };

  // 4. Approve & Persist Candidate Adapter
  const handleSaveAndApproveAdapter = async () => {
    if (!candidateAdapter) return;
    if (!testResult) {
      setWorkflowError('يجب تشغيل "اختبار الجلب" ومراجعة المعاينة قبل حفظ وتفعيل الـ Adapter.');
      return;
    }

    const isUpdateExisting = Boolean(
      editingBaseAdapter && adapters.some((a) => a.id === editingBaseAdapter.id)
    );

    if (isUpdateExisting && !confirmOverwriteChecked) {
      setWorkflowError(
        'الرجاء تأكيد مربع المراجعة أدناه قبل استبدال قواعد الـ Adapter السابق.'
      );
      return;
    }

    // Enforce honesty if site wasn't fully verified
    if (
      saveStatusOverride === 'supported' &&
      testResult.visibleComparison.completenessVerdict !== 'complete'
    ) {
      setWorkflowError(
        'تنبيه النزاهة: لا يُنصح بوسم الموقع كـ "مدعوم" بالكامل بينما لم تكتمل الحلقات أو السيرفرات الممكن الوصول إليها. اختر "يحتاج إصلاحاً" أو أصلح القواعد ثم أعد الاختبار.'
      );
      return;
    }

    setSaving(true);
    setWorkflowError(null);
    try {
      const toSave = normalizeScraperAdapter({
        ...candidateAdapter,
        status: saveStatusOverride,
      });
      const res = await saveScraperAdapterWithVersion({
        adapter: toSave,
        uid: actorUid,
        isNew: !isUpdateExisting,
        changeNote:
          changeNote.trim() ||
          (isUpdateExisting ? `تحديث من اختبار ${testResult.testedUrl}` : 'اعتماد أولي بعد الاختبار'),
        previousAdapter: editingBaseAdapter,
      });

      const nextList = [
        res.adapter,
        ...adapters.filter((a) => a.id !== res.adapter.id),
      ];
      onAdaptersChanged?.(nextList);
      setEditingBaseAdapter(res.adapter);
      setCandidateAdapter(res.adapter);
      setConfirmOverwriteChecked(false);

      onNotify(
        `تم حفظ الـ Adapter "${res.adapter.name}" (v${res.adapter.version}) بحالة "${STATUS_META[res.adapter.status].label}"` +
          (res.syncedToCloud ? ' ومزامنته مع السحابة.' : ' وتفعيله في الخادم والذاكرة المحلية.')
      );
    } catch (err) {
      setWorkflowError(err instanceof Error ? err.message : 'تعذر حفظ الـ Adapter.');
    } finally {
      setSaving(false);
    }
  };

  // Load Existing Adapter into Workspace
  const loadAdapterIntoWorkspace = (adp: ScraperAdapter, autoRetest = false) => {
    const clean = normalizeScraperAdapter(adp);
    setTargetUrl(clean.sampleUrl || `https://${clean.domain}`);
    setContentTypeHint(clean.contentTypeHint);
    setEditingBaseAdapter(clean);
    setCandidateAdapter(
      normalizeScraperAdapter({
        ...clean,
        version: clean.version + 1,
      })
    );
    setSaveStatusOverride(clean.status);
    setChangeNote(`تحديث وتحسين قواعد ${clean.name}`);
    setShowRulesEditor(true);
    setTestResult(null);
    setAnalysisReport(null);
    setConfirmOverwriteChecked(false);
    setWorkflowError(null);
    if (autoRetest) {
      void runTestCandidate(clean, clean.sampleUrl || `https://${clean.domain}`);
    }
  };

  // Version History & Rollback
  const handleOpenHistory = async (adp: ScraperAdapter) => {
    setHistoryAdapter(adp);
    setLoadingHistory(true);
    setHistoryVersions([]);
    try {
      const list = await fetchAdapterVersions(adp.id);
      setHistoryVersions(list);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleRollbackVersion = async (ver: ScraperAdapterVersionRecord) => {
    if (!historyAdapter) return;
    setSaving(true);
    try {
      const restored = await saveScraperAdapterWithVersion({
        adapter: {
          ...ver.snapshot,
          id: historyAdapter.id,
          domain: historyAdapter.domain,
        },
        uid: actorUid,
        isNew: false,
        changeNote: `استرجاع الإصدار السابق v${ver.version}`,
        previousAdapter: historyAdapter,
      });
      const nextList = [
        restored.adapter,
        ...adapters.filter((a) => a.id !== restored.adapter.id),
      ];
      onAdaptersChanged?.(nextList);
      setHistoryAdapter(null);
      onNotify(`تم استرجاع قواعد v${ver.version} وحفظها كإصدار v${restored.adapter.version}`);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (adp: ScraperAdapter) => {
    const res = await toggleScraperAdapterEnabled(adp, !adp.enabled, actorUid);
    onAdaptersChanged?.(adapters.map((a) => (a.id === res.adapter.id ? res.adapter : a)));
    onNotify(
      res.adapter.enabled
        ? `تم تفعيل الـ Adapter لـ ${res.adapter.domain}`
        : `تم إيقاف الـ Adapter لـ ${res.adapter.domain} مؤقتاً`
    );
  };

  const handleDeleteAdapter = async (id: string) => {
    await deleteScraperAdapter(id);
    onAdaptersChanged?.(adapters.filter((a) => a.id !== id));
    if (editingBaseAdapter?.id === id) {
      setEditingBaseAdapter(null);
    }
    setConfirmDeleteId(null);
    onNotify('تم حذف الـ Adapter نهائياً.');
  };

  const handleExportAllJson = () => {
    const json = exportAdaptersBundleJson(adapters);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `rahaltv-scraper-adapters-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(blobUrl);
    onNotify(`تم تصدير ${adapters.length} Adapter بصيغة JSON.`);
  };

  const handleImportJsonFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImportJsonText(String(reader.result || ''));
    };
    reader.readAsText(file);
  };

  const handleCommitImportJson = async () => {
    const parsed = parseImportedAdaptersJson(importJsonText);
    if (parsed.adapters.length === 0) {
      setWorkflowError(parsed.errors[0] || 'لم يُعثر على Adapters صالحة في ملف JSON.');
      return;
    }
    setImportingJson(true);
    try {
      let current = [...adapters];
      for (const adp of parsed.adapters) {
        const existing = current.find((x) => x.id === adp.id || x.domain === adp.domain) || null;
        const res = await saveScraperAdapterWithVersion({
          adapter: adp,
          uid: actorUid,
          isNew: !existing,
          changeNote: 'استيراد من ملف JSON',
          previousAdapter: existing,
        });
        current = [res.adapter, ...current.filter((x) => x.id !== res.adapter.id)];
      }
      onAdaptersChanged?.(current);
      setShowImportModal(false);
      setImportJsonText('');
      onNotify(`تم استيراد وحفظ ${parsed.adapters.length} Adapter بنجاح!`);
    } finally {
      setImportingJson(false);
    }
  };

  const updateCandidate = (patch: Partial<ScraperAdapter>) => {
    setCandidateAdapter((prev) => (prev ? normalizeScraperAdapter({ ...prev, ...patch }) : prev));
  };

  return (
    <div className="space-y-6">
      {/* Header & Input Builder Workbench */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="font-display text-lg sm:text-xl font-extrabold text-white flex items-center gap-2">
                <Wrench className="w-5 h-5 text-[#f9c400]" />
                <span>مطوّر مصادر الجلب الذكي</span>
              </h2>
              <span className="font-latin text-[11px] font-bold text-[#b7c9ef]/80">
                Smart Scraper Adapter Builder
              </span>
            </div>
            <p className="text-xs text-[#b7c9ef] leading-relaxed">
              أضف رابط أي موقع خارجي لتحليل بنيته تلقائياً، اكتشاف أسباب نقص الحلقات أو السيرفرات، وبناء Adapter مستقل واختباره قبل الاعتماد.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-[#b7c9ef] shrink-0">
            <span className="inline-flex items-center gap-1.5 font-bold">
              <span
                className={`h-2 w-2 rounded-full ${cloudSynced ? 'bg-[#4CAF50]' : 'bg-[#f9c400]'}`}
              />
              {cloudSynced ? 'متزامن مع Firestore' : 'مزامنة محلية + المتصفح'}
            </span>
            <span className="text-white/25">·</span>
            <span className="inline-flex items-center gap-1.5 font-bold text-sky-300">
              <Globe className="w-3.5 h-3.5" />
              {hasCustomWorker
                ? 'محرك المتصفح + Cloudflare Worker'
                : isStaticBrowserMode
                  ? 'محرك المتصفح المستقل (GitHub Pages)'
                  : 'محرك تلقائي (خادم + متصفح)'}
            </span>
            <span className="text-white/25">·</span>
            <span className="font-latin tabular-nums font-bold text-white">
              {adapters.length} <span className="font-sans text-[#b7c9ef]">موقع مسجّل</span>
            </span>
          </div>
        </div>

        {isStaticBrowserMode && !hasCustomWorker && (
          <div className="rounded-2xl bg-sky-500/10 border border-sky-400/30 px-4 py-3 text-xs text-sky-100 leading-relaxed flex items-start gap-2.5">
            <Globe className="w-4 h-4 text-sky-300 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white">يعمل الآن عبر محرك المتصفح المستقل (GitHub Pages):</strong>{' '}
              يمكنك تحليل الروابط واختبار الجلب مباشرة من المتصفح. بالنسبة للمواقع التي تمنع CORS أو Cloudflare، الصق كود الصفحة (<span className="font-latin">Ctrl+U</span>) أو فعّل <span className="font-latin">Cloudflare Worker</span> المجاني من الإعدادات.
            </div>
          </div>
        )}

        <form onSubmit={runAnalyzeSite} className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-end">
            <div className="lg:col-span-7">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-[#b7c9ef]">
                  رابط الموقع أو صفحة العمل المستهدفة
                </label>
                <button
                  type="button"
                  onClick={() => setTargetUrl('https://ffosta-tv.baby/play.php?vid=374905744')}
                  className="font-latin text-[11px] font-bold text-[#f9c400] hover:underline cursor-pointer"
                >
                  مثال: ffosta-tv.baby
                </button>
              </div>
              <input
                type="url"
                dir="ltr"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="https://ffosta-tv.baby/play.php?vid=374905744"
                className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-4 py-3 text-sm text-white focus:border-[#f9c400] focus:outline-none"
              />
            </div>

            <div className="lg:col-span-5">
              <label className="block text-xs font-bold text-[#b7c9ef] mb-1.5">
                نوع المحتوى المتوقع
              </label>
              <div className="grid grid-cols-4 gap-1 rounded-xl bg-[#1a242e] p-1 border border-white/10">
                {CONTENT_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setContentTypeHint(opt.id)}
                    className={`rounded-lg py-2 px-1.5 text-[11px] font-extrabold whitespace-nowrap transition-colors cursor-pointer ${
                      contentTypeHint === opt.id
                        ? 'bg-[#D92321] text-white'
                        : 'text-[#b7c9ef] hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {matchedExistingFromUrl && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#1a242e]/85 border border-sky-400/35 px-4 py-3 text-xs">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 text-sky-300 shrink-0" />
                <div>
                  <span className="font-extrabold text-white">
                    هذا الموقع لديه Adapter سابق:{' '}
                  </span>
                  <span className="font-latin font-bold text-sky-300">
                    {matchedExistingFromUrl.name} (v{matchedExistingFromUrl.version})
                  </span>
                  <span className="text-[#b7c9ef]"> — </span>
                  <span className={`font-bold ${STATUS_META[matchedExistingFromUrl.status].textCls}`}>
                    {STATUS_META[matchedExistingFromUrl.status].label}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => loadAdapterIntoWorkspace(matchedExistingFromUrl, false)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 px-3 py-1.5 text-[11px] font-extrabold text-sky-200 whitespace-nowrap cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>تحديث وإصلاح الـ Adapter الحالي</span>
              </button>
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => setShowRawHtmlBox((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-[#b7c9ef] hover:text-white cursor-pointer"
            >
              <Code2 className="w-3.5 h-3.5 text-[#f9c400]" />
              <span>
                {showRawHtmlBox
                  ? 'إخفاء كود HTML اليدوي'
                  : 'لصق كود HTML يدوياً (اختياري للمواقع ذات الحماية)'}
              </span>
              {showRawHtmlBox ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showRawHtmlBox && (
              <textarea
                rows={5}
                dir="ltr"
                value={rawHtml}
                onChange={(e) => setRawHtml(e.target.value)}
                placeholder="<!DOCTYPE html><html>... الصق View-Source هنا إذا كان الموقع يحجب الاتصال المباشر ..."
                className="font-latin mt-2 w-full rounded-xl bg-[#1a242e] border border-white/10 p-3 text-xs text-white focus:border-[#f9c400] focus:outline-none"
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="submit"
              disabled={analyzing || testing}
              className="inline-flex items-center gap-2 rounded-xl bg-[#f9c400] hover:bg-[#dfb20b] disabled:opacity-55 px-5 py-2.5 text-xs font-black text-[#06131c] whitespace-nowrap shadow cursor-pointer"
            >
              {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
              <span>{analyzing ? 'جاري تحليل الموقع...' : 'تحليل الموقع'}</span>
            </button>

            <button
              type="button"
              disabled={analyzing || testing}
              onClick={() => void runTestCandidate()}
              className="inline-flex items-center gap-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-55 px-5 py-2.5 text-xs font-black text-[#06131c] whitespace-nowrap shadow cursor-pointer"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
              <span>{testing ? 'جاري اختبار الجلب...' : 'اختبار الجلب'}</span>
            </button>

            <button
              type="button"
              disabled={analyzing || testing}
              onClick={() => void handleCreateOrPrepareCandidate()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-55 px-5 py-2.5 text-xs font-extrabold text-white whitespace-nowrap shadow cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>
                {editingBaseAdapter ? 'إنشاء نسخة محسّنة للموقع' : 'إنشاء دعم للموقع'}
              </span>
            </button>
          </div>
        </form>

        {workflowError && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-[#D92321]/15 border border-[#D92321]/45 px-4 py-3 text-xs font-bold text-[#ffb3b1]">
            <AlertTriangle className="w-4 h-4 text-[#ff6b69] shrink-0 mt-0.5" />
            <p className="leading-relaxed">{workflowError}</p>
          </div>
        )}
      </div>

      {/* Automatic Site Analysis & Diagnostics Report */}
      {analysisReport && (
        <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div>
              <h3 className="font-display text-base sm:text-lg font-extrabold text-white flex items-center gap-2">
                <Activity className="w-5 h-5 text-sky-300" />
                <span>تقرير التحليل التلقائي وأسباب نقص المحتوى</span>
              </h3>
              <p className="font-latin text-xs text-[#b7c9ef] mt-1" dir="ltr">
                {analysisReport.domain} · CMS: {analysisReport.signals.cmsFingerprint} · HTTP{' '}
                {analysisReport.signals.httpStatus || 'HTML'}
              </p>
            </div>

            <div className="text-xs text-[#b7c9ef] tabular-nums">
              <span>الجالب العام التقط: </span>
              <strong className="text-white">{analysisReport.baselineCounts.episodes} حلقة</strong>
              <span className="mx-1.5 text-white/30">·</span>
              <strong className="text-white">{analysisReport.baselineCounts.servers} سيرفر</strong>
              <span className="mx-1.5 text-white/30">·</span>
              <strong className="text-white">{analysisReport.baselineCounts.seasons} موسم</strong>
            </div>
          </div>

          {analysisReport.signals.isProtectedOrBlocked && (
            <div className="flex items-start gap-2.5 rounded-2xl bg-[#D92321]/15 border border-[#D92321]/45 p-4 text-xs text-[#ffb3b1]">
              <ShieldAlert className="w-5 h-5 text-[#ff6b69] shrink-0 mt-0.5" />
              <div>
                <p className="font-extrabold text-white">حماية أو منع وصول في الموقع</p>
                <p className="mt-1 leading-relaxed">{analysisReport.signals.protectionReason}</p>
              </div>
            </div>
          )}

          {/* Structural Discovery Summary Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.07] p-3.5">
              <p className="text-[11px] font-bold text-[#b7c9ef]">الحلقات الظاهرة / المواسم</p>
              <p className="mt-1 font-latin text-xl font-black text-white tabular-nums">
                {analysisReport.signals.visibleEpisodeCount}{' '}
                <span className="font-sans text-xs font-bold text-[#b7c9ef]">
                  / {analysisReport.signals.seasonCountDetected || 1} موسم
                </span>
              </p>
            </div>
            <div className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.07] p-3.5">
              <p className="text-[11px] font-bold text-[#b7c9ef]">السيرفرات المكتشفة</p>
              <p className="mt-1 font-latin text-xl font-black text-[#4CAF50] tabular-nums">
                {analysisReport.signals.visibleServerCount}{' '}
                <span className="font-sans text-xs font-bold text-[#b7c9ef]">
                  {analysisReport.signals.hasTabsForServers ? '(داخل Tabs)' : '(مباشرة)'}
                </span>
              </p>
            </div>
            <div className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.07] p-3.5">
              <p className="text-[11px] font-bold text-[#b7c9ef]">صفحة المشاهدة الفرعية</p>
              <p className="mt-1 text-xs font-extrabold text-white truncate">
                {analysisReport.signals.hasWatchSubpage ? 'مكتشفة (watch → play)' : 'مباشرة بالصفحة'}
              </p>
            </div>
            <div className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.07] p-3.5">
              <p className="text-[11px] font-bold text-[#b7c9ef]">التصفح وواجهات API</p>
              <p className="mt-1 text-xs font-extrabold text-white">
                {analysisReport.signals.hasPagination ? 'Pagination نعم' : 'صفحة واحدة'} ·{' '}
                {analysisReport.signals.discoveredApis.length} API
              </p>
            </div>
          </div>

          {analysisReport.signals.sampleServerNames.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold text-[#b7c9ef]">أسماء السيرفرات المقروءة:</span>
              <span className="font-latin font-extrabold text-[#f9c400]">
                {analysisReport.signals.sampleServerNames.join(' · ')}
              </span>
            </div>
          )}

          {/* Diagnosed Issues List */}
          {analysisReport.diagnostics.length === 0 ? (
            <div className="rounded-2xl bg-[#4CAF50]/10 border border-[#4CAF50]/35 p-4 text-xs font-bold text-[#b6f2b9]">
              البنية متوافقة بشكل جيد مع القواعد القياسية — يمكنك تشغيل اختبار الجلب للتحقق من اكتمال الحلقات والسيرفرات.
            </div>
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs font-extrabold text-white">
                أسباب النقص والملاحظات التقنية المكتشفة ({analysisReport.diagnostics.length}):
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {analysisReport.diagnostics.map((issue, idx) => {
                  const meta = SEVERITY_META[issue.severity];
                  return (
                    <div
                      key={`${issue.code}-${idx}`}
                      className={`rounded-2xl border p-4 space-y-2 ${meta.borderCls}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-extrabold text-white">{issue.title}</span>
                        <span className={`text-[10px] font-black shrink-0 ${meta.textCls}`}>
                          {meta.label}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#d6e2f8] leading-relaxed">
                        <strong className="text-white">السبب:</strong> {issue.probableCause}
                      </p>
                      <p className="text-[11px] text-[#4CAF50] leading-relaxed">
                        <strong className="text-white">الإصلاح المقترح:</strong> {issue.suggestedFix}
                      </p>
                      {issue.evidence && (
                        <p className="font-latin text-[10px] text-[#b7c9ef]/85 truncate" dir="ltr">
                          {issue.evidence}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Declarative Adapter Rules Editor */}
      {candidateAdapter && (
        <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-extrabold text-white flex items-center gap-2">
                <FileCode2 className="w-5 h-5 text-[#f9c400]" />
                <span>
                  إعدادات وقواعد الـ Adapter:{' '}
                  <span className="font-latin text-[#f9c400]">{candidateAdapter.name}</span>
                </span>
                <span className="font-latin text-xs font-bold text-[#b7c9ef]">
                  (v{candidateAdapter.version})
                </span>
              </h3>
              <p className="text-[11px] text-[#b7c9ef] mt-0.5">
                جميع القواعد معزولة لكل موقع ولا تؤثر على أي Adapter آخر.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowRulesEditor((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3.5 py-2 text-xs font-bold text-white whitespace-nowrap cursor-pointer"
              >
                <span>{showRulesEditor ? 'طي القواعد' : 'تعديل القواعد والمحددات'}</span>
                {showRulesEditor ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                disabled={testing}
                onClick={() => void runTestCandidate(candidateAdapter)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-55 px-4 py-2 text-xs font-black text-[#06131c] whitespace-nowrap cursor-pointer"
              >
                {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                <span>اختبار القواعد الحالية</span>
              </button>
            </div>
          </div>

          {showRulesEditor && (
            <div className="space-y-4 pt-2 border-t border-white/10">
              <div className="flex flex-wrap gap-1.5 border-b border-white/10 pb-3">
                {(
                  [
                    { id: 'basic', label: 'التعريف وصفحة المشاهدة' },
                    { id: 'episodes', label: 'استخراج المواسم والحلقات' },
                    { id: 'servers', label: 'استخراج السيرفرات والأسماء' },
                    { id: 'navigation', label: 'التصفح وإعدادات الموقع' },
                  ] as const
                ).map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setRulesSubTab(sub.id)}
                    className={`rounded-xl px-3.5 py-2 text-xs font-extrabold whitespace-nowrap cursor-pointer ${
                      rulesSubTab === sub.id
                        ? 'bg-[#D92321] text-white'
                        : 'bg-[#1a242e] text-[#b7c9ef] hover:text-white'
                    }`}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>

              {rulesSubTab === 'basic' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      معرّف الموقع (Site Identifier)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={candidateAdapter.id}
                      disabled={Boolean(editingBaseAdapter)}
                      onChange={(e) => updateCandidate({ id: e.target.value })}
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      اسم الموقع المعروض
                    </label>
                    <input
                      type="text"
                      value={candidateAdapter.name}
                      onChange={(e) => updateCandidate({ name: e.target.value })}
                      className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      النطاق الرئيسي (Domain)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={candidateAdapter.domain}
                      onChange={(e) => {
                        const d = normalizeAdapterDomain(e.target.value);
                        updateCandidate({
                          domain: d || e.target.value,
                          id: editingBaseAdapter ? candidateAdapter.id : buildAdapterIdFromDomain(d || e.target.value),
                        });
                      }}
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      نطاقات بديلة / مرايا مفصولة بفاصلة (Aliases)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={candidateAdapter.domainAliases.join(', ')}
                      onChange={(e) =>
                        updateCandidate({
                          domainAliases: e.target.value
                            .split(/[،,]+/)
                            .map((s) => normalizeAdapterDomain(s))
                            .filter(Boolean),
                        })
                      }
                      placeholder="mirror1.baby, ffosta.com"
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      محدد رابط صفحة المشاهدة الفرعية (Watch Subpage)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={candidateAdapter.pageDetection.watchSubpageSelector}
                      onChange={(e) =>
                        updateCandidate({
                          pageDetection: {
                            ...candidateAdapter.pageDetection,
                            watchSubpageSelector: e.target.value,
                          },
                        })
                      }
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      نمط رابط صفحة المشاهدة (Regex)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={candidateAdapter.pageDetection.watchSubpageUrlPattern}
                      onChange={(e) =>
                        updateCandidate({
                          pageDetection: {
                            ...candidateAdapter.pageDetection,
                            watchSubpageUrlPattern: e.target.value,
                          },
                        })
                      }
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      نمط رابط المسلسلات (اختياري)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={candidateAdapter.pageDetection.seriesUrlPattern}
                      onChange={(e) =>
                        updateCandidate({
                          pageDetection: {
                            ...candidateAdapter.pageDetection,
                            seriesUrlPattern: e.target.value,
                          },
                        })
                      }
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      محدد صفحة التحميل الفرعية
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={candidateAdapter.pageDetection.downloadSubpageSelector}
                      onChange={(e) =>
                        updateCandidate({
                          pageDetection: {
                            ...candidateAdapter.pageDetection,
                            downloadSubpageSelector: e.target.value,
                          },
                        })
                      }
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                    />
                  </div>
                </div>
              )}

              {rulesSubTab === 'episodes' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      حاوية الحلقات (containerSelector)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={candidateAdapter.episodeRules.containerSelector}
                      onChange={(e) =>
                        updateCandidate({
                          episodeRules: {
                            ...candidateAdapter.episodeRules,
                            containerSelector: e.target.value,
                          },
                        })
                      }
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      تبويبات المواسم (seasonTabSelector)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={candidateAdapter.episodeRules.seasonTabSelector}
                      onChange={(e) =>
                        updateCandidate({
                          episodeRules: {
                            ...candidateAdapter.episodeRules,
                            seasonTabSelector: e.target.value,
                          },
                        })
                      }
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      لوحات المواسم (seasonPanelSelector)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={candidateAdapter.episodeRules.seasonPanelSelector}
                      onChange={(e) =>
                        updateCandidate({
                          episodeRules: {
                            ...candidateAdapter.episodeRules,
                            seasonPanelSelector: e.target.value,
                          },
                        })
                      }
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      خيارات Select الحلقات (selectEpisodeOptionSelector)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={candidateAdapter.episodeRules.selectEpisodeOptionSelector}
                      onChange={(e) =>
                        updateCandidate({
                          episodeRules: {
                            ...candidateAdapter.episodeRules,
                            selectEpisodeOptionSelector: e.target.value,
                          },
                        })
                      }
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      تعبير رقم الحلقة (episodeNumberRegex)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={candidateAdapter.episodeRules.episodeNumberRegex}
                      onChange={(e) =>
                        updateCandidate({
                          episodeRules: {
                            ...candidateAdapter.episodeRules,
                            episodeNumberRegex: e.target.value,
                          },
                        })
                      }
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                        معامل المعرف (ID)
                      </label>
                      <input
                        type="text"
                        dir="ltr"
                        value={candidateAdapter.episodeRules.episodeIdParam}
                        onChange={(e) =>
                          updateCandidate({
                            episodeRules: {
                              ...candidateAdapter.episodeRules,
                              episodeIdParam: e.target.value,
                            },
                          })
                        }
                        className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                        أقصى حلقات
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={250}
                        value={candidateAdapter.episodeRules.maxEpisodes}
                        onChange={(e) =>
                          updateCandidate({
                            episodeRules: {
                              ...candidateAdapter.episodeRules,
                              maxEpisodes: Number(e.target.value) || 120,
                            },
                          })
                        }
                        className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={candidateAdapter.episodeRules.preserveMultiSeason}
                      onChange={(e) =>
                        updateCandidate({
                          episodeRules: {
                            ...candidateAdapter.episodeRules,
                            preserveMultiSeason: e.target.checked,
                          },
                        })
                      }
                      className="h-4 w-4 accent-[#4CAF50]"
                    />
                    <span>الحفاظ على تعدد المواسم منفصلة (عدم دمج الموسم 2 و 3 في الموسم 1)</span>
                  </label>
                </div>
              )}

              {rulesSubTab === 'servers' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      محدد عناصر السيرفرات (itemSelector)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={candidateAdapter.serverRules.itemSelector}
                      onChange={(e) =>
                        updateCandidate({
                          serverRules: {
                            ...candidateAdapter.serverRules,
                            itemSelector: e.target.value,
                          },
                        })
                      }
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      سمات الرابط بالترتيب (مفصولة بفاصلة)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={candidateAdapter.serverRules.urlAttributes.join(', ')}
                      onChange={(e) =>
                        updateCandidate({
                          serverRules: {
                            ...candidateAdapter.serverRules,
                            urlAttributes: e.target.value
                              .split(/[،,]+/)
                              .map((s) => s.trim())
                              .filter(Boolean),
                          },
                        })
                      }
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      محدد اسم السيرفر (nameSelector)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={candidateAdapter.serverRules.nameSelector}
                      onChange={(e) =>
                        updateCandidate({
                          serverRules: {
                            ...candidateAdapter.serverRules,
                            nameSelector: e.target.value,
                          },
                        })
                      }
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      سمة معرف AJAX (إن وجد)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={candidateAdapter.serverRules.ajaxIdAttribute}
                      onChange={(e) =>
                        updateCandidate({
                          serverRules: {
                            ...candidateAdapter.serverRules,
                            ajaxIdAttribute: e.target.value,
                          },
                        })
                      }
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      أقصى سيرفرات لكل حلقة
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={candidateAdapter.serverRules.maxServersPerEpisode}
                      onChange={(e) =>
                        updateCandidate({
                          serverRules: {
                            ...candidateAdapter.serverRules,
                            maxServersPerEpisode: Number(e.target.value) || 15,
                          },
                        })
                      }
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer pt-4">
                    <input
                      type="checkbox"
                      checked={candidateAdapter.serverRules.preserveServerNames}
                      onChange={(e) =>
                        updateCandidate({
                          serverRules: {
                            ...candidateAdapter.serverRules,
                            preserveServerNames: e.target.checked,
                          },
                        })
                      }
                      className="h-4 w-4 accent-[#4CAF50]"
                    />
                    <span>الاحتفاظ بأسماء السيرفرات الحقيقية (1vid, Vk, Ok...)</span>
                  </label>
                </div>
              )}

              {rulesSubTab === 'navigation' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      محدد روابط التصفح (paginationSelector)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={candidateAdapter.navigationRules.paginationSelector}
                      onChange={(e) =>
                        updateCandidate({
                          navigationRules: {
                            ...candidateAdapter.navigationRules,
                            paginationSelector: e.target.value,
                          },
                        })
                      }
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      بطاقات الأرشيف (listingCardSelector)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={candidateAdapter.navigationRules.listingCardSelector}
                      onChange={(e) =>
                        updateCandidate({
                          navigationRules: {
                            ...candidateAdapter.navigationRules,
                            listingCardSelector: e.target.value,
                          },
                        })
                      }
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      وضع فحص السيرفرات (verifyMode)
                    </label>
                    <select
                      value={candidateAdapter.siteSettings.verifyMode}
                      onChange={(e) =>
                        updateCandidate({
                          siteSettings: {
                            ...candidateAdapter.siteSettings,
                            verifyMode: e.target.value as AdapterVerifyMode,
                          },
                        })
                      }
                      className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs font-bold text-white"
                    >
                      <option value="relaxed_headers">مرن (يفحص 404/الحذف ويحافظ على embeds)</option>
                      <option value="strict">صارم (يرفض X-Frame-Options)</option>
                      <option value="none">بدون فحص HTTP مسبق (سريع)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      مهلة بين الطلبات (ms — Rate Limit)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={5000}
                      value={candidateAdapter.siteSettings.requestDelayMs}
                      onChange={(e) =>
                        updateCandidate({
                          siteSettings: {
                            ...candidateAdapter.siteSettings,
                            requestDelayMs: Number(e.target.value) || 250,
                          },
                        })
                      }
                      className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-4 sm:col-span-2 pt-3">
                    <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer">
                      <input
                        type="checkbox"
                        checked={candidateAdapter.navigationRules.followWatchSubpage}
                        onChange={(e) =>
                          updateCandidate({
                            navigationRules: {
                              ...candidateAdapter.navigationRules,
                              followWatchSubpage: e.target.checked,
                            },
                          })
                        }
                        className="h-4 w-4 accent-[#4CAF50]"
                      />
                      <span>تتبع صفحة المشاهدة الفرعية (watch → play)</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer">
                      <input
                        type="checkbox"
                        checked={candidateAdapter.navigationRules.followPagination}
                        onChange={(e) =>
                          updateCandidate({
                            navigationRules: {
                              ...candidateAdapter.navigationRules,
                              followPagination: e.target.checked,
                            },
                          })
                        }
                        className="h-4 w-4 accent-[#4CAF50]"
                      />
                      <span>تتبع صفحات Pagination تلقائياً</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Pre-Save Test Report, Preview & Approval Gate */}
      {testResult && candidateAdapter && (
        <div className="rounded-3xl bg-[#0c1821] border border-[#4CAF50]/35 p-5 sm:p-6 space-y-5 shadow-2xl">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h3 className="font-display text-lg font-extrabold text-white flex items-center gap-2">
                  <FlaskConical className="w-5 h-5 text-[#4CAF50]" />
                  <span>نتائج الاختبار والمعاينة قبل الحفظ</span>
                </h3>
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-black ${
                    STATUS_META[testResult.recommendedStatus].textCls
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      STATUS_META[testResult.recommendedStatus].dotCls
                    }`}
                  />
                  <span>التقييم المقترح: {STATUS_META[testResult.recommendedStatus].label}</span>
                </span>
              </div>
              <p className="text-xs text-[#b7c9ef] mt-1 leading-relaxed">
                {testResult.recommendedStatusReason}
              </p>
            </div>

            <span className="font-latin text-xs font-bold text-[#b7c9ef] tabular-nums">
              {testResult.durationMs} ms · v{testResult.adapterVersion}
            </span>
          </div>

          {/* Metrics Strip (tabular-nums) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.07] p-3">
              <p className="text-[11px] font-bold text-[#b7c9ef]">الحلقات المكتشفة</p>
              <p className="mt-1 font-latin text-xl font-black text-white tabular-nums">
                {testResult.episodesDiscovered}
              </p>
              <p className="text-[10px] text-[#b7c9ef]/80 tabular-nums">
                {testResult.seasonsDiscovered} موسم · ظاهر {testResult.visibleComparison.visibleEpisodesHint}
              </p>
            </div>
            <div className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.07] p-3">
              <p className="text-[11px] font-bold text-[#b7c9ef]">متوسط السيرفرات / حلقة</p>
              <p className="mt-1 font-latin text-xl font-black text-[#4CAF50] tabular-nums">
                {testResult.avgServersPerEpisode}
              </p>
              <p className="font-latin text-[10px] text-[#b7c9ef]/80 tabular-nums">
                Min {testResult.minServersPerEpisode} · Max {testResult.maxServersPerEpisode}
              </p>
            </div>
            <div className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.07] p-3">
              <p className="text-[11px] font-bold text-[#b7c9ef]">إجمالي السيرفرات</p>
              <p className="mt-1 font-latin text-xl font-black text-white tabular-nums">
                {testResult.totalServersExtracted}
              </p>
              <p className="text-[10px] text-[#b7c9ef]/80 tabular-nums">
                بالصفحة الحالية: {testResult.rootServersCount} / {testResult.visibleComparison.visibleServersHint}
              </p>
            </div>
            <div className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.07] p-3">
              <p className="text-[11px] font-bold text-[#b7c9ef]">نسبة التغطية</p>
              <p className="mt-1 font-latin text-xl font-black text-[#f9c400] tabular-nums">
                {testResult.visibleComparison.serversCoveragePct}%
              </p>
              <p className="text-[10px] text-[#b7c9ef]/80">
                حلقات: {testResult.visibleComparison.episodesCoveragePct}%
              </p>
            </div>
            <div className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.07] p-3">
              <p className="text-[11px] font-bold text-[#b7c9ef]">حلقات مفقودة</p>
              <p
                className={`mt-1 font-latin text-xl font-black tabular-nums ${
                  testResult.missingEpisodes.length > 0 ? 'text-[#f9c400]' : 'text-[#4CAF50]'
                }`}
              >
                {testResult.missingEpisodes.length}
              </p>
            </div>
            <div className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.07] p-3">
              <p className="text-[11px] font-bold text-[#b7c9ef]">سيرفرات فاشلة</p>
              <p
                className={`mt-1 font-latin text-xl font-black tabular-nums ${
                  testResult.failedServers.length > 0 ? 'text-[#ff7b79]' : 'text-[#4CAF50]'
                }`}
              >
                {testResult.failedServers.length}
              </p>
            </div>
          </div>

          {testResult.extractedServerNames.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold text-[#b7c9ef]">أسماء السيرفرات المستخرجة:</span>
              <span className="font-latin font-extrabold text-white">
                {testResult.extractedServerNames.join(' · ')}
              </span>
            </div>
          )}

          {/* Old vs New Comparison Diff (when improving existing adapter) */}
          {testResult.comparisonDiff && (
            <div className="rounded-2xl bg-sky-500/10 border border-sky-400/35 p-4 space-y-2">
              <p className="text-xs font-extrabold text-sky-200 flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                <span>
                  مقارنة الإصدار السابق (v{testResult.comparisonDiff.previousVersion}) مع التعديل الجديد (v
                  {testResult.comparisonDiff.candidateVersion})
                </span>
              </p>
              <p className="text-xs font-bold text-white">{testResult.comparisonDiff.summary}</p>
            </div>
          )}

          {/* Preview Subtabs */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2.5">
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setPreviewSubTab('episodes')}
                  className={`rounded-xl px-3.5 py-2 text-xs font-extrabold whitespace-nowrap cursor-pointer ${
                    previewSubTab === 'episodes'
                      ? 'bg-[#D92321] text-white'
                      : 'bg-[#1a242e] text-[#b7c9ef] hover:text-white'
                  }`}
                >
                  جدول الحلقات والسيرفرات ({testResult.episodesReport.length})
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewSubTab('issues')}
                  className={`rounded-xl px-3.5 py-2 text-xs font-extrabold whitespace-nowrap cursor-pointer ${
                    previewSubTab === 'issues'
                      ? 'bg-[#D92321] text-white'
                      : 'bg-[#1a242e] text-[#b7c9ef] hover:text-white'
                  }`}
                >
                  الأعطال والنقص ({testResult.missingEpisodes.length + testResult.failedServers.length})
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewSubTab('media')}
                  className={`rounded-xl px-3.5 py-2 text-xs font-extrabold whitespace-nowrap cursor-pointer ${
                    previewSubTab === 'media'
                      ? 'bg-[#D92321] text-white'
                      : 'bg-[#1a242e] text-[#b7c9ef] hover:text-white'
                  }`}
                >
                  معاينة بيانات العمل (Preview)
                </button>
              </div>

              {onOpenInSingleScraper && testResult.testedUrl && (
                <button
                  type="button"
                  onClick={() => onOpenInSingleScraper(testResult.testedUrl)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-[#f9c400] hover:underline whitespace-nowrap cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>فتح الرابط في أداة جلب العمل</span>
                </button>
              )}
            </div>

            {previewSubTab === 'episodes' && (
              <div className="overflow-x-auto max-h-80 overflow-y-auto rounded-2xl border border-white/10">
                {testResult.episodesReport.length === 0 ? (
                  <div className="p-4 space-y-2">
                    <p className="text-xs font-bold text-[#b7c9ef]">
                      السيرفرات المستخرجة في الصفحة الرئيسية ({testResult.extractedPreview.servers.length}):
                    </p>
                    {testResult.extractedPreview.servers.length === 0 ? (
                      <p className="text-xs text-[#ff8a88]">لم يُستخرج أي سيرفر أو حلقة.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {testResult.extractedPreview.servers.map((srv, idx) => (
                          <div
                            key={srv.id || idx}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#1a242e] px-3 py-2 text-xs"
                          >
                            <span className="font-extrabold text-white">{srv.name}</span>
                            <span className="font-latin text-[11px] text-[#b7c9ef] truncate max-w-md" dir="ltr">
                              {srv.url}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <table className="w-full text-right text-xs">
                    <thead className="bg-[#1a242e] text-[#b7c9ef] sticky top-0">
                      <tr>
                        <th className="px-3.5 py-2.5 font-extrabold">الموسم</th>
                        <th className="px-3.5 py-2.5 font-extrabold">الحلقة</th>
                        <th className="px-3.5 py-2.5 font-extrabold">عدد السيرفرات</th>
                        <th className="px-3.5 py-2.5 font-extrabold">أسماء السيرفرات</th>
                        <th className="px-3.5 py-2.5 font-extrabold">الحالة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {testResult.episodesReport.map((ep) => (
                        <tr key={`${ep.seasonNumber}-${ep.episodeNumber}`} className="hover:bg-white/[0.03]">
                          <td className="px-3.5 py-2 font-bold text-[#b7c9ef] whitespace-nowrap">
                            {ep.seasonLabel}
                          </td>
                          <td className="px-3.5 py-2 font-extrabold text-white whitespace-nowrap">
                            {ep.title || `الحلقة ${ep.episodeNumber}`}
                          </td>
                          <td className="px-3.5 py-2 font-latin font-black text-white tabular-nums">
                            {ep.serversCount}
                          </td>
                          <td className="px-3.5 py-2 font-latin text-[#f9c400]">
                            {ep.serverNames.length > 0 ? ep.serverNames.join(' · ') : '—'}
                          </td>
                          <td className="px-3.5 py-2 whitespace-nowrap">
                            {ep.status === 'complete' ? (
                              <span className="text-[#4CAF50] font-bold">مكتمل</span>
                            ) : ep.status === 'partial' ? (
                              <span className="text-[#f9c400] font-bold">جزئي</span>
                            ) : (
                              <span className="text-[#ff7b79] font-bold">فارغ</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {previewSubTab === 'issues' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <div className="rounded-2xl bg-[#1a242e]/80 border border-white/10 p-4 space-y-2">
                  <p className="text-xs font-extrabold text-white">
                    الحلقات المفقودة / غير المكتملة ({testResult.missingEpisodes.length})
                  </p>
                  {testResult.missingEpisodes.length === 0 ? (
                    <p className="text-xs text-[#4CAF50]">لا توجد فجوات ترقيم أو حلقات مفقودة.</p>
                  ) : (
                    <ul className="space-y-1.5 text-xs text-[#fde68a] max-h-56 overflow-y-auto">
                      {testResult.missingEpisodes.map((m, idx) => (
                        <li key={idx} className="leading-relaxed">
                          • موسم {m.seasonNumber} حلقة {m.episodeNumber}: {m.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded-2xl bg-[#1a242e]/80 border border-white/10 p-4 space-y-2">
                  <p className="text-xs font-extrabold text-white">
                    السيرفرات التي فشل استخراجها ({testResult.failedServers.length})
                  </p>
                  {testResult.failedServers.length === 0 ? (
                    <p className="text-xs text-[#4CAF50]">جميع السيرفرات اجتازت التحقق بنجاح.</p>
                  ) : (
                    <ul className="space-y-2 text-xs text-[#ffb3b1] max-h-56 overflow-y-auto">
                      {testResult.failedServers.map((f, idx) => (
                        <li key={idx} className="border-b border-white/5 pb-1.5 last:border-b-0">
                          <div className="font-extrabold text-white">
                            {f.episodeNumber ? `ح${f.episodeNumber} · ` : ''}
                            {f.serverName}
                          </div>
                          <div className="text-[11px]">{f.reason}</div>
                          <div className="font-latin text-[10px] text-[#b7c9ef]/70 truncate" dir="ltr">
                            {f.url}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {previewSubTab === 'media' && (
              <div className="flex flex-col sm:flex-row gap-4 rounded-2xl bg-[#1a242e]/80 border border-white/10 p-4">
                {testResult.extractedPreview.poster ? (
                  <img
                    src={testResult.extractedPreview.poster}
                    alt={testResult.extractedPreview.title}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="h-48 w-32 rounded-xl object-cover shrink-0 border border-white/10"
                  />
                ) : (
                  <div className="h-48 w-32 rounded-xl bg-[#0c1821] flex items-center justify-center text-[11px] text-[#b7c9ef] shrink-0">
                    لا يوجد بوستر
                  </div>
                )}
                <div className="flex-1 min-w-0 space-y-2">
                  <h4 className="font-display text-base font-extrabold text-white">
                    {testResult.extractedPreview.title}
                  </h4>
                  <p className="font-latin text-xs text-[#b7c9ef]">
                    {testResult.extractedPreview.englishTitle} · {testResult.extractedPreview.year} ·{' '}
                    {testResult.extractedPreview.quality}
                  </p>
                  <p className="text-xs text-[#d6e2f8] leading-relaxed line-clamp-3">
                    {testResult.extractedPreview.story}
                  </p>
                  <div className="text-[11px] text-[#b7c9ef] flex flex-wrap gap-3 pt-1">
                    <span>التصنيفات: {testResult.extractedPreview.categories.join('، ')}</span>
                    <span>·</span>
                    <span>النوع: {testResult.extractedPreview.genres.join('، ')}</span>
                    <span>·</span>
                    <span>روابط تحميل: {testResult.extractedPreview.downloads.length}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Pre-Save Approval & Honesty Gate */}
          <div className="rounded-2xl bg-[#1a242e]/90 border border-white/15 p-4 space-y-3.5">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-end">
              <div className="md:col-span-5">
                <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                  ملاحظة الإصدار (Change Note)
                </label>
                <input
                  type="text"
                  value={changeNote}
                  onChange={(e) => setChangeNote(e.target.value)}
                  placeholder="مثال: دعم تعدد المواسم واستخراج data-embed-url"
                  className="w-full rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>

              <div className="md:col-span-3">
                <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                  حالة الاعتماد
                </label>
                <select
                  value={saveStatusOverride}
                  onChange={(e) => setSaveStatusOverride(e.target.value as AdapterStatus)}
                  className="w-full rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-xs font-bold text-white"
                >
                  <option value="supported">مدعوم (مكتمل)</option>
                  <option value="needs_fix">يحتاج إصلاحاً</option>
                  <option value="failed">فشل التحليل</option>
                </select>
              </div>

              <div className="md:col-span-4 flex items-center justify-end">
                <button
                  type="button"
                  disabled={
                    saving ||
                    (Boolean(editingBaseAdapter && adapters.some((a) => a.id === editingBaseAdapter.id)) &&
                      !confirmOverwriteChecked)
                  }
                  onClick={() => void handleSaveAndApproveAdapter()}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-50 px-5 py-2.5 text-xs font-extrabold text-white whitespace-nowrap shadow-lg cursor-pointer"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>
                    {editingBaseAdapter ? 'اعتماد التحديث وحفظ الـ Adapter' : 'اعتماد وحفظ الـ Adapter'}
                  </span>
                </button>
              </div>
            </div>

            {editingBaseAdapter && adapters.some((a) => a.id === editingBaseAdapter.id) && (
              <label className="flex items-center gap-2 text-xs font-bold text-[#f9c400] cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmOverwriteChecked}
                  onChange={(e) => setConfirmOverwriteChecked(e.target.checked)}
                  className="h-4 w-4 accent-[#f9c400]"
                />
                <span>
                  أؤكد مراجعة الفروقات أعلاه وأوافق على تحديث الـ Adapter (v{editingBaseAdapter.version} → v
                  {candidateAdapter.version})
                </span>
              </label>
            )}
          </div>
        </div>
      )}

      {/* Managed Supported Sites Registry */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 sm:p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <h3 className="font-display text-base sm:text-lg font-extrabold text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-[#f9c400]" />
              <span>قائمة المواقع المدعومة والـ Adapters ({adapters.length})</span>
            </h3>
            <p className="text-xs text-[#b7c9ef] mt-0.5">
              كل Adapter مفعّل يطبّق تلقائياً عند استخدام "جلب عمل واحد" أو "جلب موقع بالكامل" لنفس النطاق.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3.5 py-2 text-xs font-bold text-white whitespace-nowrap cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-sky-300" />
              <span>استيراد JSON</span>
            </button>
            <button
              type="button"
              disabled={adapters.length === 0}
              onClick={handleExportAllJson}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 disabled:opacity-45 border border-white/10 px-3.5 py-2 text-xs font-bold text-white whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#4CAF50]" />
              <span>تصدير JSON</span>
            </button>
          </div>
        </div>

        {/* Search & Status Filter */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-[#b7c9ef] absolute right-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
              placeholder="ابحث باسم الموقع أو النطاق..."
              className="w-full rounded-xl bg-[#1a242e] border border-white/10 pr-10 pl-3.5 py-2 text-xs text-white focus:border-[#f9c400] focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: 'all', label: `الكل (${statusCounts.all})` },
                { id: 'supported', label: `مدعوم (${statusCounts.supported})` },
                { id: 'needs_fix', label: `يحتاج إصلاحاً (${statusCounts.needs_fix})` },
                { id: 'failed', label: `فشل التحليل (${statusCounts.failed})` },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setListStatusFilter(f.id)}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold whitespace-nowrap cursor-pointer ${
                  listStatusFilter === f.id
                    ? 'bg-[#D92321] text-white'
                    : 'bg-[#1a242e] text-[#b7c9ef] hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filteredAdapters.length === 0 ? (
          <div className="rounded-2xl bg-[#1a242e]/60 border border-white/10 p-8 text-center space-y-2">
            <Globe className="w-8 h-8 text-[#b7c9ef]/60 mx-auto" />
            <p className="text-sm font-extrabold text-white">لا توجد Adapters مطابقة بعد</p>
            <p className="text-xs text-[#b7c9ef]">
              أدخل رابط موقع مثل <span className="font-latin text-[#f9c400]">ffosta-tv.baby</span> في الأعلى واضغط "تحليل الموقع" ثم "اختبار الجلب" لإنشاء أول Adapter.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.07] border border-white/10 rounded-2xl overflow-hidden">
            {filteredAdapters.map((adp) => {
              const st = STATUS_META[adp.status];
              return (
                <div
                  key={adp.id}
                  className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-[#1a242e]/45 hover:bg-[#1a242e]/80 p-4 transition-colors"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="font-display text-sm font-extrabold text-white">
                        {adp.name}
                      </span>
                      <span className="font-latin text-xs font-bold text-[#f9c400]" dir="ltr">
                        {adp.domain}
                      </span>
                      <span className="font-latin text-[11px] font-bold text-[#b7c9ef]/80 tabular-nums">
                        v{adp.version}
                      </span>
                      <span className="text-white/25">·</span>
                      <span className={`inline-flex items-center gap-1.5 text-xs font-extrabold ${st.textCls}`}>
                        {adp.status === 'supported' ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : adp.status === 'needs_fix' ? (
                          <AlertTriangle className="w-3.5 h-3.5" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5" />
                        )}
                        <span>{st.label}</span>
                      </span>
                      {!adp.enabled && (
                        <span className="text-[11px] font-bold text-[#b7c9ef]/70">
                          (متوقف مؤقتاً)
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#b7c9ef]">
                      <span className="font-latin">ID: {adp.id}</span>
                      {adp.lastTestSummary && (
                        <>
                          <span className="text-white/25">·</span>
                          <span className="tabular-nums">
                            آخر اختبار: {adp.lastTestSummary.episodesDiscovered} حلقة /{' '}
                            {adp.lastTestSummary.totalServersExtracted} سيرفر
                          </span>
                        </>
                      )}
                      <span className="text-white/25">·</span>
                      <span>آخر تحديث: {formatShortDate(adp.updatedAtMs || adp.lastTestSummary?.testedAt)}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {/* Enable / Disable Toggle */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={adp.enabled}
                      onClick={() => void handleToggleEnabled(adp)}
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] font-extrabold whitespace-nowrap cursor-pointer ${
                        adp.enabled
                          ? 'bg-[#4CAF50]/15 border-[#4CAF50]/40 text-[#4CAF50]'
                          : 'bg-[#0c1821] border-white/15 text-[#b7c9ef]'
                      }`}
                    >
                      <span>{adp.enabled ? 'مفعّل' : 'معطّل'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => loadAdapterIntoWorkspace(adp, false)}
                      className="inline-flex items-center gap-1 rounded-xl bg-[#0c1821] hover:bg-sky-500/20 border border-white/10 px-3 py-1.5 text-[11px] font-bold text-sky-300 whitespace-nowrap cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>تعديل</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => loadAdapterIntoWorkspace(adp, true)}
                      className="inline-flex items-center gap-1 rounded-xl bg-[#0c1821] hover:bg-[#f9c400]/20 border border-white/10 px-3 py-1.5 text-[11px] font-bold text-[#f9c400] whitespace-nowrap cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>إعادة اختبار</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleOpenHistory(adp)}
                      className="inline-flex items-center gap-1 rounded-xl bg-[#0c1821] hover:bg-white/10 border border-white/10 px-3 py-1.5 text-[11px] font-bold text-[#b7c9ef] hover:text-white whitespace-nowrap cursor-pointer"
                    >
                      <History className="w-3.5 h-3.5" />
                      <span>الإصدارات</span>
                    </button>

                    {confirmDeleteId === adp.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void handleDeleteAdapter(adp.id)}
                          className="rounded-xl bg-[#D92321] px-2.5 py-1.5 text-[11px] font-black text-white whitespace-nowrap cursor-pointer"
                        >
                          تأكيد الحذف
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded-xl bg-[#0c1821] px-2.5 py-1.5 text-[11px] font-bold text-[#b7c9ef] cursor-pointer"
                        >
                          إلغاء
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(adp.id)}
                        aria-label={`حذف ${adp.name}`}
                        className="inline-flex items-center justify-center rounded-xl bg-[#0c1821] hover:bg-[#D92321] border border-white/10 p-1.5 text-[#D92321] hover:text-white cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Version History & Rollback Modal */}
      {historyAdapter && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl bg-[#0c1821] border border-white/15 p-5 sm:p-6 space-y-4 shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h3 className="font-display text-base font-extrabold text-white flex items-center gap-2">
                  <History className="w-4 h-4 text-[#f9c400]" />
                  <span>سجل إصدارات {historyAdapter.name}</span>
                </h3>
                <p className="font-latin text-[11px] text-[#b7c9ef]">{historyAdapter.domain}</p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryAdapter(null)}
                className="rounded-lg bg-[#1a242e] p-1.5 text-[#b7c9ef] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5">
              {loadingHistory ? (
                <div className="py-10 text-center text-xs text-[#b7c9ef] flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-[#f9c400]" />
                  <span>جاري تحميل سجل الإصدارات...</span>
                </div>
              ) : historyVersions.length === 0 ? (
                <p className="py-6 text-center text-xs text-[#b7c9ef]">
                  لا توجد إصدارات مؤرشفة لهذا الـ Adapter بعد.
                </p>
              ) : (
                historyVersions.map((ver) => (
                  <div
                    key={ver.versionId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#1a242e] border border-white/10 p-3.5 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-latin font-black text-[#f9c400]">
                          v{ver.version}
                        </span>
                        <span className="font-bold text-white">{ver.changeNote}</span>
                      </div>
                      <p className="text-[11px] text-[#b7c9ef]">
                        {formatShortDate(ver.createdAtMs || ver.snapshot.updatedAtMs)} · محدد السيرفرات:{' '}
                        <span className="font-latin">{ver.snapshot.serverRules.itemSelector}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleRollbackVersion(ver)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#0c1821] hover:bg-sky-500/20 border border-sky-400/35 px-3 py-1.5 text-[11px] font-extrabold text-sky-300 whitespace-nowrap cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>استرجاع هذا الإصدار</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Import JSON Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-3xl bg-[#0c1821] border border-white/15 p-5 sm:p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="font-display text-base font-extrabold text-white flex items-center gap-2">
                <Upload className="w-4 h-4 text-sky-300" />
                <span>استيراد Adapters بصيغة JSON</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="rounded-lg bg-[#1a242e] p-1.5 text-[#b7c9ef] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#b7c9ef] mb-1.5">
                اختر ملف JSON أو الصق محتواه أدناه
              </label>
              <input
                type="file"
                accept="application/json,.json"
                onChange={handleImportJsonFile}
                className="block w-full text-xs text-[#b7c9ef] file:ml-3 file:rounded-xl file:border-0 file:bg-[#1a242e] file:px-3.5 file:py-2 file:text-xs file:font-bold file:text-white cursor-pointer"
              />
            </div>

            <textarea
              rows={7}
              dir="ltr"
              value={importJsonText}
              onChange={(e) => setImportJsonText(e.target.value)}
              placeholder='{ "adapters": [ ... ] }'
              className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 p-3 text-xs text-white focus:border-[#f9c400] focus:outline-none"
            />

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="rounded-xl bg-[#1a242e] px-4 py-2 text-xs font-bold text-[#b7c9ef] cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={importingJson || !importJsonText.trim()}
                onClick={() => void handleCommitImportJson()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-50 px-5 py-2 text-xs font-extrabold text-white cursor-pointer"
              >
                {importingJson ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>استيراد وحفظ</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
