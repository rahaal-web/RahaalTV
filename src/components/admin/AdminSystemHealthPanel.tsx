import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  Database,
  ExternalLink,
  Globe,
  Loader2,
  Play,
  Server,
  ShieldCheck,
  Wifi,
  Wrench,
} from 'lucide-react';
import { User } from 'firebase/auth';
import { collection, getDocs, limit, query } from 'firebase/firestore';
import firebaseConfig from '../../../firebase-applet-config.json';
import { db } from '../../lib/firebase';
import { detectClientCapabilities } from '../../lib/browserCompat';
import {
  resolveApiEndpoint,
  shouldSkipBackendApiCalls,
  testCloudflareWorkerConnection,
} from '../../lib/clientScraper';
import { MediaItem, ScraperAdapter } from '../../types/media';

interface AdminSystemHealthPanelProps {
  user: User | null;
  catalog: MediaItem[];
  adapters: ScraperAdapter[];
  customApiUrl: string;
  onNotify: (msg: string) => void;
}

interface ProbeStatus {
  status: 'idle' | 'running' | 'ok' | 'warn' | 'error';
  latencyMs?: number;
  detail: string;
}

export function AdminSystemHealthPanel({
  user,
  catalog,
  adapters,
  customApiUrl,
  onNotify,
}: AdminSystemHealthPanelProps) {
  const [firestoreProbe, setFirestoreProbe] = useState<ProbeStatus>({
    status: 'idle',
    detail: 'اضغط "تشغيل الفحص الكامل" لقياس زمن الاستجابة الفعلي لـ Firestore.',
  });
  const [workerProbe, setWorkerProbe] = useState<ProbeStatus>({
    status: 'idle',
    detail: customApiUrl
      ? `جاهز لفحص: ${customApiUrl}`
      : 'لم يتم تعيين رابط Cloudflare Worker مخصص بعد.',
  });
  const [backendProbe, setBackendProbe] = useState<ProbeStatus>({
    status: 'idle',
    detail: shouldSkipBackendApiCalls()
      ? 'الاستضافة الحالية ثابتة (GitHub Pages) بدون خادم Node.js خلفي.'
      : 'جاهز لفحص نقطة /api/health على خادم Node.js.',
  });
  const [runningAll, setRunningAll] = useState(false);

  const capabilities = useMemo(() => detectClientCapabilities(), []);
  const swActive =
    typeof navigator !== 'undefined' && Boolean(navigator.serviceWorker?.controller);

  const runDiagnostics = async () => {
    setRunningAll(true);

    // 1. Live Firestore Read Probe
    setFirestoreProbe({ status: 'running', detail: 'جاري اختبار قراءة Firestore...' });
    const fsStart = performance.now();
    try {
      await getDocs(query(collection(db, 'media'), limit(1)));
      const ms = Math.round(performance.now() - fsStart);
      setFirestoreProbe({
        status: 'ok',
        latencyMs: ms,
        detail: `اتصال ناجح بقاعدة البيانات (${firebaseConfig.firestoreDatabaseId}) خلال ${ms}ms.`,
      });
    } catch (err) {
      setFirestoreProbe({
        status: 'error',
        detail: `فشل قراءة Firestore: ${err instanceof Error ? err.message : 'خطأ صلاحيات/شبكة'}`,
      });
    }

    // 2. Cloudflare Worker Probe
    if (customApiUrl.trim()) {
      setWorkerProbe({ status: 'running', detail: 'جاري اختبار Cloudflare Worker...' });
      const wkStart = performance.now();
      try {
        const res = await testCloudflareWorkerConnection(customApiUrl);
        const ms = Math.round(performance.now() - wkStart);
        setWorkerProbe({
          status: res.ok ? 'ok' : 'error',
          latencyMs: ms,
          detail: res.message,
        });
      } catch (err) {
        setWorkerProbe({
          status: 'error',
          detail: err instanceof Error ? err.message : 'تعذر الاتصال بالـ Worker',
        });
      }
    } else {
      setWorkerProbe({
        status: 'warn',
        detail: 'لا يوجد رابط Cloudflare Worker محفوظ — الجلب يعتمد على المتصفح أو خادم Node المحلي.',
      });
    }

    // 3. Node Backend /api/health Probe
    if (shouldSkipBackendApiCalls()) {
      setBackendProbe({
        status: 'warn',
        detail: 'وضع الاستضافة الثابتة (GitHub Pages): نقاط /api/* غير مفعلة هنا وتعمل عبر Worker أو المتصفح.',
      });
    } else {
      setBackendProbe({ status: 'running', detail: 'جاري فحص /api/health...' });
      const apiStart = performance.now();
      try {
        const resp = await fetch(resolveApiEndpoint('/api/health'));
        const ms = Math.round(performance.now() - apiStart);
        if (resp.ok) {
          setBackendProbe({
            status: 'ok',
            latencyMs: ms,
            detail: `خادم Node.js المدمج يستجيب بنجاح (${ms}ms).`,
          });
        } else {
          setBackendProbe({
            status: 'warn',
            latencyMs: ms,
            detail: `استجاب الخادم بالحالة HTTP ${resp.status}.`,
          });
        }
      } catch {
        setBackendProbe({
          status: 'warn',
          detail: 'تعذر الوصول إلى خادم Node المحلي (ربما تعمل في بيئة ثابتة).',
        });
      }
    }

    setRunningAll(false);
    onNotify('اكتمل الفحص الحي لصحة النظام وروابط الربط.');
  };

  const renderBadge = (status: ProbeStatus['status']) => {
    if (status === 'running') {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/15 px-2 py-0.5 text-[10px] font-black text-sky-300">
          <Loader2 className="w-3 h-3 animate-spin" />
          جاري الفحص
        </span>
      );
    }
    if (status === 'ok') {
      return (
        <span className="rounded-md bg-[#4CAF50]/20 px-2 py-0.5 text-[10px] font-black text-[#4CAF50]">
          متصل وسليم
        </span>
      );
    }
    if (status === 'warn') {
      return (
        <span className="rounded-md bg-[#f9c400]/20 px-2 py-0.5 text-[10px] font-black text-[#f9c400]">
          تنبيه / بديل
        </span>
      );
    }
    if (status === 'error') {
      return (
        <span className="rounded-md bg-[#D92321]/20 px-2 py-0.5 text-[10px] font-black text-[#ff9f9d]">
          فشل الاتصال
        </span>
      );
    }
    return (
      <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-bold text-[#b7c9ef]">
        بانتظار الفحص
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-extrabold text-white flex items-center gap-2">
            <Cpu className="w-5 h-5 text-[#4CAF50]" />
            <span>مركز صحة النظام والاتصالات الحية</span>
          </h2>
          <p className="text-xs text-[#b7c9ef] mt-1">
            اختبار حقيقي لـ Firebase Auth و Firestore و Cloudflare Worker وخادم Node.js و Service Worker بدون بيانات وهمية.
          </p>
        </div>

        <button
          type="button"
          disabled={runningAll}
          onClick={() => void runDiagnostics()}
          className="inline-flex items-center gap-2 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-50 px-5 py-2.5 text-xs font-extrabold text-white cursor-pointer shadow-lg"
        >
          {runningAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          <span>تشغيل الفحص الكامل الآن</span>
        </button>
      </div>

      {/* Live Probe Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-white flex items-center gap-2">
              <Database className="w-4 h-4 text-[#f9c400]" />
              قاعدة بيانات Firestore
            </span>
            {renderBadge(firestoreProbe.status)}
          </div>
          <p className="text-xs text-[#b7c9ef] leading-relaxed">{firestoreProbe.detail}</p>
          <p className="font-latin text-[10px] text-white/60">
            Project: {firebaseConfig.projectId} • DB: {firebaseConfig.firestoreDatabaseId}
          </p>
        </div>

        <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#4CAF50]" />
              مصادقة Firebase Auth
            </span>
            <span className="rounded-md bg-[#4CAF50]/20 px-2 py-0.5 text-[10px] font-black text-[#4CAF50]">
              {user ? 'جلسة مصادقة نشطة' : 'غير مسجل'}
            </span>
          </div>
          <p className="text-xs text-[#b7c9ef]">
            {user
              ? `الحساب الحالي: ${user.email || user.displayName || user.uid}`
              : 'لا توجد جلسة مستخدم مسجلة حالياً.'}
          </p>
          <p className="font-latin text-[10px] text-white/60">UID: {user?.uid || '—'}</p>
        </div>

        <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-white flex items-center gap-2">
              <Globe className="w-4 h-4 text-sky-400" />
              Cloudflare Worker Proxy
            </span>
            {renderBadge(workerProbe.status)}
          </div>
          <p className="text-xs text-[#b7c9ef] leading-relaxed">{workerProbe.detail}</p>
        </div>

        <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-white flex items-center gap-2">
              <Server className="w-4 h-4 text-purple-400" />
              خادم Node.js المدمج (/api/*)
            </span>
            {renderBadge(backendProbe.status)}
          </div>
          <p className="text-xs text-[#b7c9ef] leading-relaxed">{backendProbe.detail}</p>
        </div>
      </div>

      {/* PWA & Adapters Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-bold text-white">
            <span className="flex items-center gap-1.5">
              <Wifi className="w-4 h-4 text-[#4CAF50]" />
              Service Worker / PWA
            </span>
            <span className={swActive ? 'text-[#4CAF50]' : 'text-[#b7c9ef]'}>
              {swActive ? 'يعمل' : 'وضع المعاينة'}
            </span>
          </div>
          <p className="text-[11px] text-[#b7c9ef]">
            الشبكة الحالية: {navigator.onLine ? 'متصل بالإنترنت' : 'غير متصل (Offline)'}
          </p>
        </div>

        <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-bold text-white">
            <span className="flex items-center gap-1.5">
              <Wrench className="w-4 h-4 text-[#f9c400]" />
              محولات مصادر الجلب
            </span>
            <span className="font-latin text-[#f9c400]">{adapters.length} محوّل</span>
          </div>
          <p className="text-[11px] text-[#b7c9ef]">
            مُدمجة مع الجالب الأحادي وجالب المواقع.
          </p>
        </div>

        <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-bold text-white">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-sky-400" />
              توافق المتصفح والكتالوج
            </span>
            <span className="font-latin text-white">{catalog.length} عمل</span>
          </div>
          <p className="text-[11px] text-[#b7c9ef]">
            {capabilities.browserName} {capabilities.browserVersion} ({capabilities.platform})
          </p>
        </div>
      </div>

      <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[#b7c9ef]">
        <span>الحد الأدنى الرسمي المدعوم: Chrome / Android WebView 90+ • Firefox 90+ • Safari 15+ • Edge 90+.</span>
        <a
          href={`https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[#f9c400] font-bold hover:underline"
        >
          <span>لوحة Firebase Console</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}
