import { CustomFontFormat, CustomFontRecord, CustomFontSlot, TypographyConfig } from '../types/media';

export const TYPOGRAPHY_STORAGE_KEY = 'rahaltv_typography_v1';
export const CUSTOM_FONTS_STORAGE_KEY = 'rahaltv_custom_fonts_v1';

export const MAX_CUSTOM_FONT_FILE_BYTES = 680 * 1024; // ~680 KB raw => <= ~910 KB base64 safely inside 1MB Firestore doc

export interface FontPresetOption {
  id: string;
  label: string;
  cssFamily: string;
  googleSpec?: string;
}

export const ARABIC_FONT_PRESETS: FontPresetOption[] = [
  {
    id: 'Tajawal',
    label: 'تجوال (Tajawal — الافتراضي)',
    cssFamily: 'Tajawal',
    googleSpec: 'Tajawal:wght@400;500;700;800',
  },
  {
    id: 'Cairo',
    label: 'كايرو (Cairo — عريض وعصري)',
    cssFamily: 'Cairo',
    googleSpec: 'Cairo:wght@400;500;600;700;800;900',
  },
  {
    id: 'Almarai',
    label: 'المراعي (Almarai — هندسي واضح)',
    cssFamily: 'Almarai',
    googleSpec: 'Almarai:wght@400;700;800',
  },
  {
    id: 'IBM Plex Sans Arabic',
    label: 'IBM Plex Arabic (أنيق واحترافي)',
    cssFamily: 'IBM Plex Sans Arabic',
    googleSpec: 'IBM+Plex+Sans+Arabic:wght@400;500;600;700',
  },
  {
    id: 'Readex Pro',
    label: 'Readex Pro (حديث للقراءة)',
    cssFamily: 'Readex Pro',
    googleSpec: 'Readex+Pro:wght@400;500;600;700',
  },
  {
    id: 'Alexandria',
    label: 'الإسكندرية (Alexandria)',
    cssFamily: 'Alexandria',
    googleSpec: 'Alexandria:wght@400;500;600;700;800;900',
  },
  {
    id: 'Rubik',
    label: 'روبيك (Rubik — ناعم)',
    cssFamily: 'Rubik',
    googleSpec: 'Rubik:wght@400;500;600;700;800',
  },
  {
    id: 'Changa',
    label: 'تشانجا (Changa — سينمائي)',
    cssFamily: 'Changa',
    googleSpec: 'Changa:wght@400;500;600;700;800',
  },
];

export const ENGLISH_FONT_PRESETS: FontPresetOption[] = [
  {
    id: 'Cairo',
    label: 'Cairo (الافتراضي المتوازن)',
    cssFamily: 'Cairo',
    googleSpec: 'Cairo:wght@500;600;700;800;900',
  },
  {
    id: 'Inter',
    label: 'Inter (عصري ونظيف)',
    cssFamily: 'Inter',
    googleSpec: 'Inter:wght@400;500;600;700;800;900',
  },
  {
    id: 'Poppins',
    label: 'Poppins (هندسي بارز)',
    cssFamily: 'Poppins',
    googleSpec: 'Poppins:wght@400;500;600;700;800;900',
  },
  {
    id: 'Outfit',
    label: 'Outfit (سينمائي حديث)',
    cssFamily: 'Outfit',
    googleSpec: 'Outfit:wght@400;500;600;700;800;900',
  },
  {
    id: 'Montserrat',
    label: 'Montserrat (عناوين قوية)',
    cssFamily: 'Montserrat',
    googleSpec: 'Montserrat:wght@400;500;600;700;800;900',
  },
  {
    id: 'Space Grotesk',
    label: 'Space Grotesk (تقني)',
    cssFamily: 'Space Grotesk',
    googleSpec: 'Space+Grotesk:wght@400;500;600;700',
  },
  {
    id: 'Roboto',
    label: 'Roboto (كلاسيكي)',
    cssFamily: 'Roboto',
    googleSpec: 'Roboto:wght@400;500;700;900',
  },
];

export const DEFAULT_TYPOGRAPHY_CONFIG: TypographyConfig = {
  arabicFont: 'Tajawal',
  englishFont: 'Cairo',
  baseFontSizePx: 16,
  heroTitleSizePx: 22,
  detailTitleSizePx: 20,
  cardTitleSizePx: 13,
  sectionTitleSizePx: 22,
};

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

export function normalizeTypographyConfig(
  raw?: Partial<TypographyConfig> | null
): TypographyConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_TYPOGRAPHY_CONFIG };
  }

  const validArabicIds = new Set([...ARABIC_FONT_PRESETS.map((p) => p.id), 'custom']);
  const validEnglishIds = new Set([...ENGLISH_FONT_PRESETS.map((p) => p.id), 'custom']);

  const arabicFont =
    typeof raw.arabicFont === 'string' && validArabicIds.has(raw.arabicFont.trim())
      ? raw.arabicFont.trim()
      : DEFAULT_TYPOGRAPHY_CONFIG.arabicFont;

  const englishFont =
    typeof raw.englishFont === 'string' && validEnglishIds.has(raw.englishFont.trim())
      ? raw.englishFont.trim()
      : DEFAULT_TYPOGRAPHY_CONFIG.englishFont;

  return {
    arabicFont,
    englishFont,
    baseFontSizePx: clampInt(raw.baseFontSizePx, 13, 20, DEFAULT_TYPOGRAPHY_CONFIG.baseFontSizePx),
    heroTitleSizePx: clampInt(raw.heroTitleSizePx, 16, 42, DEFAULT_TYPOGRAPHY_CONFIG.heroTitleSizePx),
    detailTitleSizePx: clampInt(raw.detailTitleSizePx, 16, 38, DEFAULT_TYPOGRAPHY_CONFIG.detailTitleSizePx),
    cardTitleSizePx: clampInt(raw.cardTitleSizePx, 11, 20, DEFAULT_TYPOGRAPHY_CONFIG.cardTitleSizePx),
    sectionTitleSizePx: clampInt(raw.sectionTitleSizePx, 16, 32, DEFAULT_TYPOGRAPHY_CONFIG.sectionTitleSizePx),
  };
}

export function loadStoredTypographyConfig(): TypographyConfig {
  if (typeof window === 'undefined') return { ...DEFAULT_TYPOGRAPHY_CONFIG };
  try {
    const raw = localStorage.getItem(TYPOGRAPHY_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TYPOGRAPHY_CONFIG };
    return normalizeTypographyConfig(JSON.parse(raw) as Partial<TypographyConfig>);
  } catch {
    return { ...DEFAULT_TYPOGRAPHY_CONFIG };
  }
}

export function saveStoredTypographyConfig(config: TypographyConfig): TypographyConfig {
  const clean = normalizeTypographyConfig(config);
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify(clean));
    } catch {
      // Ignore storage errors
    }
  }
  return clean;
}

export function loadStoredCustomFonts(): Partial<Record<CustomFontSlot, CustomFontRecord>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CUSTOM_FONTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    const clean: Partial<Record<CustomFontSlot, CustomFontRecord>> = {};
    (['arabic', 'english'] as const).forEach((slot) => {
      const candidate = record[slot];
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return;
      const c = candidate as Partial<CustomFontRecord>;
      if (
        typeof c.family === 'string' &&
        c.family.trim() &&
        typeof c.sourceUrl === 'string' &&
        c.sourceUrl.trim() &&
        typeof c.format === 'string'
      ) {
        clean[slot] = {
          id: slot,
          family: c.family,
          fileName: typeof c.fileName === 'string' ? c.fileName : 'custom-font',
          format: c.format as CustomFontFormat,
          sourceUrl: c.sourceUrl,
        };
      }
    });
    return clean;
  } catch {
    return {};
  }
}

export function saveStoredCustomFonts(
  fonts: Partial<Record<CustomFontSlot, CustomFontRecord>>
): Partial<Record<CustomFontSlot, CustomFontRecord>> {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(CUSTOM_FONTS_STORAGE_KEY, JSON.stringify(fonts));
    } catch {
      // Ignore quota errors
    }
  }
  return fonts;
}

export function detectFontFormat(fileNameOrUrl: string): CustomFontFormat | null {
  const lower = fileNameOrUrl.toLowerCase().split('?')[0].split('#')[0];
  if (lower.endsWith('.woff2')) return 'woff2';
  if (lower.endsWith('.woff')) return 'woff';
  if (lower.endsWith('.ttf')) return 'truetype';
  if (lower.endsWith('.otf')) return 'opentype';
  if (lower.includes('fonts.googleapis.com') || lower.endsWith('.css')) return 'css';
  return null;
}

export async function readFontFileAsCustomFont(
  file: File,
  slot: CustomFontSlot
): Promise<CustomFontRecord> {
  const format = detectFontFormat(file.name);
  if (!format || format === 'css') {
    throw new Error('صيغة الخط غير مدعومة. الصيغ المدعومة: .woff2 أو .woff أو .ttf أو .otf');
  }
  if (file.size > MAX_CUSTOM_FONT_FILE_BYTES) {
    const sizeKb = Math.round(file.size / 1024);
    throw new Error(
      `حجم ملف الخط (${sizeKb} KB) أكبر من الحد المسموح (680 KB). يُنصح بضغطه بصيغة .woff2 أو استخدام رابط مباشر.`
    );
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الخط من الجهاز'));
    reader.readAsDataURL(file);
  });

  if (!dataUrl || dataUrl.length > 940000) {
    throw new Error('ملف الخط كبير جداً للحفظ السحابي. استخدم ملف .woff2 أصغر حجماً أو رابط مباشر.');
  }

  const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_\- ]/g, '').trim();
  const family =
    slot === 'arabic'
      ? `RahaLCustomArabic_${baseName || 'Font'}`.slice(0, 60)
      : `RahaLCustomEnglish_${baseName || 'Font'}`.slice(0, 60);

  return {
    id: slot,
    family,
    fileName: file.name.slice(0, 140),
    format,
    sourceUrl: dataUrl,
  };
}

export function applyTypographyToDocument(
  rawConfig?: Partial<TypographyConfig> | null,
  customFonts: Partial<Record<CustomFontSlot, CustomFontRecord>> = {}
) {
  if (typeof document === 'undefined') return;
  const cfg = normalizeTypographyConfig(rawConfig);
  const root = document.documentElement;

  // 1. Ensure Google Fonts stylesheet for selected non-custom presets
  const specsToLoad = new Set<string>();
  const arPreset = ARABIC_FONT_PRESETS.find((p) => p.id === cfg.arabicFont);
  const enPreset = ENGLISH_FONT_PRESETS.find((p) => p.id === cfg.englishFont);
  if (arPreset?.googleSpec && arPreset.id !== 'Cairo' && arPreset.id !== 'Tajawal') {
    specsToLoad.add(arPreset.googleSpec);
  }
  if (enPreset?.googleSpec && enPreset.id !== 'Cairo' && enPreset.id !== 'Tajawal') {
    specsToLoad.add(enPreset.googleSpec);
  }

  const googleLinkId = 'rahaltv-dynamic-google-fonts';
  let googleLink = document.getElementById(googleLinkId) as HTMLLinkElement | null;
  if (specsToLoad.size > 0) {
    const href = `https://fonts.googleapis.com/css2?${Array.from(specsToLoad)
      .map((s) => `family=${s}`)
      .join('&')}&display=swap`;
    if (!googleLink) {
      googleLink = document.createElement('link');
      googleLink.id = googleLinkId;
      googleLink.rel = 'stylesheet';
      document.head.appendChild(googleLink);
    }
    if (googleLink.href !== href) {
      googleLink.href = href;
    }
  } else if (googleLink) {
    googleLink.remove();
  }

  // 2. Inject @font-face or external CSS for uploaded Arabic & English custom fonts
  const customStyleId = 'rahaltv-custom-fonts-style';
  let customStyleEl = document.getElementById(customStyleId) as HTMLStyleElement | null;
  const customCssParts: string[] = [];

  const arCustom = customFonts.arabic;
  const enCustom = customFonts.english;

  const customLinkArId = 'rahaltv-custom-font-css-arabic';
  const customLinkEnId = 'rahaltv-custom-font-css-english';

  const syncExternalCssLink = (id: string, font?: CustomFontRecord) => {
    let el = document.getElementById(id) as HTMLLinkElement | null;
    if (
      font &&
      font.format === 'css' &&
      typeof font.sourceUrl === 'string' &&
      /^https?:\/\//i.test(font.sourceUrl)
    ) {
      if (!el) {
        el = document.createElement('link');
        el.id = id;
        el.rel = 'stylesheet';
        document.head.appendChild(el);
      }
      if (el.href !== font.sourceUrl) el.href = font.sourceUrl;
    } else if (el) {
      el.remove();
    }
  };

  syncExternalCssLink(customLinkArId, arCustom);
  syncExternalCssLink(customLinkEnId, enCustom);

  if (
    arCustom &&
    arCustom.format !== 'css' &&
    typeof arCustom.sourceUrl === 'string' &&
    arCustom.sourceUrl &&
    typeof arCustom.family === 'string'
  ) {
    const safeUrl = arCustom.sourceUrl.replace(/"/g, '\\"');
    customCssParts.push(`
@font-face {
  font-family: "${arCustom.family}";
  src: url("${safeUrl}") format("${arCustom.format}");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
  unicode-range: U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF, U+0020;
}`);
  }

  if (
    enCustom &&
    enCustom.format !== 'css' &&
    typeof enCustom.sourceUrl === 'string' &&
    enCustom.sourceUrl &&
    typeof enCustom.family === 'string'
  ) {
    const safeUrl = enCustom.sourceUrl.replace(/"/g, '\\"');
    customCssParts.push(`
@font-face {
  font-family: "${enCustom.family}";
  src: url("${safeUrl}") format("${enCustom.format}");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
  unicode-range: U+0000-00FF, U+0100-024F, U+2000-206F;
}`);
  }

  if (customCssParts.length > 0) {
    if (!customStyleEl) {
      customStyleEl = document.createElement('style');
      customStyleEl.id = customStyleId;
      document.head.appendChild(customStyleEl);
    }
    customStyleEl.textContent = customCssParts.join('\n');
  } else if (customStyleEl) {
    customStyleEl.remove();
  }

  // 3. Compose effective font stacks
  const activeArabicFamily =
    cfg.arabicFont === 'custom' && arCustom?.family
      ? `"${arCustom.family}"`
      : `"${arPreset?.cssFamily || 'Tajawal'}"`;

  const activeEnglishFamily =
    cfg.englishFont === 'custom' && enCustom?.family
      ? `"${enCustom.family}"`
      : `"${enPreset?.cssFamily || 'Cairo'}"`;

  // Put English font before Arabic when English preset is Latin-only or custom English (with Latin unicode-range)
  const englishHasArabicGlyphs = cfg.englishFont === 'Cairo';

  const combinedSansStack = englishHasArabicGlyphs
    ? `${activeArabicFamily}, ${activeEnglishFamily}, "Tajawal", "Cairo", system-ui, sans-serif`
    : `${activeEnglishFamily}, ${activeArabicFamily}, "Tajawal", "Cairo", system-ui, sans-serif`;

  const combinedDisplayStack = englishHasArabicGlyphs
    ? `${activeArabicFamily}, ${activeEnglishFamily}, "Cairo", "Tajawal", system-ui, sans-serif`
    : `${activeEnglishFamily}, ${activeArabicFamily}, "Cairo", "Tajawal", system-ui, sans-serif`;

  const latinStack = `${activeEnglishFamily}, "Cairo", system-ui, sans-serif`;

  root.style.setProperty('--font-sans', combinedSansStack);
  root.style.setProperty('--font-display', combinedDisplayStack);
  root.style.setProperty('--font-latin', latinStack);

  // 4. Apply Font Sizes
  root.style.fontSize = `${cfg.baseFontSizePx}px`;
  root.style.setProperty('--rtv-base-font-size', `${cfg.baseFontSizePx}px`);
  root.style.setProperty('--rtv-hero-title-size', `${cfg.heroTitleSizePx}px`);
  root.style.setProperty('--rtv-detail-title-size', `${cfg.detailTitleSizePx}px`);
  root.style.setProperty('--rtv-card-title-size', `${cfg.cardTitleSizePx}px`);
  root.style.setProperty('--rtv-section-title-size', `${cfg.sectionTitleSizePx}px`);
}
