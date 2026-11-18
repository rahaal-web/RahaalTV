import { ChangeEvent, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  FileUp,
  Languages,
  Link2,
  RotateCcw,
  Sparkles,
  Trash2,
  Type,
} from 'lucide-react';
import {
  ARABIC_FONT_PRESETS,
  DEFAULT_TYPOGRAPHY_CONFIG,
  detectFontFormat,
  ENGLISH_FONT_PRESETS,
  normalizeTypographyConfig,
  readFontFileAsCustomFont,
  saveStoredTypographyConfig,
} from '../lib/typographyConfig';
import { CustomFontRecord, CustomFontSlot, TypographyConfig } from '../types/media';

interface TypographyPanelProps {
  typography: TypographyConfig;
  customFonts: Partial<Record<CustomFontSlot, CustomFontRecord>>;
  busyAction: boolean;
  onChangeTypography: (next: TypographyConfig) => void;
  onSaveTypography: (next: TypographyConfig) => Promise<void>;
  onUploadCustomFont: (font: CustomFontRecord) => Promise<void>;
  onDeleteCustomFont: (slot: CustomFontSlot) => Promise<void>;
  onPreviewHome: () => void;
  onNotify: (msg: string) => void;
}

export function TypographyPanel({
  typography,
  customFonts,
  busyAction,
  onChangeTypography,
  onSaveTypography,
  onUploadCustomFont,
  onDeleteCustomFont,
  onPreviewHome,
  onNotify,
}: TypographyPanelProps) {
  const cfg = useMemo(() => normalizeTypographyConfig(typography), [typography]);
  const [arUrlInput, setArUrlInput] = useState('');
  const [enUrlInput, setEnUrlInput] = useState('');
  const [uploadingSlot, setUploadingSlot] = useState<CustomFontSlot | null>(null);

  const updateCfg = (patch: Partial<TypographyConfig>) => {
    const next = normalizeTypographyConfig({ ...cfg, ...patch });
    saveStoredTypographyConfig(next);
    onChangeTypography(next);
  };

  const handleFileChange = async (slot: CustomFontSlot, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingSlot(slot);
    try {
      const record = await readFontFileAsCustomFont(file, slot);
      await onUploadCustomFont(record);
      updateCfg(slot === 'arabic' ? { arabicFont: 'custom' } : { englishFont: 'custom' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر رفع ملف الخط';
      onNotify(msg);
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleApplyUrlFont = async (slot: CustomFontSlot) => {
    const rawUrl = (slot === 'arabic' ? arUrlInput : enUrlInput).trim();
    if (!/^https?:\/\/.+/i.test(rawUrl)) {
      onNotify('أدخل رابطاً صالحاً يبدأ بـ https://');
      return;
    }
    const detected = detectFontFormat(rawUrl) || 'css';
    let extractedFamily =
      slot === 'arabic' ? 'RahaLCustomArabicUrl' : 'RahaLCustomEnglishUrl';
    if (detected === 'css') {
      const famMatch = rawUrl.match(/[?&]family=([^:&]+)/i);
      if (famMatch?.[1]) {
        extractedFamily = decodeURIComponent(famMatch[1].replace(/\+/g, ' ')).trim() || extractedFamily;
      }
    }
    const record: CustomFontRecord = {
      id: slot,
      family: extractedFamily,
      fileName: rawUrl.split('/').pop()?.split('?')[0]?.slice(0, 80) || 'External Font URL',
      format: detected,
      sourceUrl: rawUrl,
    };
    setUploadingSlot(slot);
    try {
      await onUploadCustomFont(record);
      updateCfg(slot === 'arabic' ? { arabicFont: 'custom' } : { englishFont: 'custom' });
      if (slot === 'arabic') setArUrlInput('');
      else setEnUrlInput('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر حفظ رابط الخط';
      onNotify(msg);
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleResetDefaults = () => {
    const next = { ...DEFAULT_TYPOGRAPHY_CONFIG };
    saveStoredTypographyConfig(next);
    onChangeTypography(next);
    onNotify('تمت استعادة أحجام وأنواع الخطوط الافتراضية — اضغط حفظ لتثبيتها');
  };

  const sizeControls: Array<{
    key: keyof Pick<
      TypographyConfig,
      | 'baseFontSizePx'
      | 'heroTitleSizePx'
      | 'detailTitleSizePx'
      | 'cardTitleSizePx'
      | 'sectionTitleSizePx'
    >;
    label: string;
    hint: string;
    min: number;
    max: number;
    defaultVal: number;
  }> = [
    {
      key: 'baseFontSizePx',
      label: 'الحجم العام للنصوص في الموقع',
      hint: 'يُحجّم النصوص الأساسية والقوائم والأوصاف بشكل متناسق',
      min: 13,
      max: 20,
      defaultVal: DEFAULT_TYPOGRAPHY_CONFIG.baseFontSizePx,
    },
    {
      key: 'heroTitleSizePx',
      label: 'حجم اسم الفيلم في السلايدر الرئيسي',
      hint: 'يتحكم في العنوان الكبير فوق خلفية السلايدر',
      min: 16,
      max: 42,
      defaultVal: DEFAULT_TYPOGRAPHY_CONFIG.heroTitleSizePx,
    },
    {
      key: 'detailTitleSizePx',
      label: 'حجم اسم الفيلم عند فتحه (صفحة العمل والمعاينة)',
      hint: 'يتحكم في العنوان داخل صفحة المشاهدة والتحميل',
      min: 16,
      max: 38,
      defaultVal: DEFAULT_TYPOGRAPHY_CONFIG.detailTitleSizePx,
    },
    {
      key: 'cardTitleSizePx',
      label: 'حجم اسم الفيلم في البطاقات الخارجية',
      hint: 'يتحكم في عناوين الأفلام والمسلسلات في الشبكة والصفوف',
      min: 11,
      max: 20,
      defaultVal: DEFAULT_TYPOGRAPHY_CONFIG.cardTitleSizePx,
    },
    {
      key: 'sectionTitleSizePx',
      label: 'حجم عناوين الأقسام (أحدث الإضافات، أفلام...)',
      hint: 'يتحكم في العناوين الرئيسية للأقسام بالصفحة الرئيسية',
      min: 16,
      max: 32,
      defaultVal: DEFAULT_TYPOGRAPHY_CONFIG.sectionTitleSizePx,
    },
  ];

  const arCustom = customFonts.arabic;
  const enCustom = customFonts.english;

  return (
    <div className="space-y-6">
      {/* Top Action Header */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#D92321]/15 border border-[#D92321]/35 text-[#D92321]">
            <Type className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-lg sm:text-xl font-extrabold text-white">
              التحكم في الخطوط وأحجام النصوص (عربي وإنجليزي)
            </h2>
            <p className="text-xs text-[#b7c9ef] mt-1">
              غيّر حجم العناوين والنصوص بدقة، اختر نوع الفونت للغة العربية والإنجليزية بشكل مستقل، أو ارفع خطوطك الخاصة (.woff2 / .ttf / .otf).
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3.5 py-2.5 text-xs font-bold text-[#b7c9ef] hover:text-white cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>استعادة الافتراضي</span>
          </button>

          <button
            type="button"
            onClick={onPreviewHome}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-4 py-2.5 text-xs font-bold text-white cursor-pointer"
          >
            <Eye className="w-4 h-4 text-[#f9c400]" />
            <span>معاينة الموقع</span>
          </button>

          <button
            type="button"
            disabled={busyAction}
            onClick={() => void onSaveTypography(cfg)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-50 px-5 py-2.5 text-xs font-extrabold text-white shadow-lg cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{busyAction ? 'جاري الحفظ...' : 'حفظ وتطبيق الخطوط الآن'}</span>
          </button>
        </div>
      </div>

      {/* 1. Font Sizes Control */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#f9c400]" />
            <h3 className="font-display text-base font-extrabold text-white">
              أحجام الخطوط والعناوين
            </h3>
          </div>
          <span className="text-[11px] font-bold text-[#b7c9ef]">
            تطبيق لحظي في المعاينة — ثم اضغط حفظ لتثبيتها للجميع
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sizeControls.map((item) => {
            const val = cfg[item.key];
            return (
              <div
                key={item.key}
                className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.07] p-4 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-extrabold text-white">{item.label}</p>
                    <p className="text-[11px] text-[#b7c9ef] mt-0.5">{item.hint}</p>
                  </div>
                  <span className="font-latin shrink-0 rounded-lg bg-[#0c1821] border border-white/10 px-2.5 py-1 text-xs font-black text-[#f9c400] tabular-nums">
                    {val}px
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="font-latin text-[10px] text-[#b7c9ef] w-7">{item.min}</span>
                  <input
                    type="range"
                    min={item.min}
                    max={item.max}
                    step={1}
                    value={val}
                    onChange={(e) =>
                      updateCfg({ [item.key]: Number(e.target.value) } as Partial<TypographyConfig>)
                    }
                    className="flex-1 accent-[#D92321] cursor-pointer"
                  />
                  <span className="font-latin text-[10px] text-[#b7c9ef] w-7 text-left">{item.max}</span>
                  <button
                    type="button"
                    onClick={() =>
                      updateCfg({ [item.key]: item.defaultVal } as Partial<TypographyConfig>)
                    }
                    title={`استعادة ${item.defaultVal}px`}
                    className="rounded-lg bg-[#0c1821] hover:bg-white/10 border border-white/10 px-2 py-1 text-[10px] font-bold text-[#b7c9ef] hover:text-white cursor-pointer"
                  >
                    افتراضي
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Arabic & English Font Family Selection + Custom Font Upload */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Arabic Font Card */}
        <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <Languages className="w-5 h-5 text-[#D92321]" />
              <h3 className="font-display text-base font-extrabold text-white">
                فونت اللغة العربية
              </h3>
            </div>
            <span className="rounded-lg bg-[#D92321]/15 border border-[#D92321]/30 px-2.5 py-0.5 text-[11px] font-bold text-white">
              {cfg.arabicFont === 'custom' && arCustom ? arCustom.fileName : cfg.arabicFont}
            </span>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#b7c9ef] mb-1.5">
              اختر نوع الخط العربي من المكتبة
            </label>
            <select
              value={cfg.arabicFont}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'custom' && !arCustom) {
                  onNotify('ارفع ملف خط عربي أولاً أو ألصق رابطه في الأسفل');
                  return;
                }
                updateCfg({ arabicFont: val });
              }}
              className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-xs font-bold text-white focus:border-[#D92321] focus:outline-none"
            >
              {ARABIC_FONT_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
              {arCustom && (
                <option value="custom">خط مخصص مرفوع: {arCustom.fileName}</option>
              )}
            </select>
          </div>

          {/* Upload Arabic Font File */}
          <div className="rounded-2xl bg-[#1a242e]/80 border border-dashed border-white/20 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-extrabold text-white flex items-center gap-1.5">
                  <FileUp className="w-4 h-4 text-[#f9c400]" />
                  <span>رفع فونت عربي مخصص من جهازك</span>
                </p>
                <p className="text-[11px] text-[#b7c9ef] mt-0.5">
                  يدعم .woff2 / .woff / .ttf / .otf (الحد الأقصى 680 KB — يُفضل .woff2)
                </p>
              </div>
              <label className="inline-flex items-center gap-1.5 rounded-xl bg-[#D92321] hover:bg-[#f40612] px-3.5 py-2 text-xs font-extrabold text-white shadow cursor-pointer shrink-0">
                <FileUp className="w-3.5 h-3.5" />
                <span>{uploadingSlot === 'arabic' ? 'جاري الرفع...' : 'رفع ملف خط'}</span>
                <input
                  type="file"
                  accept=".woff2,.woff,.ttf,.otf"
                  disabled={uploadingSlot === 'arabic'}
                  onChange={(e) => void handleFileChange('arabic', e)}
                  className="hidden"
                />
              </label>
            </div>

            {arCustom && (
              <div className="flex items-center justify-between gap-2 rounded-xl bg-[#0c1821] border border-[#4CAF50]/35 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white truncate">{arCustom.fileName}</p>
                  <p className="font-latin text-[10px] text-[#4CAF50] uppercase">
                    {arCustom.format} · محفوظ في السحابة
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {cfg.arabicFont !== 'custom' && (
                    <button
                      type="button"
                      onClick={() => updateCfg({ arabicFont: 'custom' })}
                      className="rounded-lg bg-[#4CAF50] px-2.5 py-1 text-[10px] font-extrabold text-white cursor-pointer"
                    >
                      تفعيل
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      void onDeleteCustomFont('arabic');
                      if (cfg.arabicFont === 'custom') {
                        updateCfg({ arabicFont: DEFAULT_TYPOGRAPHY_CONFIG.arabicFont });
                      }
                    }}
                    title="حذف الخط المرفوع"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#D92321]/15 text-[#ff8a88] hover:bg-[#D92321] hover:text-white cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <input
                type="url"
                dir="ltr"
                value={arUrlInput}
                onChange={(e) => setArUrlInput(e.target.value)}
                placeholder="أو الصق رابط مباشر (.woff2 / .ttf / Google Fonts CSS)"
                className="flex-1 rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-[11px] text-white focus:border-[#D92321] focus:outline-none font-latin"
              />
              <button
                type="button"
                disabled={uploadingSlot === 'arabic' || !arUrlInput.trim()}
                onClick={() => void handleApplyUrlFont('arabic')}
                className="inline-flex items-center gap-1 rounded-xl bg-[#1a242e] hover:bg-white/10 disabled:opacity-40 border border-white/15 px-3 py-2 text-[11px] font-bold text-white cursor-pointer shrink-0"
              >
                <Link2 className="w-3.5 h-3.5 text-[#f9c400]" />
                <span>تفعيل الرابط</span>
              </button>
            </div>
          </div>
        </div>

        {/* English & Numbers Font Card */}
        <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <Languages className="w-5 h-5 text-[#f9c400]" />
              <h3 className="font-display text-base font-extrabold text-white">
                فونت اللغة الإنجليزية والأرقام
              </h3>
            </div>
            <span className="font-latin rounded-lg bg-[#f9c400]/15 border border-[#f9c400]/30 px-2.5 py-0.5 text-[11px] font-bold text-[#f9c400]">
              {cfg.englishFont === 'custom' && enCustom ? enCustom.fileName : cfg.englishFont}
            </span>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#b7c9ef] mb-1.5">
              اختر نوع الخط الإنجليزي من المكتبة
            </label>
            <select
              value={cfg.englishFont}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'custom' && !enCustom) {
                  onNotify('ارفع ملف خط إنجليزي أولاً أو ألصق رابطه في الأسفل');
                  return;
                }
                updateCfg({ englishFont: val });
              }}
              className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-xs font-bold text-white focus:border-[#f9c400] focus:outline-none font-latin"
            >
              {ENGLISH_FONT_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
              {enCustom && (
                <option value="custom">خط مخصص مرفوع: {enCustom.fileName}</option>
              )}
            </select>
          </div>

          {/* Upload English Font File */}
          <div className="rounded-2xl bg-[#1a242e]/80 border border-dashed border-white/20 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-extrabold text-white flex items-center gap-1.5">
                  <FileUp className="w-4 h-4 text-[#f9c400]" />
                  <span>رفع فونت إنجليزي مخصص من جهازك</span>
                </p>
                <p className="text-[11px] text-[#b7c9ef] mt-0.5">
                  يطبق تلقائياً على الكلمات الإنجليزية والأرقام (.woff2 / .woff / .ttf / .otf)
                </p>
              </div>
              <label className="inline-flex items-center gap-1.5 rounded-xl bg-[#f9c400] hover:bg-[#eab308] px-3.5 py-2 text-xs font-black text-[#06131c] shadow cursor-pointer shrink-0">
                <FileUp className="w-3.5 h-3.5" />
                <span>{uploadingSlot === 'english' ? 'جاري الرفع...' : 'رفع ملف خط'}</span>
                <input
                  type="file"
                  accept=".woff2,.woff,.ttf,.otf"
                  disabled={uploadingSlot === 'english'}
                  onChange={(e) => void handleFileChange('english', e)}
                  className="hidden"
                />
              </label>
            </div>

            {enCustom && (
              <div className="flex items-center justify-between gap-2 rounded-xl bg-[#0c1821] border border-[#4CAF50]/35 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-latin text-xs font-bold text-white truncate">{enCustom.fileName}</p>
                  <p className="font-latin text-[10px] text-[#4CAF50] uppercase">
                    {enCustom.format} · محفوظ في السحابة
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {cfg.englishFont !== 'custom' && (
                    <button
                      type="button"
                      onClick={() => updateCfg({ englishFont: 'custom' })}
                      className="rounded-lg bg-[#4CAF50] px-2.5 py-1 text-[10px] font-extrabold text-white cursor-pointer"
                    >
                      تفعيل
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      void onDeleteCustomFont('english');
                      if (cfg.englishFont === 'custom') {
                        updateCfg({ englishFont: DEFAULT_TYPOGRAPHY_CONFIG.englishFont });
                      }
                    }}
                    title="حذف الخط المرفوع"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#D92321]/15 text-[#ff8a88] hover:bg-[#D92321] hover:text-white cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <input
                type="url"
                dir="ltr"
                value={enUrlInput}
                onChange={(e) => setEnUrlInput(e.target.value)}
                placeholder="https://.../english-font.woff2"
                className="flex-1 rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-[11px] text-white focus:border-[#f9c400] focus:outline-none font-latin"
              />
              <button
                type="button"
                disabled={uploadingSlot === 'english' || !enUrlInput.trim()}
                onClick={() => void handleApplyUrlFont('english')}
                className="inline-flex items-center gap-1 rounded-xl bg-[#1a242e] hover:bg-white/10 disabled:opacity-40 border border-white/15 px-3 py-2 text-[11px] font-bold text-white cursor-pointer shrink-0"
              >
                <Link2 className="w-3.5 h-3.5 text-[#f9c400]" />
                <span>تفعيل الرابط</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Live Bilingual Preview Box */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h3 className="font-display text-base font-extrabold text-white">
            معاينة مباشرة ثنائية اللغة (عربي + إنجليزي)
          </h3>
          <span className="text-[11px] text-[#b7c9ef]">
            تعكس الأحجام والخطوط الحالية مباشرة
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-2xl bg-[#12161b] border border-white/10 p-4 space-y-2">
            <span className="text-[10px] font-bold text-[#f9c400]">عنوان السلايدر الرئيسي</span>
            <p
              style={{ fontSize: `${cfg.heroTitleSizePx}px` }}
              className="font-display font-extrabold text-white leading-snug"
            >
              فيلم Dune: Part Three 2026 مترجم
            </p>
            <p className="text-xs text-[#a3a3a3]">
              جودة <span className="font-latin text-white">4K UHD</span> ·{' '}
              <span className="font-latin text-[#f9c400]">IMDb 8.7</span>
            </p>
          </div>

          <div className="rounded-2xl bg-[#12161b] border border-white/10 p-4 space-y-2">
            <span className="text-[10px] font-bold text-[#4CAF50]">عنوان صفحة العمل</span>
            <p
              style={{ fontSize: `${cfg.detailTitleSizePx}px` }}
              className="font-display font-extrabold text-white leading-snug"
            >
              مسلسل Stranger Things الموسم الخامس بجودة عالية
            </p>
            <p className="text-xs text-[#a3a3a3]">
              مشاهدة مباشرة بدون تقطيع ·{' '}
              <span className="font-latin text-white">WEB-DL 1080p</span>
            </p>
          </div>

          <div className="rounded-2xl bg-[#12161b] border border-white/10 p-4 space-y-2">
            <span className="text-[10px] font-bold text-[#b7c9ef]">عنوان البطاقة الخارجية</span>
            <p
              style={{ fontSize: `${cfg.cardTitleSizePx}px` }}
              className="font-display font-bold text-white leading-snug"
            >
              فيلم The Isolate Thief 2026 مترجم للعربية
            </p>
            <p
              style={{ fontSize: `${cfg.sectionTitleSizePx}px` }}
              className="font-display font-extrabold text-[#f9c400] pt-1"
            >
              أحدث الإضافات — New Releases
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
