import { ChangeEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
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
  AdminAppearanceConfig,
  AdminColorMode,
  AdminFontWeight,
  AdminTableDensity,
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

  // Sync external updates when user resets or remote Firestore snapshot changes
  useEffect(() => {
    setDraft(normalizeAdminAppearance(appearance));
  }, [appearance]);

  // Load preview font stylesheet dynamically BEFORE applying globally to dashboard
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

  const updateDraft = (patch: Partial<AdminAppearanceConfig>) => {
    setDraft((prev) => normalizeAdminAppearance({ ...prev, ...patch }));
  };

  const handleApplyAndSave = async (targetConfig?: AdminAppearanceConfig) => {
    setSaving(true);
    try {
      const saved = saveAdminAppearance(targetConfig || draft);
      onChangeApplied(saved);
      const syncedCloud = await syncAdminAppearanceToFirestore(saved, actorUid);
      onNotify(
        syncedCloud
          ? 'تم تطبيق وحفظ مظهر لوحة الإدارة ومزامنته سحابياً بنجاح (معزول عن واجهة الموقع).'
          : 'تم تطبيق وحفظ مظهر لوحة الإدارة على هذا الجهاز بنجاح (معزول عن واجهة الموقع).'
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
      onNotify(`تم تحميل الخط "${customFont.fileName}" للمعاينة — اضغط تطبيق وحفظ لتفعيله في اللوحة.`);
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

  const isPreviewLight = draft.colorMode === 'light';

  const renderSection = (subId: string) => {
    switch (subId) {
      case 'font_family':
        return (
          <div
            key="font_family"
            className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Type className="w-5 h-5 text-[#D92321]" />
                <h3 className="font-display text-base font-extrabold text-white">
                  1. خط لوحة الإدارة (معاينة قبل التطبيق)
                </h3>
              </div>
              <span className="rounded-lg bg-[#D92321]/15 border border-[#D92321]/35 px-2.5 py-0.5 text-[11px] font-bold text-white">
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
                  className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-xs font-bold text-white focus:border-[#D92321] focus:outline-none"
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

                {/* Instant Font Specimen Before Applying */}
                <div
                  style={{ fontFamily: previewFontStack, fontWeight: draft.fontWeight }}
                  className="rounded-2xl bg-[#1a242e]/80 border border-white/10 p-4 space-y-1.5"
                >
                  <span className="text-[10px] font-bold text-[#f9c400]">
                    معاينة الخط المختار قبل التطبيق:
                  </span>
                  <p className="text-base font-extrabold text-white">
                    إدارة منصة RahaL TV — لوحة تحكم سريعة وواضحة 2026
                  </p>
                  <p className="text-xs text-[#b7c9ef]">
                    الأرقام والبيانات: <span className="tabular-nums">12,480 مشاهدة · IMDb 8.9 · 1080p</span>
                  </p>
                </div>
              </div>

              <div className="rounded-2xl bg-[#1a242e]/80 border border-dashed border-white/20 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-extrabold text-white flex items-center gap-1.5">
                      <FileUp className="w-4 h-4 text-[#f9c400]" />
                      <span>خط مخصص للوحة الإدارة (رفع ملف أو رابط)</span>
                    </p>
                    <p className="text-[11px] text-[#b7c9ef] mt-0.5">
                      يدعم .woff2 / .woff / .ttf / .otf أو رابط Google Fonts CSS
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-1.5 rounded-xl bg-[#D92321] hover:bg-[#f40612] px-3.5 py-2 text-xs font-extrabold text-white shadow cursor-pointer shrink-0">
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
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-[#0c1821] border border-[#4CAF50]/35 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">
                        {draft.customFont.fileName}
                      </p>
                      <p className="font-latin text-[10px] text-[#4CAF50] uppercase">
                        {draft.customFont.format}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {draft.fontFamily !== 'custom' && (
                        <button
                          type="button"
                          onClick={() => updateDraft({ fontFamily: 'custom' })}
                          className="rounded-lg bg-[#4CAF50] px-2.5 py-1 text-[10px] font-extrabold text-white cursor-pointer"
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
                    className="flex-1 rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-[11px] text-white focus:border-[#D92321] focus:outline-none font-latin"
                  />
                  <button
                    type="button"
                    disabled={!urlInput.trim()}
                    onClick={handleApplyUrlFont}
                    className="inline-flex items-center gap-1 rounded-xl bg-[#0c1821] hover:bg-white/10 disabled:opacity-40 border border-white/15 px-3 py-2 text-[11px] font-bold text-white cursor-pointer shrink-0"
                  >
                    <Link2 className="w-3.5 h-3.5 text-[#f9c400]" />
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
                <Sparkles className="w-5 h-5 text-[#f9c400]" />
                <h3 className="font-display text-base font-extrabold text-white">
                  2. أحجام الخطوط التفصيلية ( بالـ px )
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
                      <span className="font-latin shrink-0 rounded-lg bg-[#0c1821] border border-white/10 px-2.5 py-1 text-xs font-black text-[#f9c400] tabular-nums">
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
                        className="flex-1 accent-[#D92321] cursor-pointer"
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

      case 'font_weight':
        return (
          <div
            key="font_weight"
            className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-[#4CAF50]" />
                <h3 className="font-display text-base font-extrabold text-white">
                  3. وزن الخط العام للوحة الإدارة
                </h3>
              </div>
              <span className="font-latin text-xs font-bold text-[#f9c400]">
                {draft.fontWeight}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {WEIGHT_OPTIONS.map((w) => {
                const active = draft.fontWeight === w.value;
                return (
                  <button
                    key={w.value}
                    type="button"
                    onClick={() => updateDraft({ fontWeight: w.value })}
                    style={{ fontFamily: previewFontStack, fontWeight: w.value }}
                    className={`rounded-2xl border p-3.5 text-center transition-all cursor-pointer ${
                      active
                        ? 'bg-[#D92321] border-[#D92321] text-white shadow-lg'
                        : 'bg-[#1a242e]/80 border-white/10 text-[#b7c9ef] hover:text-white hover:border-white/25'
                    }`}
                  >
                    <p className="text-xs font-bold">{w.desc}</p>
                    <p className="font-latin text-[11px] opacity-85 mt-1">{w.label}</p>
                  </button>
                );
              })}
            </div>
          </div>
        );

      case 'layout_theme':
        return (
          <div
            key="layout_theme"
            className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-sky-400" />
                <h3 className="font-display text-base font-extrabold text-white">
                  4. المظهر (داكن / فاتح) وإعدادات التخطيط والبطاقات
                </h3>
              </div>
              <span className="text-[11px] font-bold text-[#b7c9ef]">
                لا يؤثر على ألوان أو مظهر الموقع العام للزوار
              </span>
            </div>

            {/* Color Mode & Table Density Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.07] p-4 space-y-3">
                <p className="text-xs font-extrabold text-white">وضع ألوان لوحة الإدارة</p>
                <div className="grid grid-cols-2 gap-2.5">
                  {(
                    [
                      {
                        id: 'dark',
                        label: 'الوضع الداكن',
                        desc: 'ليلي مريح للإدارة',
                        icon: <Moon className="w-4 h-4 text-[#f9c400]" />,
                      },
                      {
                        id: 'light',
                        label: 'الوضع الفاتح',
                        desc: 'نهاري عالي الوضوح',
                        icon: <Sun className="w-4 h-4 text-amber-400" />,
                      },
                    ] as Array<{
                      id: AdminColorMode;
                      label: string;
                      desc: string;
                      icon: ReactNode;
                    }>
                  ).map((mode) => {
                    const active = draft.colorMode === mode.id;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => updateDraft({ colorMode: mode.id })}
                        className={`flex items-center gap-2.5 rounded-xl border p-3 text-right transition-all cursor-pointer ${
                          active
                            ? 'bg-[#D92321] border-[#D92321] text-white shadow-md'
                            : 'bg-[#0c1821] border-white/10 text-[#b7c9ef] hover:text-white'
                        }`}
                      >
                        {mode.icon}
                        <div>
                          <p className="text-xs font-extrabold">{mode.label}</p>
                          <p className="text-[10px] opacity-80">{mode.desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

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
                        className={`rounded-xl border p-2.5 text-center transition-all cursor-pointer ${
                          active
                            ? 'bg-[#4CAF50] border-[#4CAF50] text-white shadow-md'
                            : 'bg-[#0c1821] border-white/10 text-[#b7c9ef] hover:text-white'
                        }`}
                      >
                        <p className="text-[11px] font-extrabold">{opt.label.split(' ')[0]}</p>
                        <p className="text-[10px] opacity-80 mt-0.5">{opt.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Layout Dimension Sliders */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                      <span className="font-latin shrink-0 rounded-lg bg-[#0c1821] border border-white/10 px-2.5 py-1 text-xs font-black text-[#f9c400] tabular-nums">
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
                        className="flex-1 accent-[#D92321] cursor-pointer"
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
                <Eye className="w-5 h-5 text-[#f9c400]" />
                <h3 className="font-display text-base font-extrabold text-white">
                  5. المعاينة الحية لمظهر لوحة الإدارة (فورية بدون إعادة تحميل)
                </h3>
              </div>
              <span className="text-[11px] font-bold text-[#4CAF50]">
                {isDirty ? 'معاينة تعديلات غير محفوظة بعد' : 'مطابق للمظهر النشط حالياً'}
              </span>
            </div>

            {/* Scoped Preview Box */}
            <div
              data-admin-theme={draft.colorMode}
              style={{
                ...(previewCssVars as Record<string, string>),
                fontFamily: previewFontStack,
                fontWeight: draft.fontWeight,
                borderRadius: `${draft.borderRadiusPx}px`,
              }}
              className={`rtv-admin-preview border p-5 transition-all space-y-5 ${
                isPreviewLight
                  ? 'bg-[#f1f5f9] border-slate-300 text-slate-900'
                  : 'bg-[#06131c] border-white/15 text-white'
              }`}
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                {/* Mini Sidebar Preview */}
                <div
                  style={{
                    borderRadius: `${draft.borderRadiusPx}px`,
                    padding: `${Math.max(10, Math.round(draft.cardPaddingPx * 0.65))}px`,
                  }}
                  className={`lg:col-span-4 border space-y-2 ${
                    isPreviewLight
                      ? 'bg-white border-slate-200'
                      : 'bg-[#0c1821] border-white/10'
                  }`}
                >
                  <p
                    style={{ fontSize: `${draft.secondaryTextPx}px` }}
                    className={`font-bold ${isPreviewLight ? 'text-slate-500' : 'text-[#b7c9ef]'}`}
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
                          }}
                          className={`flex items-center gap-2 px-3 py-2 font-bold ${
                            i === 0
                              ? 'bg-[#D92321] text-white'
                              : isPreviewLight
                                ? 'bg-slate-100 text-slate-700'
                                : 'bg-[#1a242e] text-[#b7c9ef]'
                          }`}
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
                  }}
                  className={`lg:col-span-8 border space-y-4 ${
                    isPreviewLight
                      ? 'bg-white border-slate-200'
                      : 'bg-[#0c1821] border-white/10'
                  }`}
                >
                  <div className="space-y-1">
                    <div
                      style={{ fontSize: `${draft.headingMainPx}px` }}
                      className="font-extrabold leading-snug"
                    >
                      عنوان رئيسي: مركز إدارة محتوى RahaL TV
                    </div>
                    <div
                      style={{ fontSize: `${draft.headingSectionPx}px` }}
                      className={`font-bold ${isPreviewLight ? 'text-slate-800' : 'text-[#f9c400]'}`}
                    >
                      عنوان فرعي: إعدادات البطاقات والجداول والحقول
                    </div>
                    <p style={{ fontSize: `${draft.bodyTextPx}px` }} className="leading-relaxed">
                      هذا نص عادي يوضح وضوح القراءة داخل لوحة الإدارة بالخط المختار ({draft.fontFamily}
                      ) ووزن الخط ({draft.fontWeight}).
                    </p>
                    <p
                      style={{ fontSize: `${draft.secondaryTextPx}px` }}
                      className={isPreviewLight ? 'text-slate-500' : 'text-[#b7c9ef]'}
                    >
                      نص فرعي ووصفي: آخر مزامنة سحابية ناجحة منذ دقيقتين — استدارة الحواف{' '}
                      {draft.borderRadiusPx}px.
                    </p>
                  </div>

                  {/* Card Title + Input + Button */}
                  <div
                    style={{
                      borderRadius: `${Math.min(draft.borderRadiusPx, 18)}px`,
                    }}
                    className={`border p-3.5 space-y-3 ${
                      isPreviewLight
                        ? 'bg-slate-50 border-slate-200'
                        : 'bg-[#1a242e]/80 border-white/10'
                    }`}
                  >
                    <div
                      style={{ fontSize: `${draft.cardTitlePx}px` }}
                      className="font-extrabold"
                    >
                      عنوان البطاقة التجريبية ({draft.cardTitlePx}px)
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      <input
                        type="text"
                        readOnly
                        value="حقل إدخال تجريبي — ابحث عن فيلم أو مسلسل..."
                        style={{
                          fontSize: `${draft.inputTextPx}px`,
                          borderRadius: `${Math.min(draft.borderRadiusPx, 14)}px`,
                        }}
                        className={`flex-1 min-w-[200px] border px-3.5 py-2 ${
                          isPreviewLight
                            ? 'bg-white border-slate-300 text-slate-900'
                            : 'bg-[#0c1821] border-white/15 text-white'
                        }`}
                      />
                      <button
                        type="button"
                        style={{
                          fontSize: `${draft.buttonTextPx}px`,
                          minHeight: `${draft.buttonHeightPx}px`,
                          borderRadius: `${Math.min(draft.borderRadiusPx, 14)}px`,
                        }}
                        className="rtv-admin-fixed-btn inline-flex items-center gap-1.5 bg-[#D92321] px-4 font-extrabold text-white shadow cursor-default"
                      >
                        <CheckCircle2
                          style={{
                            width: `${draft.iconSizePx}px`,
                            height: `${draft.iconSizePx}px`,
                          }}
                        />
                        <span>زر تجريبي ({draft.buttonHeightPx}px)</span>
                      </button>
                    </div>
                  </div>

                  {/* Sample Table */}
                  <div
                    style={{ borderRadius: `${Math.min(draft.borderRadiusPx, 16)}px` }}
                    className={`overflow-hidden border ${
                      isPreviewLight ? 'border-slate-200' : 'border-white/10'
                    }`}
                  >
                    <table className="w-full text-right">
                      <thead
                        className={
                          isPreviewLight
                            ? 'bg-slate-100 text-slate-700'
                            : 'bg-[#1a242e] text-[#b7c9ef]'
                        }
                      >
                        <tr>
                          {['العنوان', 'النوع', 'الجودة', 'الحالة'].map((h) => (
                            <th
                              key={h}
                              style={{
                                fontSize: `${draft.tableTextPx}px`,
                                paddingTop: previewCssVars['--rtv-admin-table-py'],
                                paddingBottom: previewCssVars['--rtv-admin-table-py'],
                                paddingInline: previewCssVars['--rtv-admin-table-px'],
                              }}
                              className="font-extrabold"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody
                        className={
                          isPreviewLight
                            ? 'divide-y divide-slate-200 bg-white'
                            : 'divide-y divide-white/10 bg-[#0c1821]'
                        }
                      >
                        {[
                          { title: 'فيلم الأكشن السريع 2026', type: 'فيلم', q: '4K UHD', st: 'منشور' },
                          { title: 'مسلسل رمضان الحصري', type: 'مسلسل', q: '1080p', st: 'مثبت' },
                        ].map((row) => (
                          <tr key={row.title}>
                            <td
                              style={{
                                fontSize: `${draft.tableTextPx}px`,
                                paddingTop: previewCssVars['--rtv-admin-table-py'],
                                paddingBottom: previewCssVars['--rtv-admin-table-py'],
                                paddingInline: previewCssVars['--rtv-admin-table-px'],
                              }}
                              className="font-bold"
                            >
                              {row.title}
                            </td>
                            <td
                              style={{
                                fontSize: `${draft.tableTextPx}px`,
                                paddingTop: previewCssVars['--rtv-admin-table-py'],
                                paddingBottom: previewCssVars['--rtv-admin-table-py'],
                                paddingInline: previewCssVars['--rtv-admin-table-px'],
                              }}
                            >
                              {row.type}
                            </td>
                            <td
                              style={{
                                fontSize: `${draft.tableTextPx}px`,
                                paddingTop: previewCssVars['--rtv-admin-table-py'],
                                paddingBottom: previewCssVars['--rtv-admin-table-py'],
                                paddingInline: previewCssVars['--rtv-admin-table-px'],
                              }}
                              className="font-latin"
                            >
                              {row.q}
                            </td>
                            <td
                              style={{
                                fontSize: `${draft.tableTextPx}px`,
                                paddingTop: previewCssVars['--rtv-admin-table-py'],
                                paddingBottom: previewCssVars['--rtv-admin-table-py'],
                                paddingInline: previewCssVars['--rtv-admin-table-px'],
                              }}
                              className="text-[#4CAF50] font-bold"
                            >
                              {row.st}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
      {/* Header Bar */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#D92321]/15 border border-[#D92321]/35 text-[#D92321]">
            <Palette className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg sm:text-xl font-extrabold text-white">
                تخصيص مظهر لوحة الإدارة
              </h2>
              <span className="rounded-lg bg-sky-500/15 border border-sky-400/35 px-2.5 py-0.5 text-[10px] font-extrabold text-sky-300">
                خاص بلوحة الإدارة فقط
              </span>
            </div>
            <p className="text-xs text-[#b7c9ef] mt-1">
              تحكم كامل في خطوط وأحجام وأوزان لوحة الإدارة، المظهر الداكن والفاتح، عرض القائمة، وكثافة الجداول دون أي تأثير على الموقع العام.{' '}
              {onOpenSiteTypography && (
                <button
                  type="button"
                  onClick={onOpenSiteTypography}
                  className="font-extrabold text-[#f9c400] underline underline-offset-2 hover:text-white cursor-pointer"
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

      {/* Render Sub-sections in Configured Order */}
      {orderedSubSections.map((sub) => renderSection(sub.id))}
    </div>
  );
}
