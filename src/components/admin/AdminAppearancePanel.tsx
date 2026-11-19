import { ChangeEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Coffee,
  Contrast,
  Eye,
  FileUp,
  Layers,
  Link2,
  Moon,
  Palette,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  Type,
} from 'lucide-react';
import {
  ADMIN_ARABIC_FONT_PRESETS,
  ADMIN_EYE_COMFORT_PRESETS,
  AdminAppearanceConfig,
  AdminColorMode,
  AdminFontWeight,
  AdminTableDensity,
  applyEyeComfortPresetToConfig,
  buildAdminAppearanceCssVars,
  buildAdminFontFromUrl,
  DEFAULT_ADMIN_APPEARANCE,
  ensureAdminFontResources,
  normalizeAdminAppearance,
  readAdminCustomFontFile,
  resetAdminAppearance,
  resolveAdminFontStack,
  saveAdminAppearance,
  syncAdminAppearanceToFirestore,
} from '../../lib/adminAppearance';
import { AdminNavLayoutConfig, getOrderedSubOptions } from '../../lib/adminNavLayout';

interface AdminAppearancePanelProps {
  appearance: AdminAppearanceConfig;
  navLayout: AdminNavLayoutConfig;
  actorUid: string;
  onChangeApplied: (next: AdminAppearanceConfig) => void;
  onOpenSiteTypography?: () => void;
  onNotify: (msg: string) => void;
}

const WEIGHT_OPTIONS: Array<{ value: AdminFontWeight; label: string; desc: string }> = [
  { value: 300, label: 'Light (300)', desc: 'خفيف' },
  { value: 400, label: 'Regular (400)', desc: 'عادي' },
  { value: 500, label: 'Medium (500)', desc: 'متوسط' },
  { value: 600, label: 'SemiBold (600)', desc: 'شبه عريض' },
  { value: 700, label: 'Bold (700)', desc: 'عريض' },
];

const DENSITY_OPTIONS: Array<{ value: AdminTableDensity; label: string; desc: string }> = [
  { value: 'compact', label: 'مضغوط (Compact)', desc: 'صفوف أكثر في الشاشة' },
  { value: 'normal', label: 'عادي (Normal)', desc: 'توازن مريح للقراءة' },
  { value: 'comfortable', label: 'مريح (Comfortable)', desc: 'تباعد واسع وواضح' },
];

const MODE_ICONS: Record<AdminColorMode, ReactNode> = {
  dark: <Moon className="w-4 h-4 text-sky-400" />,
  light: <Sun className="w-4 h-4 text-indigo-500" />,
  soft_gray: <Contrast className="w-4 h-4 text-cyan-400" />,
  comfortable_eye: <Coffee className="w-4 h-4 text-teal-400" />,
};

export function AdminAppearancePanel({
  appearance,
  navLayout,
  actorUid,
  onChangeApplied,
  onOpenSiteTypography,
  onNotify,
}: AdminAppearancePanelProps) {
  const [draft, setDraft] = useState<AdminAppearanceConfig>(() =>
    normalizeAdminAppearance(appearance)
  );
  const [urlInput, setUrlInput] = useState('');
  const [uploadingFont, setUploadingFont] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(normalizeAdminAppearance(appearance));
  }, [appearance]);

  useEffect(() => {
    ensureAdminFontResources(draft, 'preview');
  }, [draft]);

  const previewCssVars = useMemo(() => buildAdminAppearanceCssVars(draft), [draft]);
  const previewFontStack = useMemo(() => resolveAdminFontStack(draft), [draft]);
  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(normalizeAdminAppearance(appearance)),
    [draft, appearance]
  );

  const orderedSubSections = useMemo(
    () => getOrderedSubOptions('admin_appearance', navLayout),
    [navLayout]
  );

  const activePreset = ADMIN_EYE_COMFORT_PRESETS[draft.colorMode] || ADMIN_EYE_COMFORT_PRESETS.dark;

  const updateDraft = (patch: Partial<AdminAppearanceConfig>) => {
    setDraft((prev) => normalizeAdminAppearance({ ...prev, ...patch }));
  };

  const handleSelectMode = (mode: AdminColorMode) => {
    setDraft((prev) => applyEyeComfortPresetToConfig(prev, mode));
  };

  const handleApplyAndSave = async (targetConfig?: AdminAppearanceConfig) => {
    setSaving(true);
    try {
      const saved = saveAdminAppearance(targetConfig || draft);
      onChangeApplied(saved);
      const syncedCloud = await syncAdminAppearanceToFirestore(saved, actorUid);
      onNotify(
        syncedCloud
          ? 'تم تطبيق وحفظ نظام راحة العين ومظهر لوحة الإدارة ومزامنته سحابياً.'
          : 'تم تطبيق وحفظ نظام راحة العين ومظهر لوحة الإدارة على هذا الجهاز.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = async () => {
    const def = resetAdminAppearance();
    setDraft(def);
    onChangeApplied(def);
    await syncAdminAppearanceToFirestore(def, actorUid);
    onNotify('تمت استعادة الإعدادات الافتراضية لمظهر لوحة الإدارة.');
  };

  const handleUploadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingFont(true);
    try {
      const customFont = await readAdminCustomFontFile(file);
      updateDraft({ fontFamily: 'custom', customFont });
      onNotify(`تم تحميل الخط "${customFont.fileName}" للمعاينة — اضغط تطبيق وحفظ لتفعيله.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'تعذر قراءة ملف الخط');
    } finally {
      setUploadingFont(false);
    }
  };

  const handleApplyUrlFont = () => {
    try {
      const customFont = buildAdminFontFromUrl(urlInput);
      updateDraft({ fontFamily: 'custom', customFont });
      setUrlInput('');
      onNotify(`تم تجهيز رابط الخط "${customFont.fileName}" في المعاينة الحية.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'رابط غير صالح');
    }
  };

  const colorPickers: Array<{
    key: keyof Pick<
      AdminAppearanceConfig,
      | 'pageBgColor'
      | 'cardBgColor'
      | 'sidebarBgColor'
      | 'primaryTextColor'
      | 'secondaryTextColor'
      | 'accentColor'
    >;
    label: string;
    hint: string;
    presetValue: string;
  }> = [
    {
      key: 'pageBgColor',
      label: 'لون خلفية الصفحة',
      hint: 'الخلفية العامة لمساحة العمل',
      presetValue: activePreset.pageBgColor,
    },
    {
      key: 'cardBgColor',
      label: 'لون البطاقات واللوحات',
      hint: 'خلفية البطاقات والجداول والحاويات',
      presetValue: activePreset.cardBgColor,
    },
    {
      key: 'sidebarBgColor',
      label: 'لون القائمة الجانبية',
      hint: 'شريط التنقل الجانبي في اللوحة',
      presetValue: activePreset.sidebarBgColor,
    },
    {
      key: 'primaryTextColor',
      label: 'لون النصوص الرئيسية',
      hint: 'العناوين والنصوص الأساسية',
      presetValue: activePreset.primaryTextColor,
    },
    {
      key: 'secondaryTextColor',
      label: 'لون النصوص الثانوية',
      hint: 'الشروحات والملاحظات والوصف',
      presetValue: activePreset.secondaryTextColor,
    },
    {
      key: 'accentColor',
      label: 'لون التمييز الهادئ',
      hint: 'الروابط النشطة والأزرار المختارة (بعيداً عن الأحمر/الأصفر الصارخ)',
      presetValue: activePreset.accentColor,
    },
  ];

  const eyeSliders: Array<{
    key: keyof Pick<
      AdminAppearanceConfig,
      | 'contrastLevel'
      | 'brightnessLevel'
      | 'shadowIntensity'
      | 'borderContrast'
      | 'elementSpacingPx'
    >;
    label: string;
    hint: string;
    unit: string;
    min: number;
    max: number;
    def: number;
  }> = [
    {
      key: 'contrastLevel',
      label: 'مستوى التباين',
      hint: 'تخفيف أو رفع وضوح الفوارق بين النصوص والخلفيات',
      unit: '%',
      min: 80,
      max: 115,
      def: activePreset.contrastLevel,
    },
    {
      key: 'brightnessLevel',
      label: 'درجة سطوع الألوان',
      hint: 'تقليل السطوع المجهد للعين أثناء العمل الليلي',
      unit: '%',
      min: 80,
      max: 110,
      def: activePreset.brightnessLevel,
    },
    {
      key: 'shadowIntensity',
      label: 'كثافة الظلال',
      hint: 'درجة بروز البطاقات بظلال ناعمة',
      unit: '%',
      min: 0,
      max: 100,
      def: activePreset.shadowIntensity,
    },
    {
      key: 'borderContrast',
      label: 'حدة الحدود والفواصل',
      hint: 'وضوح خطوط الفصل بين البطاقات والخلايا',
      unit: '%',
      min: 0,
      max: 100,
      def: activePreset.borderContrast,
    },
    {
      key: 'elementSpacingPx',
      label: 'المسافات بين العناصر',
      hint: 'الفراغ المريح بين الأقسام والبطاقات',
      unit: 'px',
      min: 8,
      max: 28,
      def: activePreset.elementSpacingPx,
    },
  ];

  const sizeControls: Array<{
    key: keyof Pick<
      AdminAppearanceConfig,
      | 'headingMainPx'
      | 'headingSectionPx'
      | 'bodyTextPx'
      | 'secondaryTextPx'
      | 'buttonTextPx'
      | 'sidebarItemPx'
      | 'tableTextPx'
      | 'inputTextPx'
    >;
    label: string;
    hint: string;
    min: number;
    max: number;
    def: number;
  }> = [
    {
      key: 'headingMainPx',
      label: 'العناوين الرئيسية (H1)',
      hint: 'عنوان رأس لوحة الإدارة والصفحة الحالية',
      min: 16,
      max: 32,
      def: DEFAULT_ADMIN_APPEARANCE.headingMainPx,
    },
    {
      key: 'headingSectionPx',
      label: 'عناوين الأقسام (H2)',
      hint: 'عناوين اللوحات والأقسام الفرعية',
      min: 14,
      max: 24,
      def: DEFAULT_ADMIN_APPEARANCE.headingSectionPx,
    },
    {
      key: 'bodyTextPx',
      label: 'النصوص العادية',
      hint: 'النصوص الأساسية والفقرات داخل اللوحة',
      min: 12,
      max: 18,
      def: DEFAULT_ADMIN_APPEARANCE.bodyTextPx,
    },
    {
      key: 'secondaryTextPx',
      label: 'النصوص الفرعية والوصفية',
      hint: 'الشروحات والملاحظات أسفل الحقول',
      min: 10,
      max: 15,
      def: DEFAULT_ADMIN_APPEARANCE.secondaryTextPx,
    },
    {
      key: 'buttonTextPx',
      label: 'نصوص الأزرار',
      hint: 'تسميات الأزرار وإجراءات الحفظ',
      min: 11,
      max: 16,
      def: DEFAULT_ADMIN_APPEARANCE.buttonTextPx,
    },
    {
      key: 'sidebarItemPx',
      label: 'عناصر القائمة الجانبية',
      hint: 'روابط الأقسام والتبويبات الجانبية',
      min: 11,
      max: 16,
      def: DEFAULT_ADMIN_APPEARANCE.sidebarItemPx,
    },
    {
      key: 'tableTextPx',
      label: 'الجداول والبيانات',
      hint: 'خلايا ورؤوس جداول الكتالوج والسجلات',
      min: 11,
      max: 16,
      def: DEFAULT_ADMIN_APPEARANCE.tableTextPx,
    },
    {
      key: 'inputTextPx',
      label: 'الحقول والنماذج',
      hint: 'مربعات البحث والإدخال والقوائم المنسدلة',
      min: 11,
      max: 16,
      def: DEFAULT_ADMIN_APPEARANCE.inputTextPx,
    },
  ];

  const layoutSliders: Array<{
    key: keyof Pick<
      AdminAppearanceConfig,
      | 'sidebarWidthPx'
      | 'iconSizePx'
      | 'navItemSpacingPx'
      | 'buttonHeightPx'
      | 'borderRadiusPx'
      | 'cardPaddingPx'
      | 'cardTitlePx'
    >;
    label: string;
    hint: string;
    min: number;
    max: number;
    def: number;
  }> = [
    {
      key: 'sidebarWidthPx',
      label: 'عرض القائمة الجانبية',
      hint: 'عرض الشريط الجانبي في الشاشات المكتبية',
      min: 240,
      max: 360,
      def: DEFAULT_ADMIN_APPEARANCE.sidebarWidthPx,
    },
    {
      key: 'iconSizePx',
      label: 'حجم الأيقونات',
      hint: 'أيقونات القائمة والأزرار القياسية',
      min: 14,
      max: 24,
      def: DEFAULT_ADMIN_APPEARANCE.iconSizePx,
    },
    {
      key: 'navItemSpacingPx',
      label: 'التباعد بين عناصر القائمة',
      hint: 'المسافة الرأسية بين أزرار القائمة الجانبية',
      min: 2,
      max: 12,
      def: DEFAULT_ADMIN_APPEARANCE.navItemSpacingPx,
    },
    {
      key: 'buttonHeightPx',
      label: 'ارتفاع الأزرار الأساسي',
      hint: 'الارتفاع المريح للأزرار على اللمس والماوس',
      min: 32,
      max: 48,
      def: DEFAULT_ADMIN_APPEARANCE.buttonHeightPx,
    },
    {
      key: 'borderRadiusPx',
      label: 'استدارة الحواف (Radius)',
      hint: 'درجة انحناء البطاقات والأزرار والحقول',
      min: 6,
      max: 28,
      def: DEFAULT_ADMIN_APPEARANCE.borderRadiusPx,
    },
    {
      key: 'cardPaddingPx',
      label: 'التباعد الداخلي للبطاقات',
      hint: 'الهوامش الداخلية للوحات والبطاقات',
      min: 12,
      max: 32,
      def: DEFAULT_ADMIN_APPEARANCE.cardPaddingPx,
    },
    {
      key: 'cardTitlePx',
      label: 'حجم عناوين البطاقات',
      hint: 'عناوين H3 / H4 داخل بطاقات البيانات',
      min: 13,
      max: 22,
      def: DEFAULT_ADMIN_APPEARANCE.cardTitlePx,
    },
  ];

  const renderSection = (subId: string) => {
    switch (subId) {
      case 'eye_comfort_modes':
        return (
          <div
            key="eye_comfort_modes"
            className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Eye className="w-5 h-5 rtv-admin-accent-text" />
                <h3 className="font-display text-base font-extrabold text-white">
                  1. أوضاع راحة العين للوحة الإدارة (Eye Comfort Modes)
                </h3>
              </div>
              <span className="text-[11px] font-bold text-[#b7c9ef]">
                ألوان هادئة بدون بياض ساطع أو أحمر صارخ
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
              {(Object.keys(ADMIN_EYE_COMFORT_PRESETS) as AdminColorMode[]).map((modeId) => {
                const preset = ADMIN_EYE_COMFORT_PRESETS[modeId];
                const active = draft.colorMode === modeId;
                return (
                  <button
                    key={modeId}
                    type="button"
                    onClick={() => handleSelectMode(modeId)}
                    className={`rounded-2xl border p-4 text-right transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                      active
                        ? 'rtv-admin-accent-soft ring-2 ring-[var(--rtv-admin-accent)]'
                        : 'bg-[#1a242e]/65 border-white/10 hover:border-white/25'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#0c1821] border border-white/10">
                          {MODE_ICONS[modeId]}
                        </span>
                        {/* Miniature Swatch Bar */}
                        <div className="flex items-center gap-1 rounded-lg bg-black/20 p-1">
                          <span
                            className="h-3.5 w-3.5 rounded-full border border-white/20"
                            style={{ backgroundColor: preset.pageBgColor }}
                            title="خلفية الصفحة"
                          />
                          <span
                            className="h-3.5 w-3.5 rounded-full border border-white/20"
                            style={{ backgroundColor: preset.cardBgColor }}
                            title="البطاقات"
                          />
                          <span
                            className="h-3.5 w-3.5 rounded-full border border-white/20"
                            style={{ backgroundColor: preset.accentColor }}
                            title="لون التمييز"
                          />
                        </div>
                      </div>
                      <p className="text-xs font-extrabold text-white">{preset.label}</p>
                      <p className="text-[11px] text-[#b7c9ef] leading-relaxed">{preset.desc}</p>
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-bold">
                      <span className={active ? 'rtv-admin-accent-text' : 'text-[#b7c9ef]'}>
                        {active ? 'محدد حالياً' : 'انقر لتفعيل الوضع'}
                      </span>
                      <span className="font-latin text-[#b7c9ef]">
                        {preset.brightnessLevel}% / {preset.contrastLevel}%
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );

      case 'palette_controls':
        return (
          <div
            key="palette_controls"
            className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Palette className="w-5 h-5 text-sky-400" />
                <h3 className="font-display text-base font-extrabold text-white">
                  2. تخصيص الألوان الدقيقة للوحة (الخلفية، البطاقات، القائمة، النصوص)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => handleSelectMode(draft.colorMode)}
                className="rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3 py-1.5 text-[11px] font-bold text-[#b7c9ef] hover:text-white cursor-pointer"
              >
                إعادة ألوان الوضع الحالي
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {colorPickers.map((cp) => {
                const val = draft[cp.key];
                return (
                  <div
                    key={cp.key}
                    className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.08] p-4 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-xs font-extrabold text-white">{cp.label}</p>
                      <p className="text-[11px] text-[#b7c9ef] truncate">{cp.hint}</p>
                      <div className="flex items-center gap-2 pt-1">
                        <span className="font-latin text-[11px] font-bold text-[#b7c9ef] uppercase">
                          {val}
                        </span>
                        {val !== cp.presetValue && (
                          <button
                            type="button"
                            onClick={() =>
                              updateDraft({ [cp.key]: cp.presetValue } as Partial<AdminAppearanceConfig>)
                            }
                            className="text-[10px] font-bold rtv-admin-accent-text hover:underline cursor-pointer"
                          >
                            افتراضي
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      type="color"
                      aria-label={cp.label}
                      value={val}
                      onChange={(e) =>
                        updateDraft({ [cp.key]: e.target.value } as Partial<AdminAppearanceConfig>)
                      }
                      className="h-10 w-12 rounded-xl border border-white/15 bg-transparent cursor-pointer shrink-0 p-0.5"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );

      case 'contrast_spacing':
        return (
          <div
            key="contrast_spacing"
            className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-emerald-400" />
                <h3 className="font-display text-base font-extrabold text-white">
                  3. التباين، السطوع، الظلال، الحدود، التخطيط، وكثافة الجداول
                </h3>
              </div>
              <span className="text-[11px] font-bold text-[#b7c9ef]">
                تحكم متكامل لتقليل الإجهاد البصري
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {eyeSliders.map((ctrl) => {
                const val = draft[ctrl.key];
                return (
                  <div
                    key={ctrl.key}
                    className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.07] p-4 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-extrabold text-white">{ctrl.label}</p>
                        <p className="text-[11px] text-[#b7c9ef] mt-0.5">{ctrl.hint}</p>
                      </div>
                      <span className="font-latin shrink-0 rounded-lg bg-[#0c1821] border border-white/10 px-2.5 py-1 text-xs font-black rtv-admin-accent-text tabular-nums">
                        {val}
                        {ctrl.unit}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-latin text-[10px] text-[#b7c9ef] w-7">{ctrl.min}</span>
                      <input
                        type="range"
                        min={ctrl.min}
                        max={ctrl.max}
                        step={1}
                        value={val}
                        onChange={(e) =>
                          updateDraft({
                            [ctrl.key]: Number(e.target.value),
                          } as Partial<AdminAppearanceConfig>)
                        }
                        className="flex-1 accent-[var(--rtv-admin-accent)] cursor-pointer"
                      />
                      <span className="font-latin text-[10px] text-[#b7c9ef] w-7 text-left">
                        {ctrl.max}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateDraft({ [ctrl.key]: ctrl.def } as Partial<AdminAppearanceConfig>)
                        }
                        className="rounded-lg bg-[#0c1821] hover:bg-white/10 border border-white/10 px-2 py-1 text-[10px] font-bold text-[#b7c9ef] hover:text-white cursor-pointer"
                      >
                        افتراضي
                      </button>
                    </div>
                  </div>
                );
              })}

              <div className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.07] p-4 space-y-3">
                <p className="text-xs font-extrabold text-white">كثافة الجداول (Table Density)</p>
                <div className="grid grid-cols-3 gap-2">
                  {DENSITY_OPTIONS.map((opt) => {
                    const active = draft.tableDensity === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => updateDraft({ tableDensity: opt.value })}
                        className={`rounded-xl border p-2 text-center transition-all cursor-pointer ${
                          active
                            ? 'rtv-admin-accent-bg border-transparent shadow'
                            : 'bg-[#0c1821] border-white/10 text-[#b7c9ef] hover:text-white'
                        }`}
                      >
                        <p className="text-[11px] font-extrabold">{opt.label.split(' ')[0]}</p>
                        <p className="text-[9px] opacity-80 mt-0.5">{opt.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-white/10">
              {layoutSliders.map((ctrl) => {
                const val = draft[ctrl.key];
                return (
                  <div
                    key={ctrl.key}
                    className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.07] p-4 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-extrabold text-white">{ctrl.label}</p>
                        <p className="text-[11px] text-[#b7c9ef] mt-0.5">{ctrl.hint}</p>
                      </div>
                      <span className="font-latin shrink-0 rounded-lg bg-[#0c1821] border border-white/10 px-2.5 py-1 text-xs font-black rtv-admin-accent-text tabular-nums">
                        {val}px
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-latin text-[10px] text-[#b7c9ef] w-6">{ctrl.min}</span>
                      <input
                        type="range"
                        min={ctrl.min}
                        max={ctrl.max}
                        step={1}
                        value={val}
                        onChange={(e) =>
                          updateDraft({
                            [ctrl.key]: Number(e.target.value),
                          } as Partial<AdminAppearanceConfig>)
                        }
                        className="flex-1 accent-[var(--rtv-admin-accent)] cursor-pointer"
                      />
                      <span className="font-latin text-[10px] text-[#b7c9ef] w-6 text-left">
                        {ctrl.max}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateDraft({ [ctrl.key]: ctrl.def } as Partial<AdminAppearanceConfig>)
                        }
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
        );

      case 'font_family':
        return (
          <div
            key="font_family"
            className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Type className="w-5 h-5 rtv-admin-accent-text" />
                <h3 className="font-display text-base font-extrabold text-white">
                  4. خط ووزن نصوص لوحة الإدارة
                </h3>
              </div>
              <span className="rounded-lg rtv-admin-accent-soft border px-2.5 py-0.5 text-[11px] font-bold text-white">
                {draft.fontFamily === 'custom' && draft.customFont
                  ? draft.customFont.fileName
                  : draft.fontFamily}
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="space-y-3">
                <label className="block text-xs font-bold text-[#b7c9ef]">
                  مكتبة الخطوط العربية للوحة التحكم
                </label>
                <select
                  value={draft.fontFamily}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'custom' && !draft.customFont) {
                      onNotify('ارفع ملف خط مخصص أو ألصق رابط الخط أولاً');
                      return;
                    }
                    updateDraft({ fontFamily: val });
                  }}
                  className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-xs font-bold text-white focus:outline-none"
                >
                  {ADMIN_ARABIC_FONT_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                  {draft.customFont && (
                    <option value="custom">خط مخصص: {draft.customFont.fileName}</option>
                  )}
                </select>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {WEIGHT_OPTIONS.map((w) => {
                    const active = draft.fontWeight === w.value;
                    return (
                      <button
                        key={w.value}
                        type="button"
                        onClick={() => updateDraft({ fontWeight: w.value })}
                        style={{ fontFamily: previewFontStack, fontWeight: w.value }}
                        className={`rounded-xl border p-2 text-center transition-all cursor-pointer ${
                          active
                            ? 'rtv-admin-accent-bg border-transparent shadow'
                            : 'bg-[#1a242e]/80 border-white/10 text-[#b7c9ef] hover:text-white'
                        }`}
                      >
                        <p className="text-[11px] font-bold">{w.desc}</p>
                        <p className="font-latin text-[10px] opacity-80">{w.value}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl bg-[#1a242e]/80 border border-dashed border-white/20 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-extrabold text-white flex items-center gap-1.5">
                      <FileUp className="w-4 h-4 rtv-admin-accent-text" />
                      <span>خط مخصص للوحة الإدارة (رفع ملف أو رابط)</span>
                    </p>
                    <p className="text-[11px] text-[#b7c9ef] mt-0.5">
                      يدعم .woff2 / .woff / .ttf / .otf أو رابط Google Fonts CSS
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-1.5 rounded-xl rtv-admin-accent-bg px-3.5 py-2 text-xs font-extrabold shadow cursor-pointer shrink-0">
                    <FileUp className="w-3.5 h-3.5" />
                    <span>{uploadingFont ? 'جاري التحميل...' : 'رفع خط'}</span>
                    <input
                      type="file"
                      accept=".woff2,.woff,.ttf,.otf"
                      disabled={uploadingFont}
                      onChange={(e) => void handleUploadFile(e)}
                      className="hidden"
                    />
                  </label>
                </div>

                {draft.customFont && (
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-[#0c1821] border border-emerald-500/35 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">
                        {draft.customFont.fileName}
                      </p>
                      <p className="font-latin text-[10px] text-emerald-400 uppercase">
                        {draft.customFont.format}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {draft.fontFamily !== 'custom' && (
                        <button
                          type="button"
                          onClick={() => updateDraft({ fontFamily: 'custom' })}
                          className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[10px] font-extrabold text-white cursor-pointer"
                        >
                          تحديد
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          updateDraft({
                            fontFamily:
                              draft.fontFamily === 'custom'
                                ? DEFAULT_ADMIN_APPEARANCE.fontFamily
                                : draft.fontFamily,
                            customFont: null,
                          })
                        }
                        title="إزالة الخط المخصص"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#D92321]/15 text-[#ff8a88] hover:bg-[#D92321] hover:text-white cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    dir="ltr"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://fonts.googleapis.com/css2?family=... أو .woff2"
                    className="flex-1 rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-[11px] text-white focus:outline-none font-latin"
                  />
                  <button
                    type="button"
                    disabled={!urlInput.trim()}
                    onClick={handleApplyUrlFont}
                    className="inline-flex items-center gap-1 rounded-xl bg-[#0c1821] hover:bg-white/10 disabled:opacity-40 border border-white/15 px-3 py-2 text-[11px] font-bold text-white cursor-pointer shrink-0"
                  >
                    <Link2 className="w-3.5 h-3.5 rtv-admin-accent-text" />
                    <span>معاينة الرابط</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );

      case 'font_sizes':
        return (
          <div
            key="font_sizes"
            className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 rtv-admin-accent-text" />
                <h3 className="font-display text-base font-extrabold text-white">
                  5. أحجام الخطوط التفصيلية (بالـ px)
                </h3>
              </div>
              <span className="text-[11px] font-bold text-[#b7c9ef]">
                تحكم دقيق لكل عنصر داخل لوحة الإدارة
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sizeControls.map((ctrl) => {
                const val = draft[ctrl.key];
                return (
                  <div
                    key={ctrl.key}
                    className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.07] p-4 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-extrabold text-white">{ctrl.label}</p>
                        <p className="text-[11px] text-[#b7c9ef] mt-0.5">{ctrl.hint}</p>
                      </div>
                      <span className="font-latin shrink-0 rounded-lg bg-[#0c1821] border border-white/10 px-2.5 py-1 text-xs font-black rtv-admin-accent-text tabular-nums">
                        {val}px
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="font-latin text-[10px] text-[#b7c9ef] w-6">{ctrl.min}</span>
                      <input
                        type="range"
                        min={ctrl.min}
                        max={ctrl.max}
                        step={1}
                        value={val}
                        onChange={(e) =>
                          updateDraft({
                            [ctrl.key]: Number(e.target.value),
                          } as Partial<AdminAppearanceConfig>)
                        }
                        className="flex-1 accent-[var(--rtv-admin-accent)] cursor-pointer"
                      />
                      <span className="font-latin text-[10px] text-[#b7c9ef] w-6 text-left">
                        {ctrl.max}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateDraft({ [ctrl.key]: ctrl.def } as Partial<AdminAppearanceConfig>)
                        }
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
        );

      case 'live_preview':
      default:
        return (
          <div
            key="live_preview"
            className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Eye className="w-5 h-5 rtv-admin-accent-text" />
                <h3 className="font-display text-base font-extrabold text-white">
                  6. المعاينة الحية لمظهر لوحة الإدارة والراحة البصرية
                </h3>
              </div>
              <span className="text-[11px] font-bold text-emerald-400">
                {isDirty ? 'معاينة تعديلات غير محفوظة بعد' : 'مطابق للمظهر النشط حالياً'}
              </span>
            </div>

            <div
              data-admin-theme={draft.colorMode}
              style={{
                ...(previewCssVars as Record<string, string>),
                fontFamily: previewFontStack,
                fontWeight: draft.fontWeight,
                borderRadius: `${draft.borderRadiusPx}px`,
                backgroundColor: draft.pageBgColor,
                color: draft.primaryTextColor,
                borderColor: previewCssVars['--rtv-admin-border'],
                filter: `contrast(${draft.contrastLevel}%) brightness(${draft.brightnessLevel}%)`,
              }}
              className="rtv-admin-preview border p-5 transition-all"
            >
              <div
                className="grid grid-cols-1 lg:grid-cols-12 items-start"
                style={{ gap: `${draft.elementSpacingPx}px` }}
              >
                {/* Mini Sidebar Preview */}
                <div
                  style={{
                    borderRadius: `${draft.borderRadiusPx}px`,
                    padding: `${Math.max(10, Math.round(draft.cardPaddingPx * 0.65))}px`,
                    backgroundColor: draft.sidebarBgColor,
                    borderColor: previewCssVars['--rtv-admin-border'],
                    boxShadow: previewCssVars['--rtv-admin-shadow'],
                  }}
                  className="lg:col-span-4 border space-y-2"
                >
                  <p
                    style={{
                      fontSize: `${draft.secondaryTextPx}px`,
                      color: draft.secondaryTextColor,
                    }}
                    className="font-bold"
                  >
                    معاينة القائمة الجانبية ({draft.sidebarWidthPx}px)
                  </p>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: `${draft.navItemSpacingPx}px`,
                    }}
                  >
                    {['لوحة القيادة التنفيذية', 'الأفلام والمسلسلات', 'إدارة قواعد البيانات'].map(
                      (lbl, i) => (
                        <div
                          key={lbl}
                          style={{
                            fontSize: `${draft.sidebarItemPx}px`,
                            borderRadius: `${Math.min(draft.borderRadiusPx, 14)}px`,
                            backgroundColor:
                              i === 0
                                ? previewCssVars['--rtv-admin-accent-soft']
                                : previewCssVars['--rtv-admin-surface-2'],
                            color: i === 0 ? draft.accentColor : draft.secondaryTextColor,
                            borderRight:
                              i === 0 ? `3px solid ${draft.accentColor}` : '3px solid transparent',
                          }}
                          className="flex items-center gap-2 px-3 py-2 font-bold"
                        >
                          <Layers
                            style={{
                              width: `${draft.iconSizePx}px`,
                              height: `${draft.iconSizePx}px`,
                            }}
                          />
                          <span>{lbl}</span>
                        </div>
                      )
                    )}
                  </div>
                </div>

                {/* Main Content Preview Card */}
                <div
                  style={{
                    borderRadius: `${draft.borderRadiusPx}px`,
                    padding: `${draft.cardPaddingPx}px`,
                    backgroundColor: draft.cardBgColor,
                    borderColor: previewCssVars['--rtv-admin-border'],
                    boxShadow: previewCssVars['--rtv-admin-shadow'],
                  }}
                  className="lg:col-span-8 border space-y-4"
                >
                  <div className="space-y-1">
                    <div
                      style={{ fontSize: `${draft.headingMainPx}px`, color: draft.primaryTextColor }}
                      className="font-extrabold leading-snug"
                    >
                      عنوان رئيسي: مركز إدارة محتوى RahaL TV
                    </div>
                    <div
                      style={{ fontSize: `${draft.headingSectionPx}px`, color: draft.accentColor }}
                      className="font-bold"
                    >
                      وضع المعاينة: {activePreset.shortLabel} — تباين مريح للقراءة
                    </div>
                    <p
                      style={{ fontSize: `${draft.bodyTextPx}px`, color: draft.primaryTextColor }}
                      className="leading-relaxed"
                    >
                      هذا نص تجريبي يوضح وضوح القراءة وتوازن الألوان داخل لوحة الإدارة بالخط (
                      {draft.fontFamily}) ووزن الخط ({draft.fontWeight}).
                    </p>
                    <p
                      style={{
                        fontSize: `${draft.secondaryTextPx}px`,
                        color: draft.secondaryTextColor,
                      }}
                    >
                      نص ثانوي: التباين {draft.contrastLevel}% · السطوع {draft.brightnessLevel}% ·
                      المسافة بين العناصر {draft.elementSpacingPx}px.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <input
                      type="text"
                      readOnly
                      value="حقل إدخال مريح للعين — ابحث عن عمل..."
                      style={{
                        fontSize: `${draft.inputTextPx}px`,
                        borderRadius: `${Math.min(draft.borderRadiusPx, 14)}px`,
                        backgroundColor: previewCssVars['--rtv-admin-surface-2'],
                        borderColor: previewCssVars['--rtv-admin-border'],
                        color: draft.primaryTextColor,
                      }}
                      className="flex-1 min-w-[200px] border px-3.5 py-2"
                    />
                    <button
                      type="button"
                      style={{
                        fontSize: `${draft.buttonTextPx}px`,
                        minHeight: `${draft.buttonHeightPx}px`,
                        borderRadius: `${Math.min(draft.borderRadiusPx, 14)}px`,
                        backgroundColor: draft.accentColor,
                        color: '#ffffff',
                      }}
                      className="rtv-admin-fixed-btn inline-flex items-center gap-1.5 px-4 font-extrabold shadow cursor-default"
                    >
                      <CheckCircle2
                        style={{
                          width: `${draft.iconSizePx}px`,
                          height: `${draft.iconSizePx}px`,
                        }}
                      />
                      <span>زر أساسي ({draft.buttonHeightPx}px)</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl rtv-admin-accent-soft border rtv-admin-accent-text">
            <Palette className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg sm:text-xl font-extrabold text-white">
                نظام راحة العين ومظهر لوحة الإدارة
              </h2>
              <span className="rounded-lg bg-sky-500/15 border border-sky-400/35 px-2.5 py-0.5 text-[10px] font-extrabold text-sky-300">
                خاص بلوحة الإدارة فقط
              </span>
            </div>
            <p className="text-xs text-[#b7c9ef] mt-1">
              تحكم شامل بأوضاع راحة العين الأربعة، الألوان الدقيقة، التباين والسطوع، الخطوط وأحجامها بدون أي تأثير على واجهة الزوار.{' '}
              {onOpenSiteTypography && (
                <button
                  type="button"
                  onClick={onOpenSiteTypography}
                  className="font-extrabold rtv-admin-accent-text underline underline-offset-2 hover:opacity-80 cursor-pointer"
                >
                  الانتقال إلى خطوط الموقع العام
                </button>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleResetDefaults()}
            className="rtv-admin-btn-height inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3.5 py-2 text-xs font-bold text-[#b7c9ef] hover:text-white cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>استعادة الافتراضي</span>
          </button>

          {isDirty && (
            <button
              type="button"
              disabled={saving}
              onClick={() => setDraft(normalizeAdminAppearance(appearance))}
              className="rtv-admin-btn-height inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3.5 py-2 text-xs font-bold text-amber-300 cursor-pointer"
            >
              <span>تراجع عن المسودة</span>
            </button>
          )}

          <button
            type="button"
            disabled={saving}
            onClick={() => void handleApplyAndSave()}
            className="rtv-admin-btn-height inline-flex items-center gap-2 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-50 px-5 py-2.5 text-xs font-extrabold text-white shadow-lg cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{saving ? 'جاري التطبيق والحفظ...' : 'تطبيق وحفظ المظهر الآن'}</span>
          </button>
        </div>
      </div>

      {orderedSubSections.map((sub) => renderSection(sub.id))}
    </div>
  );
}
