import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  Monitor,
  Smartphone,
  Sparkles,
  Tv,
  Zap,
} from 'lucide-react';
import {
  DEFAULT_DISPLAY_DEVICE_PREFS,
  detectClientCapabilities,
  DisplayDevicePrefs,
  loadDisplayDevicePrefs,
  saveDisplayDevicePrefs,
} from '../../lib/browserCompat';

interface AdminDisplayModesPanelProps {
  onNotify: (msg: string) => void;
}

export function AdminDisplayModesPanel({ onNotify }: AdminDisplayModesPanelProps) {
  const [prefs, setPrefs] = useState<DisplayDevicePrefs>(() => loadDisplayDevicePrefs());
  const capabilities = useMemo(() => detectClientCapabilities(), []);

  const updatePrefs = (patch: Partial<DisplayDevicePrefs>, toastMsg?: string) => {
    const next = saveDisplayDevicePrefs({ ...prefs, ...patch });
    setPrefs(next);
    if (toastMsg) onNotify(toastMsg);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-2">
        <h2 className="font-display text-lg font-extrabold text-white flex items-center gap-2">
          <Tv className="w-5 h-5 text-[#f9c400]" />
          <span>أوضاع العرض والتوافق (الموبايل والتلفاز والأجهزة الضعيفة)</span>
        </h2>
        <p className="text-xs text-[#b7c9ef]">
          ضبط تجربة المستخدم على أجهزة Android TV / Google TV (التحكم بالريموت D-Pad)، والهواتف والأجهزة ذات الذاكرة المحدودة، وفحص قدرات المتصفح الحالي.
        </p>
      </div>

      {/* Mode Toggles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="h-10 w-10 rounded-xl bg-[#f9c400]/15 border border-[#f9c400]/30 flex items-center justify-center text-[#f9c400]">
                <Tv className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-white">وضع التلفاز (TV / D-Pad)</h3>
                <p className="text-[11px] text-[#b7c9ef]">تكبير النص والتركيز للريموت كنترول</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={prefs.tvMode}
              onChange={(e) =>
                updatePrefs(
                  { tvMode: e.target.checked },
                  e.target.checked ? 'تم تفعيل وضع التلفاز على هذا الجهاز' : 'تم إيقاف وضع التلفاز'
                )
              }
              className="h-5 w-5 accent-[#f9c400] cursor-pointer"
            />
          </div>

          <div className="space-y-1.5">
            <span className="block text-[11px] font-bold text-[#b7c9ef]">حجم واجهة التلفاز:</span>
            <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-[#1a242e] p-1 border border-white/10">
              {(
                [
                  { id: 'normal', label: 'عادي' },
                  { id: 'large', label: 'كبير TV' },
                  { id: 'xlarge', label: 'مكبر 4K' },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => updatePrefs({ tvScale: s.id }, `تم ضبط مقياس التلفاز: ${s.label}`)}
                  className={`rounded-lg py-1.5 text-[11px] font-extrabold cursor-pointer ${
                    prefs.tvScale === s.id ? 'bg-[#f9c400] text-[#06131c]' : 'text-[#b7c9ef]'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="h-10 w-10 rounded-xl bg-[#4CAF50]/15 border border-[#4CAF50]/30 flex items-center justify-center text-[#4CAF50]">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-white">وضع الأجهزة الضعيفة</h3>
                <p className="text-[11px] text-[#b7c9ef]">تقليل الضبابية (Blur) والحركات الثقيلة</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={prefs.lowSpecMode}
              onChange={(e) =>
                updatePrefs(
                  { lowSpecMode: e.target.checked },
                  e.target.checked
                    ? 'تم تفعيل وضع الأداء الخفيف للأجهزة المحدودة'
                    : 'تم استعادة المؤثرات البصرية الكاملة'
                )
              }
              className="h-5 w-5 accent-[#4CAF50] cursor-pointer"
            />
          </div>
          <p className="text-[11px] leading-relaxed text-[#b7c9ef]">
            مفيد لأجهزة Android Box القديمة وAndroid WebView والهواتف الاقتصادية لمنع تباطؤ التمرير أثناء تشغيل المشغل.
          </p>
        </div>

        <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="h-10 w-10 rounded-xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-300">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-white">إطار التركيز الواضح</h3>
                <p className="text-[11px] text-[#b7c9ef]">تحديد مرئي عالي التباين عند التنقل بالأسهم</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={prefs.highContrastFocus}
              onChange={(e) =>
                updatePrefs(
                  { highContrastFocus: e.target.checked },
                  'تم تحديث إعداد حلقة التركيز للوحة المفاتيح والريموت'
                )
              }
              className="h-5 w-5 accent-sky-400 cursor-pointer"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              const reset = saveDisplayDevicePrefs({ ...DEFAULT_DISPLAY_DEVICE_PREFS });
              setPrefs(reset);
              onNotify('تمت استعادة إعدادات العرض الافتراضية لهذا الجهاز.');
            }}
            className="text-[11px] font-bold text-[#f9c400] hover:underline cursor-pointer"
          >
            استعادة الإعدادات الافتراضية
          </button>
        </div>
      </div>

      {/* Live Browser & Hardware Compatibility Report */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-base font-extrabold text-white flex items-center gap-2">
            {capabilities.platform === 'desktop' ? (
              <Monitor className="w-4 h-4 text-sky-400" />
            ) : (
              <Smartphone className="w-4 h-4 text-[#4CAF50]" />
            )}
            <span>تشخيص الجهاز والمتصفح الحالي</span>
          </h3>

          <span
            className={`rounded-lg px-3 py-1 text-[11px] font-black ${
              capabilities.baselineSupported
                ? 'bg-[#4CAF50]/15 text-[#4CAF50] border border-[#4CAF50]/35'
                : 'bg-[#D92321]/20 text-[#ff9f9d] border border-[#D92321]/40'
            }`}
          >
            {capabilities.baselineSupported
              ? 'متوافق تماماً مع الحد الأدنى للمنصة'
              : 'متصفح قديم — يُوصى بالتحديث'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="rounded-2xl bg-[#1a242e]/70 p-3 border border-white/5">
            <span className="text-[10px] text-[#b7c9ef]">المتصفح / الإصدار</span>
            <p className="font-latin font-bold text-white mt-0.5">
              {capabilities.browserName} {capabilities.browserVersion}
            </p>
          </div>
          <div className="rounded-2xl bg-[#1a242e]/70 p-3 border border-white/5">
            <span className="text-[10px] text-[#b7c9ef]">المنصة المكتشفة</span>
            <p className="font-latin font-bold text-white mt-0.5">{capabilities.platform}</p>
          </div>
          <div className="rounded-2xl bg-[#1a242e]/70 p-3 border border-white/5">
            <span className="text-[10px] text-[#b7c9ef]">دقة العرض الحالية</span>
            <p className="font-latin font-bold text-white mt-0.5">
              {capabilities.viewportWidth} × {capabilities.viewportHeight}
            </p>
          </div>
          <div className="rounded-2xl bg-[#1a242e]/70 p-3 border border-white/5">
            <span className="text-[10px] text-[#b7c9ef]">الذاكرة / الأنوية</span>
            <p className="font-latin font-bold text-white mt-0.5 flex items-center gap-1">
              <Cpu className="w-3.5 h-3.5 text-[#f9c400]" />
              <span>
                {capabilities.deviceMemoryGb ? `${capabilities.deviceMemoryGb}GB` : '—'} /{' '}
                {capabilities.hardwareConcurrency ? `${capabilities.hardwareConcurrency}c` : '—'}
              </span>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-[11px] font-bold">
          {[
            { label: 'بث HLS الأصلي', ok: capabilities.supportsNativeHls },
            { label: 'MSE (hls.js)', ok: capabilities.supportsMse },
            { label: '100dvh Viewport', ok: capabilities.supportsDvh },
            { label: 'Backdrop Blur', ok: capabilities.supportsBackdropFilter },
            { label: 'Clipboard API', ok: capabilities.supportsClipboardApi },
            { label: 'Service Worker PWA', ok: capabilities.supportsServiceWorker },
          ].map((cap) => (
            <div
              key={cap.label}
              className="rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 flex items-center justify-between gap-2"
            >
              <span className="text-[#b7c9ef]">{cap.label}</span>
              <span className={cap.ok ? 'text-[#4CAF50]' : 'text-[#f9c400]'}>
                {cap.ok ? 'مدعوم' : 'بديل مفعّل'}
              </span>
            </div>
          ))}
        </div>

        {capabilities.baselineNotes.length > 0 && (
          <div className="rounded-2xl bg-[#f9c400]/10 border border-[#f9c400]/30 p-3.5 space-y-1 text-xs text-[#fde68a]">
            {capabilities.baselineNotes.map((note, idx) => (
              <p key={idx} className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{note}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
