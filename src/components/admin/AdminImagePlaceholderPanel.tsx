import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  Film,
  Image as ImageIcon,
  ImageOff,
  RotateCcw,
  Sparkles,
  Tv,
  Upload,
  User as UserIcon,
  XCircle,
} from 'lucide-react';
import type {
  ImagePlaceholderConfig,
  ImagePlaceholderMode,
  ImagePlaceholderSlotKey,
  MediaItem,
} from '../../types/media';
import {
  clearPreviewPlaceholderConfig,
  DEFAULT_IMAGE_PLACEHOLDER_CONFIG,
  normalizeImagePlaceholderConfig,
  PLACEHOLDER_GRADIENT_PRESETS,
  setPreviewPlaceholderConfig,
} from '../../lib/placeholderConfig';
import {
  formatBytesReadable,
  uploadOptimizedImageAsset,
} from '../../lib/imageCompressor';
import { getActiveAuthInstance } from '../../lib/dbConnectionManager';
import { OptimizedImage } from '../OptimizedImage';

interface AdminImagePlaceholderPanelProps {
  config: ImagePlaceholderConfig;
  sampleMedia?: MediaItem[];
  busy?: boolean;
  onSaveConfig: (next: ImagePlaceholderConfig) => Promise<void>;
  onNotify: (msg: string) => void;
}

const PLACEHOLDER_MODES: Array<{ id: ImagePlaceholderMode; label: string; desc: string }> = [
  { id: 'shimmer', label: 'توهج سينمائي (Shimmer)', desc: 'تدرج داكن مع موجة تحميل ناعمة' },
  { id: 'gradient', label: 'تدرج لوني ثابت', desc: 'خلفية بتدرج لونين مخصصين بدون حركة' },
  { id: 'solid', label: 'لون موحد هادئ', desc: 'لون خلفية ثابت خفيف للأجهزة الضعيفة' },
  { id: 'logo_badge', label: 'شعار RahaL TV بالمنتصف', desc: 'خلفية داكنة مع شعار المنصة المائي' },
  { id: 'custom_image', label: 'صورة مؤقتة مخصصة', desc: 'عرض صورة مضغوطة مخصصة حتى التحميل' },
];

const SLOT_TABS: Array<{ id: 'global' | ImagePlaceholderSlotKey; label: string }> = [
  { id: 'global', label: 'الإعداد العام (الافتراضي)' },
  { id: 'poster', label: 'بوسترات الأفلام والمسلسلات' },
  { id: 'backdrop', label: 'الخلفيات العريضة (Backdrop)' },
  { id: 'cast', label: 'صور الممثلين' },
  { id: 'episode', label: 'صور الحلقات (16:9)' },
];

export function AdminImagePlaceholderPanel({
  config,
  sampleMedia = [],
  busy = false,
  onSaveConfig,
  onNotify,
}: AdminImagePlaceholderPanelProps) {
  const [draft, setDraft] = useState<ImagePlaceholderConfig>(() =>
    normalizeImagePlaceholderConfig(config)
  );
  const [activeSlotTab, setActiveSlotTab] = useState<'global' | ImagePlaceholderSlotKey>('global');
  const [previewState, setPreviewState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [livePreviewEnabled, setLivePreviewEnabled] = useState(false);
  const [uploadingPlaceholder, setUploadingPlaceholder] = useState(false);
  const [uploadingFallback, setUploadingFallback] = useState(false);
  const [lastUploadStats, setLastUploadStats] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(normalizeImagePlaceholderConfig(config));
  }, [config]);

  useEffect(() => {
    if (livePreviewEnabled) {
      setPreviewPlaceholderConfig(draft);
    } else {
      clearPreviewPlaceholderConfig();
    }
    return () => {
      clearPreviewPlaceholderConfig();
    };
  }, [draft, livePreviewEnabled]);

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(normalizeImagePlaceholderConfig(config)),
    [draft, config]
  );

  const sampleMovie = sampleMedia[0];
  const sampleSeries = sampleMedia.find((m) => m.kind === 'series') || sampleMedia[1] || sampleMedia[0];

  const getToken = async (): Promise<string | undefined> => {
    try {
      const user = getActiveAuthInstance().currentUser;
      return user ? await user.getIdToken() : undefined;
    } catch {
      return undefined;
    }
  };

  const updateGlobal = (patch: Partial<ImagePlaceholderConfig>) => {
    setDraft((prev) => normalizeImagePlaceholderConfig({ ...prev, ...patch }));
  };

  const updateSlotOverride = (
    slotKey: ImagePlaceholderSlotKey,
    patch: Partial<ImagePlaceholderConfig['slotOverrides'][ImagePlaceholderSlotKey]>
  ) => {
    setDraft((prev) =>
      normalizeImagePlaceholderConfig({
        ...prev,
        slotOverrides: {
          ...prev.slotOverrides,
          [slotKey]: {
            ...prev.slotOverrides[slotKey],
            ...patch,
          },
        },
      })
    );
  };

  const handleUploadAsset = async (
    e: ChangeEvent<HTMLInputElement>,
    targetKind: 'placeholder' | 'fallback'
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (targetKind === 'placeholder') setUploadingPlaceholder(true);
    else setUploadingFallback(true);

    try {
      const idToken = await getToken();
      const uploaded = await uploadOptimizedImageAsset({
        file,
        slot: targetKind,
        idToken,
      });

      const statsMsg = `تم الضغط: ${formatBytesReadable(uploaded.compression.beforeBytes)} ← ${formatBytesReadable(
        uploaded.compression.afterBytes
      )} (${uploaded.compression.savedPct > 0 ? `توفير ${uploaded.compression.savedPct}%` : 'تم الاحتفاظ بالحجم الأمثل'})`;
      setLastUploadStats(statsMsg);

      if (activeSlotTab === 'global') {
        if (targetKind === 'placeholder') {
          updateGlobal({ customImageUrl: uploaded.url, mode: 'custom_image' });
        } else {
          updateGlobal({ errorFallbackImageUrl: uploaded.url });
        }
      } else {
        if (targetKind === 'placeholder') {
          updateSlotOverride(activeSlotTab, {
            enabled: true,
            customImageUrl: uploaded.url,
            mode: 'custom_image',
          });
        } else {
          updateSlotOverride(activeSlotTab, {
            enabled: true,
            errorFallbackImageUrl: uploaded.url,
          });
        }
      }

      onNotify(`تم رفع وتجهيز الصورة بنجاح — ${statsMsg}`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر رفع الصورة');
    } finally {
      setUploadingPlaceholder(false);
      setUploadingFallback(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveConfig(draft);
      setLivePreviewEnabled(false);
      clearPreviewPlaceholderConfig();
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    const def = normalizeImagePlaceholderConfig(DEFAULT_IMAGE_PLACEHOLDER_CONFIG);
    setDraft(def);
    setSaving(true);
    try {
      await onSaveConfig(def);
      setLivePreviewEnabled(false);
      clearPreviewPlaceholderConfig();
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(normalizeImagePlaceholderConfig(config));
    setLivePreviewEnabled(false);
    clearPreviewPlaceholderConfig();
    onNotify('تم إلغاء التعديلات غير المحفوظة.');
  };

  const currentSlotOv =
    activeSlotTab === 'global' ? null : draft.slotOverrides[activeSlotTab];

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-teal-500/15 border border-teal-400/35 text-teal-300">
            <ImageIcon className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg sm:text-xl font-extrabold text-white">
                إعدادات الصور والخلفيات المؤقتة (Placeholders & Error Fallback)
              </h2>
              <span className="rounded-lg bg-teal-500/15 border border-teal-400/35 px-2.5 py-0.5 text-[10px] font-extrabold text-teal-300">
                بدون وميض أو قفز تخطيط (Zero CLS)
              </span>
            </div>
            <p className="text-xs text-[#b7c9ef] mt-1">
              تحكم احترافي في خلفية التحميل المؤقتة لكل بطاقة، تأثير Shimmer، شعار التحميل المائي، وصورة بديلة مستقلة عند تعذر تحميل أي رابط صورة.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setLivePreviewEnabled((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-xs font-extrabold transition-colors cursor-pointer ${
              livePreviewEnabled
                ? 'bg-[#f9c400] border-[#f9c400] text-[#06131c]'
                : 'bg-[#1a242e] border-white/15 text-white hover:border-[#f9c400]'
            }`}
          >
            <Eye className="w-4 h-4" />
            <span>{livePreviewEnabled ? 'إيقاف المعاينة الحية' : 'معاينة على الموقع'}</span>
          </button>

          {isDirty && (
            <button
              type="button"
              disabled={busy || saving}
              onClick={handleCancel}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/[0.06] border border-white/15 px-3.5 py-2.5 text-xs font-bold text-[#b7c9ef] hover:text-white cursor-pointer"
            >
              <XCircle className="w-4 h-4" />
              <span>إلغاء</span>
            </button>
          )}

          <button
            type="button"
            disabled={busy || saving}
            onClick={() => void handleReset()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white/[0.06] border border-white/15 px-3.5 py-2.5 text-xs font-bold text-white hover:bg-white/10 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>استعادة الافتراضي</span>
          </button>

          <button
            type="button"
            disabled={busy || saving}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#D92321] hover:bg-[#dc0e30] px-5 py-2.5 text-xs font-extrabold text-white shadow-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{saving ? 'جاري الحفظ...' : isDirty ? 'حفظ الإعدادات' : 'تم الحفظ'}</span>
          </button>
        </div>
      </div>

      {/* Slot Selector Tabs */}
      <div className="flex flex-wrap gap-2">
        {SLOT_TABS.map((tab) => {
          const isOvEnabled =
            tab.id !== 'global' && draft.slotOverrides[tab.id]?.enabled;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSlotTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold border transition-colors cursor-pointer ${
                activeSlotTab === tab.id
                  ? 'bg-[#D92321] border-[#ff5a58] text-white'
                  : 'bg-[#0c1821] border-white/10 text-[#b7c9ef] hover:text-white'
              }`}
            >
              <span>{tab.label}</span>
              {isOvEnabled && (
                <span className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] text-[#f9c400]">
                  مخصص
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Controls Grid + Live 5-Card Preview */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Controls Column */}
        <div className="xl:col-span-7 space-y-5">
          {activeSlotTab !== 'global' && currentSlotOv && (
            <div className="rounded-2xl bg-[#101e29] border border-teal-400/30 p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-extrabold text-white">
                  تخصيص مستقل لقسم: {SLOT_TABS.find((t) => t.id === activeSlotTab)?.label}
                </p>
                <p className="text-[11px] text-[#b7c9ef] mt-0.5">
                  عند التعطيل يرث هذا القسم الإعداد العام تلقائياً.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-extrabold text-white">
                <input
                  type="checkbox"
                  checked={currentSlotOv.enabled}
                  onChange={(e) =>
                    updateSlotOverride(activeSlotTab, { enabled: e.target.checked })
                  }
                  className="h-4 w-4 accent-[#D92321]"
                />
                <span>تفعيل التخصيص</span>
              </label>
            </div>
          )}

          {/* Mode Selection */}
          <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-4">
            <h3 className="font-display text-sm font-extrabold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#f9c400]" />
              <span>نمط الخلفية المؤقتة أثناء التحميل</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {PLACEHOLDER_MODES.map((m) => {
                const activeMode =
                  activeSlotTab === 'global' ? draft.mode : currentSlotOv?.mode;
                const isSelected = activeMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() =>
                      activeSlotTab === 'global'
                        ? updateGlobal({ mode: m.id })
                        : updateSlotOverride(activeSlotTab, { enabled: true, mode: m.id })
                    }
                    className={`rounded-2xl border p-3.5 text-right transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#D92321]/15 border-[#D92321] text-white'
                        : 'bg-[#101e29] border-white/[0.08] text-[#b7c9ef] hover:border-white/25'
                    }`}
                  >
                    <p className="text-xs font-extrabold text-white">{m.label}</p>
                    <p className="text-[11px] text-[#b7c9ef]/80 mt-0.5">{m.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Colors & Gradient Presets */}
          <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-4">
            <h3 className="font-display text-sm font-extrabold text-white">
              الألوان والتدرج اللوني
            </h3>

            <div className="flex flex-wrap gap-2">
              {PLACEHOLDER_GRADIENT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    activeSlotTab === 'global'
                      ? updateGlobal({
                          primaryColor: preset.primaryColor,
                          secondaryColor: preset.secondaryColor,
                          gradientAngle: preset.gradientAngle,
                        })
                      : updateSlotOverride(activeSlotTab, {
                          enabled: true,
                          primaryColor: preset.primaryColor,
                          secondaryColor: preset.secondaryColor,
                          gradientAngle: preset.gradientAngle,
                        })
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-[#101e29] border border-white/10 px-3 py-1.5 text-[11px] font-bold text-white hover:border-[#f9c400] cursor-pointer"
                >
                  <span
                    className="h-4 w-4 rounded-md border border-white/25"
                    style={{
                      background: `linear-gradient(${preset.gradientAngle}deg, ${preset.primaryColor}, ${preset.secondaryColor})`,
                    }}
                  />
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1.5">
                  اللون الأساسي
                </label>
                <div className="flex items-center gap-2 rounded-xl bg-[#101e29] border border-white/10 p-2">
                  <input
                    type="color"
                    value={
                      activeSlotTab === 'global'
                        ? draft.primaryColor
                        : currentSlotOv?.primaryColor || draft.primaryColor
                    }
                    onChange={(e) =>
                      activeSlotTab === 'global'
                        ? updateGlobal({ primaryColor: e.target.value })
                        : updateSlotOverride(activeSlotTab, {
                            enabled: true,
                            primaryColor: e.target.value,
                          })
                    }
                    className="h-8 w-10 rounded cursor-pointer bg-transparent border-0"
                  />
                  <span className="font-latin text-xs font-bold text-white">
                    {activeSlotTab === 'global'
                      ? draft.primaryColor
                      : currentSlotOv?.primaryColor}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1.5">
                  اللون الثانوي (للتدرج)
                </label>
                <div className="flex items-center gap-2 rounded-xl bg-[#101e29] border border-white/10 p-2">
                  <input
                    type="color"
                    value={
                      activeSlotTab === 'global'
                        ? draft.secondaryColor
                        : currentSlotOv?.secondaryColor || draft.secondaryColor
                    }
                    onChange={(e) =>
                      activeSlotTab === 'global'
                        ? updateGlobal({ secondaryColor: e.target.value })
                        : updateSlotOverride(activeSlotTab, {
                            enabled: true,
                            secondaryColor: e.target.value,
                          })
                    }
                    className="h-8 w-10 rounded cursor-pointer bg-transparent border-0"
                  />
                  <span className="font-latin text-xs font-bold text-white">
                    {activeSlotTab === 'global'
                      ? draft.secondaryColor
                      : currentSlotOv?.secondaryColor}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1.5">
                  زاوية التدرج (
                  <span className="font-latin tabular-nums">
                    {activeSlotTab === 'global'
                      ? draft.gradientAngle
                      : currentSlotOv?.gradientAngle}
                    °
                  </span>
                  )
                </label>
                <input
                  type="range"
                  min={0}
                  max={360}
                  value={
                    activeSlotTab === 'global'
                      ? draft.gradientAngle
                      : currentSlotOv?.gradientAngle || 145
                  }
                  onChange={(e) =>
                    activeSlotTab === 'global'
                      ? updateGlobal({ gradientAngle: Number(e.target.value) })
                      : updateSlotOverride(activeSlotTab, {
                          enabled: true,
                          gradientAngle: Number(e.target.value),
                        })
                  }
                  className="w-full accent-[#D92321] mt-2"
                />
              </div>
            </div>
          </div>

          {/* Shimmer, Watermark & Dim Controls */}
          <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-4">
            <h3 className="font-display text-sm font-extrabold text-white">
              تأثيرات التحميل والشفافية
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex items-center justify-between rounded-2xl bg-[#101e29] border border-white/[0.08] p-3.5 cursor-pointer">
                <div>
                  <span className="text-xs font-extrabold text-white block">تأثير موجة التحميل (Shimmer)</span>
                  <span className="text-[11px] text-[#b7c9ef]">يتعطل تلقائياً في وضع الأجهزة الضعيفة</span>
                </div>
                <input
                  type="checkbox"
                  checked={draft.shimmerEnabled}
                  onChange={(e) => updateGlobal({ shimmerEnabled: e.target.checked })}
                  className="h-4 w-4 accent-[#D92321]"
                />
              </label>

              <div className="rounded-2xl bg-[#101e29] border border-white/[0.08] p-3.5 space-y-1.5">
                <label className="block text-xs font-extrabold text-white">سرعة موجة التحميل</label>
                <div className="flex gap-1.5">
                  {(['slow', 'normal', 'fast'] as const).map((sp) => (
                    <button
                      key={sp}
                      type="button"
                      onClick={() => updateGlobal({ shimmerSpeed: sp })}
                      className={`flex-1 rounded-lg py-1.5 text-[11px] font-bold cursor-pointer ${
                        draft.shimmerSpeed === sp
                          ? 'bg-[#D92321] text-white'
                          : 'bg-[#0c1821] text-[#b7c9ef]'
                      }`}
                    >
                      {sp === 'slow' ? 'هادئة' : sp === 'fast' ? 'سريعة' : 'متوازنة'}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center justify-between rounded-2xl bg-[#101e29] border border-white/[0.08] p-3.5 cursor-pointer">
                <span className="text-xs font-extrabold text-white">إظهار شعار RahaL TV المائي</span>
                <input
                  type="checkbox"
                  checked={
                    activeSlotTab === 'global'
                      ? draft.showLogoOverlay
                      : Boolean(currentSlotOv?.showLogoOverlay)
                  }
                  onChange={(e) =>
                    activeSlotTab === 'global'
                      ? updateGlobal({ showLogoOverlay: e.target.checked })
                      : updateSlotOverride(activeSlotTab, {
                          enabled: true,
                          showLogoOverlay: e.target.checked,
                        })
                  }
                  className="h-4 w-4 accent-[#D92321]"
                />
              </label>

              <label className="flex items-center justify-between rounded-2xl bg-[#101e29] border border-white/[0.08] p-3.5 cursor-pointer">
                <span className="text-xs font-extrabold text-white">إظهار أيقونة نوع المحتوى</span>
                <input
                  type="checkbox"
                  checked={
                    activeSlotTab === 'global'
                      ? draft.showFallbackIcon
                      : Boolean(currentSlotOv?.showFallbackIcon)
                  }
                  onChange={(e) =>
                    activeSlotTab === 'global'
                      ? updateGlobal({ showFallbackIcon: e.target.checked })
                      : updateSlotOverride(activeSlotTab, {
                          enabled: true,
                          showFallbackIcon: e.target.checked,
                        })
                  }
                  className="h-4 w-4 accent-[#D92321]"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div>
                <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                  شفافية الشعار المائي ({draft.logoOverlayOpacityPct}%)
                </label>
                <input
                  type="range"
                  min={5}
                  max={90}
                  value={draft.logoOverlayOpacityPct}
                  onChange={(e) =>
                    updateGlobal({ logoOverlayOpacityPct: Number(e.target.value) })
                  }
                  className="w-full accent-[#D92321]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                  تعتيم الخلفية فوق الصورة المؤقتة (
                  {activeSlotTab === 'global'
                    ? draft.backdropDimPct
                    : currentSlotOv?.dimOpacityPct}
                  %)
                </label>
                <input
                  type="range"
                  min={0}
                  max={85}
                  value={
                    activeSlotTab === 'global'
                      ? draft.backdropDimPct
                      : currentSlotOv?.dimOpacityPct || 25
                  }
                  onChange={(e) =>
                    activeSlotTab === 'global'
                      ? updateGlobal({ backdropDimPct: Number(e.target.value) })
                      : updateSlotOverride(activeSlotTab, {
                          enabled: true,
                          dimOpacityPct: Number(e.target.value),
                        })
                  }
                  className="w-full accent-[#D92321]"
                />
              </div>
            </div>
          </div>

          {/* Custom Loading Placeholder Image & Separate Error Fallback Image */}
          <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-sm font-extrabold text-white">
                رفع صورة مؤقتة وصورة بديلة عند فشل التحميل (مع ضغط WebP/AVIF تلقائي)
              </h3>
              {lastUploadStats && (
                <span className="text-[11px] font-bold text-emerald-400">{lastUploadStats}</span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Custom Loading Placeholder Image */}
              <div className="rounded-2xl bg-[#101e29] border border-white/[0.08] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-white">
                    صورة الانتظار المؤقتة (Loading)
                  </span>
                  {(activeSlotTab === 'global'
                    ? draft.customImageUrl
                    : currentSlotOv?.customImageUrl) && (
                    <button
                      type="button"
                      onClick={() =>
                        activeSlotTab === 'global'
                          ? updateGlobal({ customImageUrl: '', mode: 'shimmer' })
                          : updateSlotOverride(activeSlotTab, { customImageUrl: '' })
                      }
                      className="text-[11px] font-bold text-[#ff8a88] hover:underline cursor-pointer"
                    >
                      إزالة
                    </button>
                  )}
                </div>

                <input
                  type="url"
                  dir="ltr"
                  placeholder="https://... أو ارفع صورة من الجهاز"
                  value={
                    activeSlotTab === 'global'
                      ? draft.customImageUrl
                      : currentSlotOv?.customImageUrl || ''
                  }
                  onChange={(e) =>
                    activeSlotTab === 'global'
                      ? updateGlobal({ customImageUrl: e.target.value })
                      : updateSlotOverride(activeSlotTab, {
                          enabled: true,
                          customImageUrl: e.target.value,
                        })
                  }
                  className="w-full rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 font-latin text-xs text-white focus:border-[#f9c400] focus:outline-none"
                />

                <label className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/15 py-2.5 text-xs font-extrabold text-white cursor-pointer">
                  <Upload className="w-4 h-4 text-teal-300" />
                  <span>
                    {uploadingPlaceholder ? 'جاري الضغط والرفع...' : 'رفع وضغط صورة الانتظار'}
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/avif,image/svg+xml"
                    className="hidden"
                    disabled={uploadingPlaceholder}
                    onChange={(e) => void handleUploadAsset(e, 'placeholder')}
                  />
                </label>
              </div>

              {/* Separate Error Fallback Image */}
              <div className="rounded-2xl bg-[#101e29] border border-white/[0.08] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-white flex items-center gap-1.5">
                    <ImageOff className="w-3.5 h-3.5 text-[#f9c400]" />
                    <span>صورة الفشل البديلة (Error Fallback)</span>
                  </span>
                  {(activeSlotTab === 'global'
                    ? draft.errorFallbackImageUrl
                    : currentSlotOv?.errorFallbackImageUrl) && (
                    <button
                      type="button"
                      onClick={() =>
                        activeSlotTab === 'global'
                          ? updateGlobal({ errorFallbackImageUrl: '' })
                          : updateSlotOverride(activeSlotTab, { errorFallbackImageUrl: '' })
                      }
                      className="text-[11px] font-bold text-[#ff8a88] hover:underline cursor-pointer"
                    >
                      إزالة
                    </button>
                  )}
                </div>

                <input
                  type="url"
                  dir="ltr"
                  placeholder="https://... أو ارفع صورة بديلة للروابط التالفة"
                  value={
                    activeSlotTab === 'global'
                      ? draft.errorFallbackImageUrl
                      : currentSlotOv?.errorFallbackImageUrl || ''
                  }
                  onChange={(e) =>
                    activeSlotTab === 'global'
                      ? updateGlobal({ errorFallbackImageUrl: e.target.value })
                      : updateSlotOverride(activeSlotTab, {
                          enabled: true,
                          errorFallbackImageUrl: e.target.value,
                        })
                  }
                  className="w-full rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 font-latin text-xs text-white focus:border-[#f9c400] focus:outline-none"
                />

                <label className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/15 py-2.5 text-xs font-extrabold text-white cursor-pointer">
                  <Upload className="w-4 h-4 text-[#f9c400]" />
                  <span>
                    {uploadingFallback ? 'جاري الضغط والرفع...' : 'رفع وضغط صورة الفشل'}
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/avif,image/svg+xml"
                    className="hidden"
                    disabled={uploadingFallback}
                    onChange={(e) => void handleUploadAsset(e, 'fallback')}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Live 5-Card Preview Column */}
        <div className="xl:col-span-5">
          <div className="sticky top-4 rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-sm font-extrabold text-white">
                معاينة حية للبطاقات (5 قوالب)
              </h3>
              <div className="flex items-center gap-1 rounded-xl bg-[#101e29] p-1 border border-white/10">
                {(
                  [
                    { id: 'loading', label: 'أثناء التحميل' },
                    { id: 'loaded', label: 'مكتمل' },
                    { id: 'error', label: 'صورة تالفة' },
                  ] as const
                ).map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setPreviewState(st.id)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer transition-colors ${
                      previewState === st.id
                        ? 'bg-[#D92321] text-white'
                        : 'text-[#b7c9ef] hover:text-white'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Row 1: Movie Poster + Series Poster */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-[#b7c9ef] flex items-center gap-1">
                  <Film className="w-3 h-3 text-[#D92321]" />
                  بطاقة فيلم (2:3)
                </span>
                <div className="aspect-[2/3] rounded-xl overflow-hidden border border-white/10">
                  <OptimizedImage
                    src={sampleMovie?.poster_url || sampleMovie?.poster}
                    alt={sampleMovie?.title || 'فيلم'}
                    slot="card_grid"
                    configOverride={draft}
                    forcePreviewState={previewState}
                    className="h-full w-full"
                    imgClassName="object-cover"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-[#b7c9ef] flex items-center gap-1">
                  <Tv className="w-3 h-3 text-[#f9c400]" />
                  بطاقة مسلسل (2:3)
                </span>
                <div className="aspect-[2/3] rounded-xl overflow-hidden border border-white/10">
                  <OptimizedImage
                    src={sampleSeries?.poster_url || sampleSeries?.poster}
                    alt={sampleSeries?.title || 'مسلسل'}
                    slot="card_grid"
                    configOverride={draft}
                    forcePreviewState={previewState}
                    className="h-full w-full"
                    imgClassName="object-cover"
                  />
                </div>
              </div>
            </div>

            {/* Row 2: Episode 16:9 + Cast Avatar */}
            <div className="grid grid-cols-3 gap-3 items-center">
              <div className="col-span-2 space-y-1.5">
                <span className="text-[11px] font-bold text-[#b7c9ef] block">
                  صورة حلقة (16:9)
                </span>
                <div className="aspect-video rounded-xl overflow-hidden border border-white/10">
                  <OptimizedImage
                    src={sampleSeries?.backdrop_url || sampleSeries?.backdrop}
                    alt="صورة الحلقة"
                    slot="episode_thumb"
                    configOverride={draft}
                    forcePreviewState={previewState}
                    className="h-full w-full"
                    imgClassName="object-cover"
                  />
                </div>
              </div>

              <div className="space-y-1.5 text-center">
                <span className="text-[11px] font-bold text-[#b7c9ef] flex items-center justify-center gap-1">
                  <UserIcon className="w-3 h-3" />
                  ممثل
                </span>
                <div className="mx-auto h-20 w-20 rounded-full overflow-hidden border-2 border-white/15">
                  <OptimizedImage
                    src={sampleMovie?.poster_url || sampleMovie?.poster}
                    alt="صورة الممثل"
                    slot="cast_avatar"
                    configOverride={draft}
                    forcePreviewState={previewState}
                    className="h-full w-full"
                    imgClassName="object-cover"
                  />
                </div>
              </div>
            </div>

            {/* Row 3: Wide Backdrop */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold text-[#b7c9ef] block">
                خلفية عريضة للسلايدر / التفاصيل (16:9)
              </span>
              <div className="aspect-video rounded-2xl overflow-hidden border border-white/10">
                <OptimizedImage
                  src={sampleMovie?.backdrop_url || sampleMovie?.backdrop}
                  alt="خلفية العرض"
                  slot="backdrop_card"
                  configOverride={draft}
                  forcePreviewState={previewState}
                  className="h-full w-full"
                  imgClassName="object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
