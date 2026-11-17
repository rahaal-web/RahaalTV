import { useMemo } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Eye,
  LayoutGrid,
  Monitor,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  DEFAULT_HOME_CONFIG,
  normalizeHomeConfig,
  saveStoredHomeConfig,
} from '../lib/homeConfig';
import {
  HomeHeroMode,
  HomeLayoutConfig,
  HomeSectionConfig,
  HomeSectionSource,
  MediaItem,
} from '../types/media';

interface HomeBuilderPanelProps {
  catalog: MediaItem[];
  homeConfig: HomeLayoutConfig;
  tickerEnabled: boolean;
  busyAction: boolean;
  onChangeHomeConfig: (next: HomeLayoutConfig) => void;
  onChangeTickerEnabled: (enabled: boolean) => void;
  onSaveHomeConfig: (next: HomeLayoutConfig) => Promise<void>;
  onPreviewHome: () => void;
  onNotify: (msg: string) => void;
}

const SOURCE_OPTIONS: Array<{ value: HomeSectionSource; label: string }> = [
  { value: 'latest', label: 'أحدث الإضافات' },
  { value: 'movies', label: 'الأفلام' },
  { value: 'series', label: 'المسلسلات والبرامج' },
  { value: 'top_rated', label: 'الأعلى تقييماً (IMDb)' },
  { value: 'trending', label: 'الأكثر مشاهدة' },
  { value: 'ramadan', label: 'رمضان 2026' },
  { value: 'wrestling', label: 'مصارعة حرة' },
  { value: 'category', label: 'تصنيف مخصص (Category)' },
  { value: 'custom', label: 'اختيار أعمال يدوياً' },
];

export function HomeBuilderPanel({
  catalog,
  homeConfig,
  tickerEnabled,
  busyAction,
  onChangeHomeConfig,
  onChangeTickerEnabled,
  onSaveHomeConfig,
  onPreviewHome,
  onNotify,
}: HomeBuilderPanelProps) {
  const cfg = useMemo(() => normalizeHomeConfig(homeConfig), [homeConfig]);

  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    catalog.forEach((item) => {
      (item.categories || []).forEach((c) => {
        if (c.trim()) set.add(c.trim());
      });
    });
    return Array.from(set);
  }, [catalog]);

  const updateCfg = (patch: Partial<HomeLayoutConfig>) => {
    const next = normalizeHomeConfig({ ...cfg, ...patch });
    saveStoredHomeConfig(next);
    onChangeHomeConfig(next);
  };

  const updateSection = (id: string, patch: Partial<HomeSectionConfig>) => {
    const nextSections = cfg.sections.map((sec) =>
      sec.id === id ? { ...sec, ...patch } : sec
    );
    updateCfg({ sections: nextSections });
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= cfg.sections.length) return;
    const copy = [...cfg.sections];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved);
    updateCfg({ sections: copy });
  };

  const deleteSection = (id: string) => {
    if (cfg.sections.length <= 1) {
      onNotify('يجب الإبقاء على قسم واحد على الأقل في الصفحة الرئيسية');
      return;
    }
    updateCfg({ sections: cfg.sections.filter((s) => s.id !== id) });
  };

  const addNewSection = () => {
    if (cfg.sections.length >= 12) {
      onNotify('الحد الأقصى هو 12 قسماً للحفاظ على سرعة الصفحة');
      return;
    }
    const newSec: HomeSectionConfig = {
      id: `sec-${Date.now()}`,
      title: 'قسم مخصص جديد',
      subtitle: 'أعمال مختارة بعناية',
      enabled: true,
      source: 'top_rated',
      categoryFilter: '',
      customMediaIds: [],
      limit: 10,
      layout: 'grid',
    };
    updateCfg({ sections: [...cfg.sections, newSec] });
  };

  const applyPreset = (preset: 'clean' | 'netflix' | 'minimal') => {
    if (preset === 'clean') {
      const next = normalizeHomeConfig(DEFAULT_HOME_CONFIG);
      saveStoredHomeConfig(next);
      onChangeHomeConfig(next);
      onChangeTickerEnabled(false);
      onNotify('تم تطبيق التصميم النظيف المتوازن — اضغط حفظ لتعميمه');
      return;
    }
    if (preset === 'netflix') {
      const next = normalizeHomeConfig({
        ...DEFAULT_HOME_CONFIG,
        showQuickFilters: true,
        showCategoryBar: false,
        showFullLibrary: false,
        cardStyle: 'clean',
        cardsPerRow: 5,
        sections: [
          {
            id: 'sec-latest',
            title: 'أحدث الإضافات',
            subtitle: 'أجدد ما تم رفعه اليوم',
            enabled: true,
            source: 'latest',
            limit: 12,
            layout: 'row',
          },
          {
            id: 'sec-trending',
            title: 'الأكثر مشاهدة الآن',
            subtitle: 'الأعمال الرائجة بين الزوار',
            enabled: true,
            source: 'trending',
            limit: 12,
            layout: 'row',
          },
          {
            id: 'sec-movies',
            title: 'أفلام سينمائية',
            subtitle: 'جودة 4K و BluRay',
            enabled: true,
            source: 'movies',
            limit: 12,
            layout: 'row',
          },
          {
            id: 'sec-series',
            title: 'مسلسلات كاملة',
            subtitle: 'حلقات ومواسم محدثة',
            enabled: true,
            source: 'series',
            limit: 12,
            layout: 'row',
          },
        ],
      });
      saveStoredHomeConfig(next);
      onChangeHomeConfig(next);
      onChangeTickerEnabled(false);
      onNotify('تم تطبيق أسلوب الصفوف الأفقية (Netflix Style) — اضغط حفظ لتعميمه');
      return;
    }
    // minimal
    const next = normalizeHomeConfig({
      ...DEFAULT_HOME_CONFIG,
      showQuickFilters: true,
      showCategoryBar: false,
      showFullLibrary: false,
      showRequestBanner: true,
      heroShowHighlights: false,
      cardsPerRow: 5,
      sections: [
        {
          id: 'sec-latest',
          title: 'أحدث الأعمال المضافة',
          subtitle: '',
          enabled: true,
          source: 'latest',
          limit: 15,
          layout: 'grid',
        },
      ],
    });
    saveStoredHomeConfig(next);
    onChangeHomeConfig(next);
    onChangeTickerEnabled(false);
    onNotify('تم تطبيق الواجهة المصغرة السريعة — اضغط حفظ لتعميمه');
  };

  return (
    <div className="space-y-6">
      {/* Top Action Header */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#D92321]/15 border border-[#D92321]/35 text-[#D92321]">
            <SlidersHorizontal className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-lg sm:text-xl font-extrabold text-white">
              إدارة وتخصيص الصفحة الرئيسية بالكامل
            </h2>
            <p className="text-xs text-[#b7c9ef] mt-1">
              تحكم في قسم البطل (Hero)، شكل البطاقات، ترتيب الأقسام، إظهار أو إخفاء أي عنصر، وتغيير أسلوب العرض فوراً.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onPreviewHome}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-4 py-2.5 text-xs font-bold text-white cursor-pointer"
          >
            <Eye className="w-4 h-4 text-[#f9c400]" />
            <span>معاينة الرئيسية</span>
          </button>

          <button
            type="button"
            disabled={busyAction}
            onClick={() => void onSaveHomeConfig(cfg)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] px-5 py-2.5 text-xs font-extrabold text-white shadow-lg cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{busyAction ? 'جاري الحفظ...' : 'حفظ وتطبيق التصميم الآن'}</span>
          </button>
        </div>
      </div>

      {/* Quick Layout Presets */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-3">
        <div className="flex items-center gap-2 text-xs font-extrabold text-[#f9c400]">
          <Sparkles className="w-4 h-4" />
          <span>قوالب جاهزة بضغطة زر</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => applyPreset('clean')}
            className="rounded-2xl bg-[#1a242e] hover:border-[#D92321] border border-white/10 p-4 text-right transition-colors cursor-pointer"
          >
            <p className="text-sm font-extrabold text-white">متوازن ونظيف (الافتراضي)</p>
            <p className="text-[11px] text-[#b7c9ef] mt-1">
              بطل سينمائي + فلاتر سريعة + 3 أقسام مرتبة بدون زحمة.
            </p>
          </button>
          <button
            type="button"
            onClick={() => applyPreset('netflix')}
            className="rounded-2xl bg-[#1a242e] hover:border-[#D92321] border border-white/10 p-4 text-right transition-colors cursor-pointer"
          >
            <p className="text-sm font-extrabold text-white">صفوف أفقية (Netflix Style)</p>
            <p className="text-[11px] text-[#b7c9ef] mt-1">
              سلايدر بطل كبير مع صفوف تمرير أفقية ناعمة لكل قسم.
            </p>
          </button>
          <button
            type="button"
            onClick={() => applyPreset('minimal')}
            className="rounded-2xl bg-[#1a242e] hover:border-[#D92321] border border-white/10 p-4 text-right transition-colors cursor-pointer"
          >
            <p className="text-sm font-extrabold text-white">واجهة فائقة البساطة</p>
            <p className="text-[11px] text-[#b7c9ef] mt-1">
              بطل رئيسي + شبكة واحدة لأحدث الأعمال بأسرع تحميل ممكن.
            </p>
          </button>
        </div>
      </div>

      {/* Grid: Hero Control + Visual Layout Toggles */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Hero Section Controller */}
        <div className="xl:col-span-7 rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <Monitor className="w-5 h-5 text-[#D92321]" />
              <h3 className="font-display text-base font-extrabold text-white">
                التحكم في قسم البطل (Hero Banner)
              </h3>
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-bold text-white cursor-pointer">
              <input
                type="checkbox"
                checked={cfg.showHero}
                onChange={(e) => updateCfg({ showHero: e.target.checked })}
                className="h-4 w-4 accent-[#D92321]"
              />
              <span>إظهار البطل</span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(
              [
                { id: 'auto', label: 'تلقائي (المثبتة)' },
                { id: 'manual', label: 'عمل محدد يدوياً' },
                { id: 'brand', label: 'تعريف الموقع + عمل' },
              ] as Array<{ id: HomeHeroMode; label: string }>
            ).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => updateCfg({ heroMode: mode.id })}
                className={`rounded-xl border px-3 py-2.5 text-xs font-extrabold transition-colors cursor-pointer ${
                  cfg.heroMode === mode.id
                    ? 'bg-[#D92321] border-[#D92321] text-white'
                    : 'bg-[#1a242e] border-white/10 text-[#b7c9ef] hover:text-white'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {(cfg.heroMode === 'manual' || cfg.heroMode === 'brand') && (
            <div>
              <label className="block text-xs font-bold text-[#b7c9ef] mb-1.5">
                اختر العمل الظاهر في الواجهة الرئيسية
              </label>
              <select
                value={cfg.heroMediaId}
                onChange={(e) => updateCfg({ heroMediaId: e.target.value })}
                className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-xs font-bold text-white focus:border-[#D92321] focus:outline-none"
              >
                <option value="">الأحدث تلقائياً ({catalog[0]?.title || '—'})</option>
                {catalog.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} ({item.year})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#b7c9ef] mb-1">شارة البطل</label>
              <input
                type="text"
                maxLength={50}
                value={cfg.heroBadgeText}
                onChange={(e) => updateCfg({ heroBadgeText: e.target.value })}
                placeholder="اختيار المحررين"
                className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white focus:border-[#D92321] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#b7c9ef] mb-1">نص زر التشغيل</label>
              <input
                type="text"
                maxLength={40}
                value={cfg.heroPrimaryCta}
                onChange={(e) => updateCfg({ heroPrimaryCta: e.target.value })}
                placeholder="مشاهدة الآن"
                className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white focus:border-[#D92321] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#b7c9ef] mb-1">
              عنوان رئيسي مخصص (اتركه فارغاً لاستخدام عنوان العمل)
            </label>
            <input
              type="text"
              maxLength={160}
              value={cfg.heroHeadline}
              onChange={(e) => updateCfg({ heroHeadline: e.target.value })}
              placeholder="مثال: استمتع بأحدث الأفلام والمسلسلات بدقة 4K"
              className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white focus:border-[#D92321] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#b7c9ef] mb-1">
              وصف مخصص (اتركه فارغاً لاستخدام قصة العمل)
            </label>
            <textarea
              rows={2}
              maxLength={320}
              value={cfg.heroDescription}
              onChange={(e) => updateCfg({ heroDescription: e.target.value })}
              placeholder="وصف مختصر وجذاب يظهر تحت العنوان..."
              className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs text-white focus:border-[#D92321] focus:outline-none"
            />
          </div>

          <label className="flex items-center gap-2.5 text-xs font-bold text-white cursor-pointer">
            <input
              type="checkbox"
              checked={cfg.heroShowHighlights}
              onChange={(e) => updateCfg({ heroShowHighlights: e.target.checked })}
              className="h-4 w-4 accent-[#D92321]"
            />
            <span>إظهار مميزات المنصة السريعة أسفل البطل (سيرفرات سريعة · 4K · تحديث يومي)</span>
          </label>
        </div>

        {/* Visual Density & Elements Toggles */}
        <div className="xl:col-span-5 rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-5">
          <div className="flex items-center gap-2 border-b border-white/10 pb-3">
            <LayoutGrid className="w-5 h-5 text-[#f9c400]" />
            <h3 className="font-display text-base font-extrabold text-white">
              شكل البطاقات وعناصر الصفحة
            </h3>
          </div>

          <div>
            <span className="block text-xs font-bold text-[#b7c9ef] mb-2">تصميم البطاقة</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => updateCfg({ cardStyle: 'clean' })}
                className={`rounded-xl border px-3 py-2.5 text-xs font-extrabold cursor-pointer ${
                  cfg.cardStyle === 'clean'
                    ? 'bg-[#D92321] border-[#D92321] text-white'
                    : 'bg-[#1a242e] border-white/10 text-[#b7c9ef]'
                }`}
              >
                حديث نظيف (Netflix)
              </button>
              <button
                type="button"
                onClick={() => updateCfg({ cardStyle: 'classic' })}
                className={`rounded-xl border px-3 py-2.5 text-xs font-extrabold cursor-pointer ${
                  cfg.cardStyle === 'classic'
                    ? 'bg-[#D92321] border-[#D92321] text-white'
                    : 'bg-[#1a242e] border-white/10 text-[#b7c9ef]'
                }`}
              >
                كلاسيكي (قلب ثلاثي 3D)
              </button>
            </div>
          </div>

          <div>
            <span className="block text-xs font-bold text-[#b7c9ef] mb-2">
              عدد البطاقات في الصف (على الشاشات الكبيرة)
            </span>
            <div className="grid grid-cols-3 gap-2">
              {([4, 5, 6] as const).map((cols) => (
                <button
                  key={cols}
                  type="button"
                  onClick={() => updateCfg({ cardsPerRow: cols })}
                  className={`font-latin rounded-xl border py-2 text-xs font-black cursor-pointer ${
                    cfg.cardsPerRow === cols
                      ? 'bg-[#f9c400] border-[#f9c400] text-[#06131c]'
                      : 'bg-[#1a242e] border-white/10 text-white'
                  }`}
                >
                  {cols} بطاقات
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5 pt-1">
            <span className="block text-xs font-bold text-[#b7c9ef]">إظهار / إخفاء العناصر</span>
            {[
              {
                label: 'شريط الفلاتر السريعة أعلى الرئيسية',
                checked: cfg.showQuickFilters,
                onChange: (v: boolean) => updateCfg({ showQuickFilters: v }),
              },
              {
                label: 'شريط التصنيفات الكامل بالأسفل',
                checked: cfg.showCategoryBar,
                onChange: (v: boolean) => updateCfg({ showCategoryBar: v }),
              },
              {
                label: 'جدول المكتبة الكاملة بصفحات بالرئيسية',
                checked: cfg.showFullLibrary,
                onChange: (v: boolean) => updateCfg({ showFullLibrary: v }),
              },
              {
                label: 'قسم "اطلب عملاً أو تواصل معنا"',
                checked: cfg.showRequestBanner,
                onChange: (v: boolean) => updateCfg({ showRequestBanner: v }),
              },
              {
                label: 'شريط الأخبار المتحرك (Ticker)',
                checked: tickerEnabled,
                onChange: (v: boolean) => onChangeTickerEnabled(v),
              },
            ].map((item) => (
              <label
                key={item.label}
                className="flex items-center justify-between rounded-xl bg-[#1a242e]/80 border border-white/[0.06] px-3.5 py-2.5 text-xs font-bold text-white cursor-pointer"
              >
                <span>{item.label}</span>
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={(e) => item.onChange(e.target.checked)}
                  className="h-4 w-4 accent-[#D92321]"
                />
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Sections Order & Content Builder */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <h3 className="font-display text-base font-extrabold text-white">
              أقسام الصفحة الرئيسية وترتيبها ({cfg.sections.length})
            </h3>
            <p className="text-xs text-[#b7c9ef] mt-0.5">
              رتّب الأقسام للأعلى والأسفل، اختر مصدر المحتوى، غيّر نمط العرض (شبكة أو صف أفقي)، أو أنشئ قسماً يدوياً.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => applyPreset('clean')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3.5 py-2 text-xs font-bold text-[#b7c9ef] hover:text-white cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>استعادة الافتراضي</span>
            </button>
            <button
              type="button"
              onClick={addNewSection}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#D92321] hover:bg-[#dc0e30] px-4 py-2 text-xs font-extrabold text-white cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة قسم</span>
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {cfg.sections.map((section, idx) => (
            <div
              key={section.id}
              className={`rounded-2xl border p-4 space-y-3 transition-colors ${
                section.enabled
                  ? 'bg-[#1a242e]/80 border-white/10'
                  : 'bg-[#111820]/50 border-white/5 opacity-65'
              }`}
            >
              {/* Section Top Row */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="font-latin inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#0c1821] text-xs font-black text-[#f9c400]">
                    {idx + 1}
                  </span>
                  <label className="inline-flex items-center gap-2 text-xs font-extrabold text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={section.enabled}
                      onChange={(e) => updateSection(section.id, { enabled: e.target.checked })}
                      className="h-4 w-4 accent-[#4CAF50]"
                    />
                    <span>{section.enabled ? 'مُفعّل' : 'مخفي'}</span>
                  </label>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => moveSection(idx, -1)}
                    title="تحريك للأعلى"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#0c1821] border border-white/10 text-white disabled:opacity-30 hover:border-white/30 cursor-pointer"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === cfg.sections.length - 1}
                    onClick={() => moveSection(idx, 1)}
                    title="تحريك للأسفل"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#0c1821] border border-white/10 text-white disabled:opacity-30 hover:border-white/30 cursor-pointer"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteSection(section.id)}
                    title="حذف القسم"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#D92321]/15 border border-[#D92321]/30 text-[#ff8a88] hover:bg-[#D92321] hover:text-white cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Section Fields Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                    عنوان القسم
                  </label>
                  <input
                    type="text"
                    maxLength={100}
                    value={section.title}
                    onChange={(e) => updateSection(section.id, { title: e.target.value })}
                    className="w-full rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-xs font-bold text-white focus:border-[#D92321] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                    وصف فرعي (اختياري)
                  </label>
                  <input
                    type="text"
                    maxLength={180}
                    value={section.subtitle}
                    onChange={(e) => updateSection(section.id, { subtitle: e.target.value })}
                    className="w-full rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-xs text-white focus:border-[#D92321] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                    مصدر المحتوى
                  </label>
                  <select
                    value={section.source}
                    onChange={(e) =>
                      updateSection(section.id, {
                        source: e.target.value as HomeSectionSource,
                      })
                    }
                    className="w-full rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-xs font-bold text-white focus:border-[#D92321] focus:outline-none"
                  >
                    {SOURCE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      طريقة العرض
                    </label>
                    <select
                      value={section.layout}
                      onChange={(e) =>
                        updateSection(section.id, {
                          layout: e.target.value === 'row' ? 'row' : 'grid',
                        })
                      }
                      className="w-full rounded-xl bg-[#0c1821] border border-white/10 px-2.5 py-2 text-xs font-bold text-white focus:border-[#D92321] focus:outline-none"
                    >
                      <option value="grid">شبكة (Grid)</option>
                      <option value="row">صف أفقي (Row)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                      عدد العناصر
                    </label>
                    <select
                      value={section.limit}
                      onChange={(e) =>
                        updateSection(section.id, { limit: Number(e.target.value) || 10 })
                      }
                      className="font-latin w-full rounded-xl bg-[#0c1821] border border-white/10 px-2.5 py-2 text-xs font-bold text-white focus:border-[#D92321] focus:outline-none"
                    >
                      {[4, 5, 6, 8, 10, 12, 15, 20].map((num) => (
                        <option key={num} value={num}>
                          {num}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Conditional Category Filter Picker */}
              {section.source === 'category' && (
                <div>
                  <label className="block text-[11px] font-bold text-[#f9c400] mb-1">
                    اختر التصنيف المطلوب لهذا القسم
                  </label>
                  <select
                    value={section.categoryFilter || ''}
                    onChange={(e) =>
                      updateSection(section.id, { categoryFilter: e.target.value })
                    }
                    className="w-full sm:w-72 rounded-xl bg-[#0c1821] border border-[#f9c400]/40 px-3 py-2 text-xs font-bold text-white focus:outline-none"
                  >
                    <option value="">-- اختر تصنيفاً --</option>
                    {availableCategories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Conditional Manual Media Picker */}
              {section.source === 'custom' && (
                <div className="rounded-xl bg-[#0c1821] border border-white/10 p-3 space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-bold text-[#f9c400]">
                    <span>
                      اختر الأعمال يدوياً ({(section.customMediaIds || []).length} محدد)
                    </span>
                  </div>
                  <div className="max-h-40 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5">
                    {catalog.slice(0, 60).map((item) => {
                      const picked = (section.customMediaIds || []).includes(item.id);
                      return (
                        <label
                          key={item.id}
                          className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer border ${
                            picked
                              ? 'bg-[#D92321]/20 border-[#D92321] text-white'
                              : 'bg-[#1a242e]/60 border-white/5 text-[#b7c9ef]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={picked}
                            onChange={(e) => {
                              const current = section.customMediaIds || [];
                              const nextIds = e.target.checked
                                ? [...current, item.id]
                                : current.filter((id) => id !== item.id);
                              updateSection(section.id, { customMediaIds: nextIds });
                            }}
                            className="h-3.5 w-3.5 accent-[#D92321] shrink-0"
                          />
                          <span className="truncate">{item.title}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
