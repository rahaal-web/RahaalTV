import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  Globe,
  Loader2,
  RotateCcw,
  Save,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from 'lucide-react';
import {
  appendPopupShieldLog,
  clearPopupShieldLogs,
  DEFAULT_POPUP_SHIELD_CONFIG,
  extractServerHost,
  inspectServerPopupCompatibility,
  isDirectVideoStreamUrl,
  resolveEffectiveShieldDecision,
  subscribePopupShieldLogs,
} from '../lib/popupShield';
import {
  MediaItem,
  PopupShieldCompatibility,
  PopupShieldConfig,
  PopupShieldHostRule,
  PopupShieldLogEntry,
  PopupShieldProfileMode,
  PopupShieldServerInspection,
} from '../types/media';

interface PopupShieldPanelProps {
  catalog: MediaItem[];
  shieldConfig: PopupShieldConfig;
  busyAction: boolean;
  onChangeShieldConfig: (next: PopupShieldConfig) => void;
  onSaveShieldConfig: (next: PopupShieldConfig) => Promise<void>;
  onNotify: (msg: string) => void;
}

interface DiscoveredServerHost {
  hostname: string;
  sampleUrl: string;
  sampleTitle: string;
  serverCount: number;
  hasDirectMedia: boolean;
}

function extractSafeUrl(embedCode?: string, url?: string): string {
  if (embedCode) {
    const m = embedCode.match(/src\s*=\s*["']([^"']+)["']/i);
    if (m && /^https?:\/\//i.test(m[1].trim())) return m[1].trim();
    if (/^https?:\/\//i.test(embedCode.trim())) return embedCode.trim();
  }
  if (url && /^https?:\/\//i.test(url.trim())) return url.trim();
  return '';
}

const COMPAT_BADGE: Record<
  PopupShieldCompatibility,
  { label: string; cls: string }
> = {
  compatible: {
    label: 'متوافق مع العزل',
    cls: 'bg-[#4CAF50]/15 border-[#4CAF50]/35 text-[#4CAF50]',
  },
  partial: {
    label: 'توافق جزئي',
    cls: 'bg-[#f9c400]/15 border-[#f9c400]/35 text-[#f9c400]',
  },
  incompatible: {
    label: 'يرفض Sandbox',
    cls: 'bg-sky-500/15 border-sky-400/35 text-sky-300',
  },
  untested: {
    label: 'غير مختبر',
    cls: 'bg-white/10 border-white/15 text-[#b7c9ef]',
  },
};

export function PopupShieldPanel({
  catalog,
  shieldConfig,
  busyAction,
  onChangeShieldConfig,
  onSaveShieldConfig,
  onNotify,
}: PopupShieldPanelProps) {
  const [logs, setLogs] = useState<PopupShieldLogEntry[]>([]);
  const [hostSearch, setHostSearch] = useState('');
  const [testingHost, setTestingHost] = useState<string | null>(null);
  const [batchTesting, setBatchTesting] = useState(false);
  const [customTestUrl, setCustomTestUrl] = useState('');
  const [customTestResult, setCustomTestResult] =
    useState<PopupShieldServerInspection | null>(null);
  const [inspectionResults, setInspectionResults] = useState<
    Record<string, PopupShieldServerInspection>
  >({});

  useEffect(() => {
    return subscribePopupShieldLogs((entries) => {
      setLogs(entries);
    });
  }, []);

  const discoveredHosts = useMemo<DiscoveredServerHost[]>(() => {
    const map = new Map<string, DiscoveredServerHost>();

    const registerUrl = (rawUrl: string, title: string) => {
      if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) return;
      const host = extractServerHost(rawUrl);
      if (!host) return;
      const isDirect = isDirectVideoStreamUrl(rawUrl);
      const existing = map.get(host);
      if (existing) {
        existing.serverCount += 1;
        if (isDirect) existing.hasDirectMedia = true;
      } else {
        map.set(host, {
          hostname: host,
          sampleUrl: rawUrl,
          sampleTitle: title,
          serverCount: 1,
          hasDirectMedia: isDirect,
        });
      }
    };

    catalog.forEach((item) => {
      (item.servers || []).forEach((srv) => {
        const u = extractSafeUrl(srv.embedCode, srv.url);
        if (u) registerUrl(u, item.title);
      });
      (item.seasons || []).forEach((se) => {
        (se.episodes || []).forEach((ep) => {
          const epWatch = extractSafeUrl(ep.embedCode, ep.watchUrl);
          if (epWatch) registerUrl(epWatch, `${item.title} - ح${ep.number}`);
          (ep.servers || []).forEach((srv) => {
            const u = extractSafeUrl(srv.embedCode, srv.url);
            if (u) registerUrl(u, `${item.title} - ح${ep.number}`);
          });
        });
      });
    });

    // Also include saved custom host rules that might not be in current catalog slice
    Object.values(shieldConfig.hostRules || {}).forEach((rule) => {
      if (rule?.hostname && !map.has(rule.hostname)) {
        map.set(rule.hostname, {
          hostname: rule.hostname,
          sampleUrl: `https://${rule.hostname}/`,
          sampleTitle: 'قاعدة نطاق محفوظة',
          serverCount: 0,
          hasDirectMedia: false,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => b.serverCount - a.serverCount);
  }, [catalog, shieldConfig.hostRules]);

  const filteredHosts = useMemo(() => {
    const q = hostSearch.trim().toLowerCase();
    if (!q) return discoveredHosts;
    return discoveredHosts.filter(
      (h) => h.hostname.includes(q) || h.sampleTitle.toLowerCase().includes(q)
    );
  }, [discoveredHosts, hostSearch]);

  const stats = useMemo(() => {
    let strictCount = 0;
    let redirectGuardCount = 0;
    let unrestrictedCount = 0;
    let directMediaCount = 0;

    discoveredHosts.forEach((h) => {
      const dec = resolveEffectiveShieldDecision(h.sampleUrl, shieldConfig);
      if (dec.mode === 'strict_sandbox') strictCount += 1;
      else if (dec.mode === 'redirect_guard') redirectGuardCount += 1;
      else if (dec.mode === 'direct_media') directMediaCount += 1;
      else unrestrictedCount += 1;
    });

    const blockedCount = logs.filter((l) => l.prevented).length;
    const observedCount = logs.filter((l) => !l.prevented).length;

    return {
      totalHosts: discoveredHosts.length,
      strictCount,
      redirectGuardCount,
      unrestrictedCount,
      directMediaCount,
      blockedCount,
      observedCount,
    };
  }, [discoveredHosts, shieldConfig, logs]);

  const applyHostRuleChange = (
    hostname: string,
    mode: Exclude<PopupShieldProfileMode, 'direct_media'>,
    compatibility?: PopupShieldCompatibility,
    note?: string,
    adSignals?: string[]
  ) => {
    const prevRule = shieldConfig.hostRules[hostname];
    const resolvedCompat: PopupShieldCompatibility =
      compatibility ||
      (mode === 'strict_sandbox'
        ? 'compatible'
        : mode === 'redirect_guard'
          ? 'partial'
          : 'incompatible');

    const nextRule: PopupShieldHostRule = {
      hostname,
      mode,
      compatibility: resolvedCompat,
      note: note ?? prevRule?.note ?? 'تم الضبط من لوحة الإدارة',
      adSignals: adSignals ?? prevRule?.adSignals,
      lastTestedAt: new Date().toISOString(),
    };

    onChangeShieldConfig({
      ...shieldConfig,
      hostRules: {
        ...shieldConfig.hostRules,
        [hostname]: nextRule,
      },
    });
  };

  const handleTestHost = async (hostEntry: DiscoveredServerHost, silent = false) => {
    setTestingHost(hostEntry.hostname);
    try {
      const inspection = await inspectServerPopupCompatibility(hostEntry.sampleUrl);
      setInspectionResults((prev) => ({ ...prev, [hostEntry.hostname]: inspection }));

      const ruleMode: Exclude<PopupShieldProfileMode, 'direct_media'> =
        inspection.recommendedMode === 'direct_media'
          ? 'strict_sandbox'
          : inspection.recommendedMode;

      applyHostRuleChange(
        hostEntry.hostname,
        ruleMode,
        inspection.compatibility,
        inspection.reason,
        inspection.adSignals
      );

      appendPopupShieldLog({
        kind: 'compatibility_tested',
        prevented: false,
        serverHost: hostEntry.hostname,
        mediaTitle: hostEntry.sampleTitle,
        targetUrl: hostEntry.sampleUrl,
        detail: `نتيجة الفحص: ${inspection.reason}`,
      });

      if (!silent) {
        onNotify(`تم اختبار توافق ${hostEntry.hostname}: ${COMPAT_BADGE[inspection.compatibility].label}`);
      }
    } finally {
      setTestingHost(null);
    }
  };

  const handleBatchTestAll = async () => {
    if (discoveredHosts.length === 0) {
      onNotify('لا توجد سيرفرات مكتشفة في الكتالوج حالياً');
      return;
    }
    setBatchTesting(true);
    let tested = 0;
    const nextRules: Record<string, PopupShieldHostRule> = { ...shieldConfig.hostRules };
    const nextInspections: Record<string, PopupShieldServerInspection> = { ...inspectionResults };

    try {
      const targets = discoveredHosts.slice(0, 20);
      for (let i = 0; i < targets.length; i += 3) {
        const chunk = targets.slice(i, i + 3);
        const results = await Promise.all(
          chunk.map(async (entry) => ({
            entry,
            inspection: await inspectServerPopupCompatibility(entry.sampleUrl),
          }))
        );
        results.forEach(({ entry, inspection }) => {
          tested += 1;
          nextInspections[entry.hostname] = inspection;
          const ruleMode: Exclude<PopupShieldProfileMode, 'direct_media'> =
            inspection.recommendedMode === 'direct_media'
              ? 'strict_sandbox'
              : inspection.recommendedMode;
          nextRules[entry.hostname] = {
            hostname: entry.hostname,
            mode: ruleMode,
            compatibility: inspection.compatibility,
            note: inspection.reason,
            adSignals: inspection.adSignals,
            lastTestedAt: inspection.testedAt,
          };
        });
      }

      setInspectionResults(nextInspections);
      const updatedConfig: PopupShieldConfig = {
        ...shieldConfig,
        hostRules: nextRules,
      };
      onChangeShieldConfig(updatedConfig);
      appendPopupShieldLog({
        kind: 'compatibility_tested',
        prevented: false,
        serverHost: 'فحص شامل',
        detail: `تم فحص توافق ${tested} نطاق سيرفر وتحديث توصيات الحماية.`,
      });
      onNotify(`اكتمل اختبار التوافق لـ ${tested} سيرفر بنجاح — اضغط حفظ لمزامنة القواعد`);
    } finally {
      setBatchTesting(false);
    }
  };

  const handleCustomUrlTest = async (e: FormEvent) => {
    e.preventDefault();
    if (!customTestUrl.trim()) return;
    setTestingHost('__custom__');
    try {
      const inspection = await inspectServerPopupCompatibility(customTestUrl.trim());
      setCustomTestResult(inspection);
      if (inspection.hostname) {
        const ruleMode: Exclude<PopupShieldProfileMode, 'direct_media'> =
          inspection.recommendedMode === 'direct_media'
            ? 'strict_sandbox'
            : inspection.recommendedMode;
        applyHostRuleChange(
          inspection.hostname,
          ruleMode,
          inspection.compatibility,
          inspection.reason,
          inspection.adSignals
        );
      }
      appendPopupShieldLog({
        kind: 'compatibility_tested',
        prevented: false,
        serverHost: inspection.hostname || 'رابط مخصص',
        targetUrl: inspection.url,
        detail: inspection.reason,
      });
    } finally {
      setTestingHost(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Global Controls Card */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] pb-4">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${
                shieldConfig.enabled
                  ? 'bg-[#4CAF50]/15 border-[#4CAF50]/35 text-[#4CAF50]'
                  : 'bg-[#D92321]/15 border-[#D92321]/35 text-[#D92321]'
              }`}
            >
              {shieldConfig.enabled ? (
                <ShieldCheck className="w-6 h-6" />
              ) : (
                <ShieldOff className="w-6 h-6" />
              )}
            </div>
            <div>
              <h2 className="font-display text-lg font-extrabold text-white">
                نظام Smart Popup Shield للحماية الذكية من النوافذ المنبثقة
              </h2>
              <p className="text-xs text-[#b7c9ef] mt-0.5">
                يفحص توافق كل سيرفر على حدة، يمنع النوافذ المنبثقة حيثما أمكن بدون المساس بتشغيل الفيديو أو ملء الشاشة أو الترجمة.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busyAction}
              onClick={() => onChangeShieldConfig(DEFAULT_POPUP_SHIELD_CONFIG)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3.5 py-2.5 text-xs font-bold text-[#b7c9ef] hover:text-white cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>استعادة الافتراضي</span>
            </button>
            <button
              type="button"
              disabled={busyAction}
              onClick={() => void onSaveShieldConfig(shieldConfig)}
              className="inline-flex items-center gap-2 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-50 px-5 py-2.5 text-xs font-extrabold text-white shadow-lg cursor-pointer"
            >
              {busyAction ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>حفظ وتطبيق إعدادات الدرع</span>
            </button>
          </div>
        </div>

        {/* Summary KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.06] p-3.5">
            <p className="text-[11px] font-bold text-[#b7c9ef]">سيرفرات محمية بعزل صارم</p>
            <p className="font-latin text-2xl font-black text-[#4CAF50] mt-1 tabular-nums">
              {stats.strictCount + stats.directMediaCount}
            </p>
            <p className="text-[10px] text-[#b7c9ef]/70 mt-0.5">يمنع نوافذ الـ iframe فعلياً</p>
          </div>
          <div className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.06] p-3.5">
            <p className="text-[11px] font-bold text-[#b7c9ef]">وضع التوافق المباشر / التحويل</p>
            <p className="font-latin text-2xl font-black text-sky-300 mt-1 tabular-nums">
              {stats.unrestrictedCount + stats.redirectGuardCount}
            </p>
            <p className="text-[10px] text-[#b7c9ef]/70 mt-0.5">لضمان عدم كسر التشغيل</p>
          </div>
          <div className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.06] p-3.5">
            <p className="text-[11px] font-bold text-[#b7c9ef]">محاولات تم منعها فعلياً</p>
            <p className="font-latin text-2xl font-black text-[#f9c400] mt-1 tabular-nums">
              {stats.blockedCount}
            </p>
            <p className="text-[10px] text-[#b7c9ef]/70 mt-0.5">window.open و target=_blank</p>
          </div>
          <div className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.06] p-3.5">
            <p className="text-[11px] font-bold text-[#b7c9ef]">عمليات رصد خارجية / فحوص</p>
            <p className="font-latin text-2xl font-black text-white mt-1 tabular-nums">
              {stats.observedCount}
            </p>
            <p className="text-[10px] text-[#b7c9ef]/70 mt-0.5">توثيق شفاف دون ادعاء منع</p>
          </div>
        </div>

        {/* Toggle Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex items-start justify-between gap-3 rounded-2xl bg-[#1a242e] border border-white/10 p-4 cursor-pointer">
            <div>
              <p className="text-xs font-extrabold text-white">تفعيل نظام الحماية المركزي (Master Switch)</p>
              <p className="text-[11px] text-[#b7c9ef] mt-1">
                يشغّل حراسة النوافذ المنبثقة وسياسات Sandbox المتكيفة عبر جميع مشغلات الموقع.
              </p>
            </div>
            <input
              type="checkbox"
              checked={shieldConfig.enabled}
              onChange={(e) => onChangeShieldConfig({ ...shieldConfig, enabled: e.target.checked })}
              className="mt-1 h-4 w-4 accent-[#4CAF50] cursor-pointer"
            />
          </label>

          <label className="flex items-start justify-between gap-3 rounded-2xl bg-[#1a242e] border border-white/10 p-4 cursor-pointer">
            <div>
              <p className="text-xs font-extrabold text-white">حظر النوافذ الناتجة عن window.open</p>
              <p className="text-[11px] text-[#b7c9ef] mt-1">
                يمنع فتح تبويبات إعلانية عبر window.open أثناء نشاط المشغل مع استثناء روابط تسجيل الدخول الرسمية.
              </p>
            </div>
            <input
              type="checkbox"
              checked={shieldConfig.blockWindowOpen}
              onChange={(e) =>
                onChangeShieldConfig({ ...shieldConfig, blockWindowOpen: e.target.checked })
              }
              className="mt-1 h-4 w-4 accent-[#4CAF50] cursor-pointer"
            />
          </label>

          <label className="flex items-start justify-between gap-3 rounded-2xl bg-[#1a242e] border border-white/10 p-4 cursor-pointer">
            <div>
              <p className="text-xs font-extrabold text-white">حماية روابط target="_blank" غير المصرح بها</p>
              <p className="text-[11px] text-[#b7c9ef] mt-1">
                يعترض الروابط الإعلانية التي تفتح تبويباً جديداً مع السماح الكامل بروابط التحميل المعتمدة.
              </p>
            </div>
            <input
              type="checkbox"
              checked={shieldConfig.guardBlankLinks}
              onChange={(e) =>
                onChangeShieldConfig({ ...shieldConfig, guardBlankLinks: e.target.checked })
              }
              className="mt-1 h-4 w-4 accent-[#4CAF50] cursor-pointer"
            />
          </label>

          <label className="flex items-start justify-between gap-3 rounded-2xl bg-[#1a242e] border border-white/10 p-4 cursor-pointer">
            <div>
              <p className="text-xs font-extrabold text-white">التبديل التلقائي عند رفض السيرفر لـ Sandbox</p>
              <p className="text-[11px] text-[#b7c9ef] mt-1">
                إذا رفض سيرفر خارجي القيود، يُحوّل فوراً لوضع التوافق المباشر دون تعطيل السيرفر أو إيقاف الفيديو.
              </p>
            </div>
            <input
              type="checkbox"
              checked={shieldConfig.autoFallbackOnReject}
              onChange={(e) =>
                onChangeShieldConfig({ ...shieldConfig, autoFallbackOnReject: e.target.checked })
              }
              className="mt-1 h-4 w-4 accent-[#4CAF50] cursor-pointer"
            />
          </label>
        </div>

        {/* Default Strategy + Badge Toggle */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          <div>
            <label className="block text-xs font-extrabold text-white mb-1.5">
              استراتيجية العزل الافتراضية للسيرفرات الجديدة
            </label>
            <select
              value={shieldConfig.defaultStrategy}
              onChange={(e) =>
                onChangeShieldConfig({
                  ...shieldConfig,
                  defaultStrategy: e.target.value as PopupShieldConfig['defaultStrategy'],
                })
              }
              className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-xs font-bold text-white focus:border-[#4CAF50] focus:outline-none"
            >
              <option value="adaptive">متكيف ذكي (Adaptive — يعزل السيرفرات المتوافقة ويترك الرافضة تعمل بحرية)</option>
              <option value="strict_when_safe">تفضيل العزل الصارم مع تبديل فوري عند الرفض</option>
              <option value="observe_only">مراقبة الصفحة الأم فقط (بدون تقييد iframe)</option>
            </select>
          </div>

          <label className="flex items-center justify-between gap-3 rounded-xl bg-[#1a242e] border border-white/10 px-4 py-3 cursor-pointer self-end">
            <div>
              <p className="text-xs font-extrabold text-white">عرض مؤشر وضع الحماية في شريط المشغل</p>
              <p className="text-[11px] text-[#b7c9ef]">يتيح أيضاً التبديل اليدوي السريع بين أوضاع التوافق.</p>
            </div>
            <input
              type="checkbox"
              checked={shieldConfig.showPlayerBadge}
              onChange={(e) =>
                onChangeShieldConfig({ ...shieldConfig, showPlayerBadge: e.target.checked })
              }
              className="h-4 w-4 accent-[#4CAF50] cursor-pointer"
            />
          </label>
        </div>

        {/* Honest Cross-Origin Transparency Banner */}
        <div className="rounded-2xl bg-sky-500/10 border border-sky-400/25 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-sky-300 shrink-0 mt-0.5" />
          <div className="text-xs text-[#b7c9ef] leading-relaxed space-y-1">
            <p className="font-extrabold text-white">ملاحظة تقنية دقيقة (Cross-Origin Policy):</p>
            <p>
              لا يمكن لأي موقع التدخل برمجياً داخل DOM مشغلات الطرف الثالث المحمية بسياسة Cross-Origin، ولا يضع النظام أي طبقة شفافة فوق الفيديو حتى لا تتعطل أزرار التشغيل أو ملء الشاشة أو الجودة أو الترجمة.
              السيرفرات المتوافقة مع <span className="font-latin text-white">strict_sandbox</span> يتم منع نوافذها كلياً عبر المتصفح، أما السيرفرات التي ترفض <span className="font-latin text-white">sandbox</span> فتُشغَّل في وضع التوافق المباشر مع رصد خروج التركيز دون ادعاء كاذب بمنع إعلاناتها.
            </p>
          </div>
        </div>
      </div>

      {/* Custom Server Compatibility Tester */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-extrabold text-white flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-[#f9c400]" />
              <span>اختبار توافق رابط سيرفر مع الحماية</span>
            </h3>
            <p className="text-xs text-[#b7c9ef] mt-0.5">
              يفحص ترويسات السيرفر وإشارات رفض Sandbox أو سكريبتات Popunder ويحدد الوضع الأنسب دون تعطيله.
            </p>
          </div>
        </div>

        <form onSubmit={handleCustomUrlTest} className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="url"
            dir="ltr"
            value={customTestUrl}
            onChange={(e) => setCustomTestUrl(e.target.value)}
            placeholder="https://embed-server.example/e/abc123"
            className="flex-1 rounded-xl bg-[#1a242e] border border-white/10 px-4 py-2.5 text-xs text-white font-latin focus:border-[#f9c400] focus:outline-none"
          />
          <button
            type="submit"
            disabled={testingHost === '__custom__' || !customTestUrl.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#f9c400] hover:bg-[#eab308] disabled:opacity-50 px-5 py-2.5 text-xs font-black text-[#06131c] cursor-pointer shrink-0"
          >
            {testingHost === '__custom__' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FlaskConical className="w-4 h-4" />
            )}
            <span>فحص التوافق الآن</span>
          </button>
        </form>

        {customTestResult && (
          <div className="rounded-2xl bg-[#1a242e] border border-white/10 p-4 space-y-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-latin font-black text-white">{customTestResult.hostname || customTestResult.url}</span>
              <span
                className={`inline-flex items-center rounded-lg border px-2.5 py-0.5 text-[11px] font-extrabold ${
                  COMPAT_BADGE[customTestResult.compatibility].cls
                }`}
              >
                {COMPAT_BADGE[customTestResult.compatibility].label}
              </span>
            </div>
            <p className="text-[#b7c9ef]">{customTestResult.reason}</p>
            {customTestResult.adSignals.length > 0 && (
              <p className="text-[11px] text-[#f9c400]">
                إشارات مرصودة: <span className="font-latin">{customTestResult.adSignals.join(', ')}</span>
              </p>
            )}
          </div>
        )}
      </div>

      {/* Per-Host Protection Table */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-extrabold text-white flex items-center gap-2">
              <Server className="w-4 h-4 text-[#D92321]" />
              <span>حالة الحماية وتوافق كل سيرفر ({discoveredHosts.length})</span>
            </h3>
            <p className="text-xs text-[#b7c9ef] mt-0.5">
              إعدادات مستقلة لكل نطاق سيرفر — التعديل على سيرفر لا يغيّر بقية السيرفرات.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#b7c9ef] absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={hostSearch}
                onChange={(e) => setHostSearch(e.target.value)}
                placeholder="بحث عن نطاق..."
                className="rounded-xl bg-[#1a242e] border border-white/10 pr-8 pl-3 py-2 text-xs text-white focus:border-[#D92321] focus:outline-none"
              />
            </div>

            <button
              type="button"
              disabled={batchTesting || discoveredHosts.length === 0}
              onClick={() => void handleBatchTestAll()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/35 disabled:opacity-50 px-3.5 py-2 text-xs font-extrabold text-sky-200 cursor-pointer"
            >
              {batchTesting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FlaskConical className="w-3.5 h-3.5" />
              )}
              <span>اختبار جميع السيرفرات</span>
            </button>
          </div>
        </div>

        {filteredHosts.length === 0 ? (
          <div className="rounded-2xl bg-[#1a242e]/60 border border-white/[0.06] p-8 text-center text-xs text-[#b7c9ef]">
            لا توجد سيرفرات مطابقة للبحث حالياً.
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[460px] overflow-y-auto pl-1">
            {filteredHosts.map((hostEntry) => {
              const decision = resolveEffectiveShieldDecision(hostEntry.sampleUrl, shieldConfig);
              const savedRule = shieldConfig.hostRules[hostEntry.hostname];
              const lastProbe = inspectionResults[hostEntry.hostname];
              const compat = savedRule?.compatibility || lastProbe?.compatibility || decision.compatibility;
              const compatBadge = COMPAT_BADGE[compat];
              const isTesting = testingHost === hostEntry.hostname;
              const signals = savedRule?.adSignals || lastProbe?.adSignals || [];

              return (
                <div
                  key={hostEntry.hostname}
                  className="rounded-2xl bg-[#1a242e]/85 border border-white/[0.08] p-3.5 sm:p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Globe className="w-3.5 h-3.5 text-[#f9c400] shrink-0" />
                      <span className="font-latin text-sm font-black text-white" dir="ltr">
                        {hostEntry.hostname}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-extrabold ${compatBadge.cls}`}
                      >
                        {compatBadge.label}
                      </span>
                      <span className="rounded-md bg-white/[0.07] px-2 py-0.5 text-[10px] font-bold text-[#b7c9ef] tabular-nums">
                        {hostEntry.serverCount} رابط في الكتالوج
                      </span>
                    </div>

                    <p className="text-[11px] text-[#b7c9ef] leading-relaxed">
                      {savedRule?.note || lastProbe?.reason || decision.description}
                    </p>

                    {signals.length > 0 && (
                      <p className="text-[10px] text-[#f9c400]">
                        إشارات مرصودة: <span className="font-latin">{signals.join(', ')}</span>
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {decision.mode !== 'direct_media' ? (
                      <select
                        value={savedRule?.mode || (decision.mode as Exclude<PopupShieldProfileMode, 'direct_media'>)}
                        onChange={(e) =>
                          applyHostRuleChange(
                            hostEntry.hostname,
                            e.target.value as Exclude<PopupShieldProfileMode, 'direct_media'>
                          )
                        }
                        aria-label={`وضع الحماية لسيرفر ${hostEntry.hostname}`}
                        className="rounded-xl bg-[#0c1821] border border-white/15 px-3 py-2 text-[11px] font-extrabold text-white focus:border-[#4CAF50] focus:outline-none"
                      >
                        <option value="strict_sandbox">Sandbox صارم (منع نوافذ الـ iframe)</option>
                        <option value="redirect_guard">حماية منع التحويل فقط (redirect_guard)</option>
                        <option value="direct_unrestricted">تشغيل مباشر بدون Sandbox (توافق كامل)</option>
                      </select>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-xl bg-[#4CAF50]/15 border border-[#4CAF50]/35 px-3 py-2 text-[11px] font-extrabold text-[#4CAF50]">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>بث مباشر آمن</span>
                      </span>
                    )}

                    <button
                      type="button"
                      disabled={isTesting}
                      onClick={() => void handleTestHost(hostEntry)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-white/[0.07] hover:bg-white/[0.15] border border-white/10 disabled:opacity-50 px-3 py-2 text-[11px] font-extrabold text-white cursor-pointer"
                    >
                      {isTesting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <FlaskConical className="w-3.5 h-3.5 text-[#f9c400]" />
                      )}
                      <span>اختبار التوافق</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Live Popup Intercept & Observation Logs */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-extrabold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#4CAF50]" />
              <span>سجل محاولات فتح النوافذ والاختبارات ({logs.length})</span>
            </h3>
            <p className="text-xs text-[#b7c9ef] mt-0.5">
              يميز السجل بدقة بين المحاولات التي تم منعها فعلياً وبين الأحداث المرصودة في السيرفرات التي ترفض Sandbox.
            </p>
          </div>

          {logs.length > 0 && (
            <button
              type="button"
              onClick={() => {
                clearPopupShieldLogs();
                onNotify('تم مسح سجل درع النوافذ المنبثقة');
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#D92321]/15 hover:bg-[#D92321]/25 border border-[#D92321]/30 px-3.5 py-2 text-xs font-extrabold text-[#ff9b99] cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>مسح السجل</span>
            </button>
          )}
        </div>

        {logs.length === 0 ? (
          <div className="rounded-2xl bg-[#1a242e]/60 border border-white/[0.06] p-6 text-center text-xs text-[#b7c9ef]">
            لم تُسجل محاولات فتح نوافذ منبثقة أو فحوص توافق بعد. ستظهر هنا فور حدوثها أثناء التشغيل أو الاختبار.
          </div>
        ) : (
          <div className="space-y-2 max-h-[340px] overflow-y-auto pl-1">
            {logs.map((entry) => (
              <div
                key={entry.id}
                className="rounded-2xl bg-[#1a242e]/85 border border-white/[0.07] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-black ${
                        entry.prevented
                          ? 'bg-[#4CAF50]/15 border-[#4CAF50]/35 text-[#4CAF50]'
                          : 'bg-amber-500/15 border-amber-400/35 text-amber-300'
                      }`}
                    >
                      {entry.prevented ? (
                        <ShieldCheck className="w-3 h-3" />
                      ) : (
                        <ShieldAlert className="w-3 h-3" />
                      )}
                      <span>
                        {entry.prevented
                          ? 'تم المنع فعلياً'
                          : entry.kind === 'compatibility_tested'
                            ? 'اختبار توافق'
                            : 'رصد خارجي / توافق'}
                      </span>
                    </span>
                    <span className="font-latin font-bold text-white">{entry.serverHost}</span>
                    {entry.serverName && (
                      <span className="text-[11px] text-[#b7c9ef]">· {entry.serverName}</span>
                    )}
                    {entry.mediaTitle && (
                      <span className="text-[11px] text-[#b7c9ef]">· {entry.mediaTitle}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#b7c9ef]">{entry.detail}</p>
                  {entry.targetUrl && (
                    <p className="font-latin text-[10px] text-white/60 truncate" dir="ltr">
                      {entry.targetUrl}
                    </p>
                  )}
                </div>

                <span className="font-latin text-[10px] text-[#b7c9ef]/70 shrink-0 tabular-nums" dir="ltr">
                  {new Date(entry.timestamp).toLocaleString('en-GB', {
                    hour12: false,
                    month: 'short',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
