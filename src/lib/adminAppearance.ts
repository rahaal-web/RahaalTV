import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { CustomFontFormat, CustomFontRecord } from '../types/media';
import { getActiveDb } from './dbConnectionManager';
import { detectFontFormat, MAX_CUSTOM_FONT_FILE_BYTES } from './typographyConfig';

export const ADMIN_APPEARANCE_STORAGE_KEY = 'rahaltv_admin_appearance_v1';

export type AdminFontWeight = 300 | 400 | 500 | 600 | 700;
export type AdminTableDensity = 'compact' | 'normal' | 'comfortable';
export type AdminColorMode = 'dark' | 'light';

export interface AdminFontPreset {
  id: string;
  label: string;
  cssFamily: string;
  googleSpec?: string;
}

export const ADMIN_ARABIC_FONT_PRESETS: AdminFontPreset[] = [
  {
    id: 'Tajawal',
    label: 'تجوال (Tajawal — الافتراضي المتوازن)',
    cssFamily: 'Tajawal',
    googleSpec: 'Tajawal:wght@300;400;500;700;800',
  },
  {
    id: 'Cairo',
    label: 'كايرو (Cairo — واضح للوحة التحكم)',
    cssFamily: 'Cairo',
    googleSpec: 'Cairo:wght@300;400;500;600;700;800',
  },
  {
    id: 'IBM Plex Sans Arabic',
    label: 'IBM Plex Sans Arabic (احترافي للبيانات)',
    cssFamily: 'IBM Plex Sans Arabic',
    googleSpec: 'IBM+Plex+Sans+Arabic:wght@300;400;500;600;700',
  },
  {
    id: 'Readex Pro',
    label: 'Readex Pro (حديث ودقيق)',
    cssFamily: 'Readex Pro',
    googleSpec: 'Readex+Pro:wght@300;400;500;600;700',
  },
  {
    id: 'Almarai',
    label: 'المراعي (Almarai — هندسي واضح)',
    cssFamily: 'Almarai',
    googleSpec: 'Almarai:wght@300;400;700;800',
  },
  {
    id: 'Noto Kufi Arabic',
    label: 'Noto Kufi Arabic (كوفي رسمي)',
    cssFamily: 'Noto Kufi Arabic',
    googleSpec: 'Noto+Kufi+Arabic:wght@300;400;500;600;700',
  },
  {
    id: 'Alexandria',
    label: 'الإسكندرية (Alexandria)',
    cssFamily: 'Alexandria',
    googleSpec: 'Alexandria:wght@300;400;500;600;700',
  },
  {
    id: 'Rubik',
    label: 'روبيك (Rubik — ناعم ومضغوط)',
    cssFamily: 'Rubik',
    googleSpec: 'Rubik:wght@300;400;500;600;700',
  },
  {
    id: 'Changa',
    label: 'تشانجا (Changa — عريض)',
    cssFamily: 'Changa',
    googleSpec: 'Changa:wght@300;400;500;600;700',
  },
  {
    id: 'system-ui',
    label: 'خط النظام الافتراضي (System UI)',
    cssFamily: 'system-ui',
  },
];

export interface AdminAppearanceConfig {
  fontFamily: string;
  customFont: CustomFontRecord | null;
  fontWeight: AdminFontWeight;
  headingMainPx: number;
  headingSectionPx: number;
  bodyTextPx: number;
  secondaryTextPx: number;
  buttonTextPx: number;
  sidebarItemPx: number;
  tableTextPx: number;
  inputTextPx: number;
  sidebarWidthPx: number;
  iconSizePx: number;
  navItemSpacingPx: number;
  buttonHeightPx: number;
  tableDensity: AdminTableDensity;
  borderRadiusPx: number;
  cardPaddingPx: number;
  cardTitlePx: number;
  colorMode: AdminColorMode;
}

export const DEFAULT_ADMIN_APPEARANCE: AdminAppearanceConfig = {
  fontFamily: 'Tajawal',
  customFont: null,
  fontWeight: 500,
  headingMainPx: 20,
  headingSectionPx: 16,
  bodyTextPx: 13,
  secondaryTextPx: 11,
  buttonTextPx: 12,
  sidebarItemPx: 12,
  tableTextPx: 12,
  inputTextPx: 13,
  sidebarWidthPx: 288,
  iconSizePx: 16,
  navItemSpacingPx: 4,
  buttonHeightPx: 38,
  tableDensity: 'normal',
  borderRadiusPx: 16,
  cardPaddingPx: 24,
  cardTitlePx: 15,
  colorMode: 'dark',
};

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function normalizeCustomFont(raw: unknown): CustomFontRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Partial<CustomFontRecord>;
  if (
    typeof c.family !== 'string' ||
    !c.family.trim() ||
    typeof c.sourceUrl !== 'string' ||
    !c.sourceUrl.trim() ||
    typeof c.format !== 'string'
  ) {
    return null;
  }
  const allowedFormats: CustomFontFormat[] = ['woff2', 'woff', 'truetype', 'opentype', 'css'];
  const fmt = allowedFormats.includes(c.format as CustomFontFormat)
    ? (c.format as CustomFontFormat)
    : 'woff2';
  return {
    id: 'arabic',
    family: c.family.trim().slice(0, 80),
    fileName:
      typeof c.fileName === 'string' && c.fileName.trim()
        ? c.fileName.trim().slice(0, 140)
        : 'admin-custom-font',
    format: fmt,
    sourceUrl: c.sourceUrl.trim().slice(0, 950000),
  };
}

export function normalizeAdminAppearance(
  raw?: Partial<AdminAppearanceConfig> | null
): AdminAppearanceConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_ADMIN_APPEARANCE };
  }

  const validIds = new Set([...ADMIN_ARABIC_FONT_PRESETS.map((p) => p.id), 'custom']);
  const customFont = normalizeCustomFont(raw.customFont);
  let fontFamily =
    typeof raw.fontFamily === 'string' && validIds.has(raw.fontFamily.trim())
      ? raw.fontFamily.trim()
      : DEFAULT_ADMIN_APPEARANCE.fontFamily;
  if (fontFamily === 'custom' && !customFont) {
    fontFamily = DEFAULT_ADMIN_APPEARANCE.fontFamily;
  }

  const validWeights: AdminFontWeight[] = [300, 400, 500, 600, 700];
  const rawWeight = Number(raw.fontWeight) as AdminFontWeight;
  const fontWeight: AdminFontWeight = validWeights.includes(rawWeight)
    ? rawWeight
    : DEFAULT_ADMIN_APPEARANCE.fontWeight;

  const tableDensity: AdminTableDensity =
    raw.tableDensity === 'compact' ||
    raw.tableDensity === 'comfortable' ||
    raw.tableDensity === 'normal'
      ? raw.tableDensity
      : DEFAULT_ADMIN_APPEARANCE.tableDensity;

  const colorMode: AdminColorMode =
    raw.colorMode === 'light' || raw.colorMode === 'dark'
      ? raw.colorMode
      : DEFAULT_ADMIN_APPEARANCE.colorMode;

  return {
    fontFamily,
    customFont,
    fontWeight,
    headingMainPx: clampInt(raw.headingMainPx, 16, 32, DEFAULT_ADMIN_APPEARANCE.headingMainPx),
    headingSectionPx: clampInt(
      raw.headingSectionPx,
      14,
      24,
      DEFAULT_ADMIN_APPEARANCE.headingSectionPx
    ),
    bodyTextPx: clampInt(raw.bodyTextPx, 12, 18, DEFAULT_ADMIN_APPEARANCE.bodyTextPx),
    secondaryTextPx: clampInt(
      raw.secondaryTextPx,
      10,
      15,
      DEFAULT_ADMIN_APPEARANCE.secondaryTextPx
    ),
    buttonTextPx: clampInt(raw.buttonTextPx, 11, 16, DEFAULT_ADMIN_APPEARANCE.buttonTextPx),
    sidebarItemPx: clampInt(raw.sidebarItemPx, 11, 16, DEFAULT_ADMIN_APPEARANCE.sidebarItemPx),
    tableTextPx: clampInt(raw.tableTextPx, 11, 16, DEFAULT_ADMIN_APPEARANCE.tableTextPx),
    inputTextPx: clampInt(raw.inputTextPx, 11, 16, DEFAULT_ADMIN_APPEARANCE.inputTextPx),
    sidebarWidthPx: clampInt(raw.sidebarWidthPx, 240, 360, DEFAULT_ADMIN_APPEARANCE.sidebarWidthPx),
    iconSizePx: clampInt(raw.iconSizePx, 14, 24, DEFAULT_ADMIN_APPEARANCE.iconSizePx),
    navItemSpacingPx: clampInt(
      raw.navItemSpacingPx,
      2,
      12,
      DEFAULT_ADMIN_APPEARANCE.navItemSpacingPx
    ),
    buttonHeightPx: clampInt(raw.buttonHeightPx, 32, 48, DEFAULT_ADMIN_APPEARANCE.buttonHeightPx),
    tableDensity,
    borderRadiusPx: clampInt(raw.borderRadiusPx, 6, 28, DEFAULT_ADMIN_APPEARANCE.borderRadiusPx),
    cardPaddingPx: clampInt(raw.cardPaddingPx, 12, 32, DEFAULT_ADMIN_APPEARANCE.cardPaddingPx),
    cardTitlePx: clampInt(raw.cardTitlePx, 13, 22, DEFAULT_ADMIN_APPEARANCE.cardTitlePx),
    colorMode,
  };
}

const listeners = new Set<(cfg: AdminAppearanceConfig) => void>();

function notifyListeners(cfg: AdminAppearanceConfig) {
  listeners.forEach((cb) => {
    try {
      cb(cfg);
    } catch {
      // Ignore subscriber errors
    }
  });
}

export function subscribeAdminAppearance(
  cb: (cfg: AdminAppearanceConfig) => void
): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function loadAdminAppearance(): AdminAppearanceConfig {
  if (typeof window === 'undefined') return { ...DEFAULT_ADMIN_APPEARANCE };
  try {
    const raw = window.localStorage.getItem(ADMIN_APPEARANCE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ADMIN_APPEARANCE };
    return normalizeAdminAppearance(JSON.parse(raw) as Partial<AdminAppearanceConfig>);
  } catch {
    return { ...DEFAULT_ADMIN_APPEARANCE };
  }
}

export function saveAdminAppearance(
  rawConfig: Partial<AdminAppearanceConfig>
): AdminAppearanceConfig {
  const clean = normalizeAdminAppearance(rawConfig);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(ADMIN_APPEARANCE_STORAGE_KEY, JSON.stringify(clean));
    } catch {
      // Ignore storage quota errors
    }
  }
  notifyListeners(clean);
  return clean;
}

export function resetAdminAppearance(): AdminAppearanceConfig {
  return saveAdminAppearance({ ...DEFAULT_ADMIN_APPEARANCE });
}

export function resolveAdminFontStack(cfg: AdminAppearanceConfig): string {
  if (cfg.fontFamily === 'custom' && cfg.customFont?.family) {
    return `"${cfg.customFont.family}", "Tajawal", "Cairo", system-ui, sans-serif`;
  }
  if (cfg.fontFamily === 'system-ui') {
    return `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  }
  const preset = ADMIN_ARABIC_FONT_PRESETS.find((p) => p.id === cfg.fontFamily);
  const chosen = preset?.cssFamily || 'Tajawal';
  return `"${chosen}", "Tajawal", "Cairo", system-ui, sans-serif`;
}

export function ensureAdminFontResources(
  rawConfig: Partial<AdminAppearanceConfig>,
  target: 'active' | 'preview' = 'active'
): void {
  if (typeof document === 'undefined') return;
  const cfg = normalizeAdminAppearance(rawConfig);

  const googleLinkId =
    target === 'preview' ? 'rahaltv-admin-preview-google-fonts' : 'rahaltv-admin-google-fonts';
  const customStyleId =
    target === 'preview' ? 'rahaltv-admin-preview-custom-font' : 'rahaltv-admin-custom-font';
  const customCssLinkId =
    target === 'preview'
      ? 'rahaltv-admin-preview-custom-font-css'
      : 'rahaltv-admin-custom-font-css';

  // 1. Google Fonts Link (includes weights 300..700 so Light/Regular/Medium/SemiBold/Bold render cleanly)
  const preset = ADMIN_ARABIC_FONT_PRESETS.find((p) => p.id === cfg.fontFamily);
  let googleLink = document.getElementById(googleLinkId) as HTMLLinkElement | null;
  if (preset?.googleSpec) {
    const href = `https://fonts.googleapis.com/css2?family=${preset.googleSpec}&display=swap`;
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

  // 2. External CSS font link or @font-face
  let extCssEl = document.getElementById(customCssLinkId) as HTMLLinkElement | null;
  let customStyleEl = document.getElementById(customStyleId) as HTMLStyleElement | null;
  const cf = cfg.customFont;

  if (cfg.fontFamily === 'custom' && cf && cf.format === 'css' && /^https?:\/\//i.test(cf.sourceUrl)) {
    if (!extCssEl) {
      extCssEl = document.createElement('link');
      extCssEl.id = customCssLinkId;
      extCssEl.rel = 'stylesheet';
      document.head.appendChild(extCssEl);
    }
    if (extCssEl.href !== cf.sourceUrl) extCssEl.href = cf.sourceUrl;
    if (customStyleEl) customStyleEl.remove();
  } else {
    if (extCssEl) extCssEl.remove();
    if (cfg.fontFamily === 'custom' && cf && cf.format !== 'css' && cf.sourceUrl && cf.family) {
      const safeUrl = cf.sourceUrl.replace(/"/g, '\\"');
      const css = `
@font-face {
  font-family: "${cf.family}";
  src: url("${safeUrl}") format("${cf.format}");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}`;
      if (!customStyleEl) {
        customStyleEl = document.createElement('style');
        customStyleEl.id = customStyleId;
        document.head.appendChild(customStyleEl);
      }
      customStyleEl.textContent = css;
    } else if (customStyleEl) {
      customStyleEl.remove();
    }
  }
}

export function buildAdminAppearanceCssVars(
  rawConfig?: Partial<AdminAppearanceConfig> | null
): Record<string, string> {
  const cfg = normalizeAdminAppearance(rawConfig);
  const densityPads: Record<AdminTableDensity, { py: string; px: string }> = {
    compact: { py: '6px', px: '10px' },
    normal: { py: '10px', px: '14px' },
    comfortable: { py: '15px', px: '18px' },
  };
  const pads = densityPads[cfg.tableDensity];

  return {
    '--rtv-admin-font-family': resolveAdminFontStack(cfg),
    '--rtv-admin-font-weight': String(cfg.fontWeight),
    '--rtv-admin-h1-size': `${cfg.headingMainPx}px`,
    '--rtv-admin-h2-size': `${cfg.headingSectionPx}px`,
    '--rtv-admin-body-size': `${cfg.bodyTextPx}px`,
    '--rtv-admin-secondary-size': `${cfg.secondaryTextPx}px`,
    '--rtv-admin-button-size': `${cfg.buttonTextPx}px`,
    '--rtv-admin-sidebar-size': `${cfg.sidebarItemPx}px`,
    '--rtv-admin-table-size': `${cfg.tableTextPx}px`,
    '--rtv-admin-input-size': `${cfg.inputTextPx}px`,
    '--rtv-admin-sidebar-width': `${cfg.sidebarWidthPx}px`,
    '--rtv-admin-icon-size': `${cfg.iconSizePx}px`,
    '--rtv-admin-nav-spacing': `${cfg.navItemSpacingPx}px`,
    '--rtv-admin-button-height': `${cfg.buttonHeightPx}px`,
    '--rtv-admin-table-py': pads.py,
    '--rtv-admin-table-px': pads.px,
    '--rtv-admin-radius': `${cfg.borderRadiusPx}px`,
    '--rtv-admin-card-padding': `${cfg.cardPaddingPx}px`,
    '--rtv-admin-card-title-size': `${cfg.cardTitlePx}px`,
  };
}

export async function readAdminCustomFontFile(file: File): Promise<CustomFontRecord> {
  const format = detectFontFormat(file.name);
  if (!format || format === 'css') {
    throw new Error('صيغة الخط غير مدعومة. الصيغ المدعومة: .woff2 أو .woff أو .ttf أو .otf');
  }
  if (file.size > MAX_CUSTOM_FONT_FILE_BYTES) {
    const sizeKb = Math.round(file.size / 1024);
    throw new Error(
      `حجم ملف الخط (${sizeKb} KB) يتجاوز الحد الآمن (680 KB). استخدم .woff2 مضغوط أو رابط خط خارجي.`
    );
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الخط من الجهاز'));
    reader.readAsDataURL(file);
  });
  if (!dataUrl || dataUrl.length > 940000) {
    throw new Error('حجم الخط بعد الترميز أكبر من الحد المسموح.');
  }
  const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_\- ]/g, '').trim();
  return {
    id: 'arabic',
    family: `RahaLAdminFont_${baseName || 'Custom'}`.slice(0, 60),
    fileName: file.name.slice(0, 140),
    format,
    sourceUrl: dataUrl,
  };
}

export function buildAdminFontFromUrl(rawUrl: string): CustomFontRecord {
  const trimmed = rawUrl.trim();
  if (!/^https?:\/\/.+/i.test(trimmed)) {
    throw new Error('أدخل رابط خط صالح يبدأ بـ https://');
  }
  const detected = detectFontFormat(trimmed) || 'css';
  let extractedFamily = 'RahaLAdminCustomUrlFont';
  if (detected === 'css') {
    const famMatch = trimmed.match(/[?&]family=([^:&]+)/i);
    if (famMatch?.[1]) {
      extractedFamily =
        decodeURIComponent(famMatch[1].replace(/\+/g, ' ')).trim() || extractedFamily;
    }
  }
  return {
    id: 'arabic',
    family: extractedFamily.slice(0, 75),
    fileName: trimmed.split('/').pop()?.split('?')[0]?.slice(0, 80) || 'Admin Font URL',
    format: detected,
    sourceUrl: trimmed.slice(0, 2000),
  };
}

export async function syncAdminAppearanceToFirestore(
  config: AdminAppearanceConfig,
  uid: string
): Promise<boolean> {
  if (!uid) return false;
  try {
    const db = getActiveDb();
    const clean = normalizeAdminAppearance(config);
    await setDoc(doc(db, 'admin_workspace', 'appearance'), {
      kind: 'appearance',
      config: clean,
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch {
    return false;
  }
}

export function subscribeAdminAppearanceFromFirestore(
  enabled: boolean,
  onRemote: (cfg: AdminAppearanceConfig) => void
): () => void {
  if (!enabled) return () => {};
  try {
    const db = getActiveDb();
    return onSnapshot(
      doc(db, 'admin_workspace', 'appearance'),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as { config?: Partial<AdminAppearanceConfig> } | undefined;
        if (!data?.config) return;
        const normalized = saveAdminAppearance(data.config);
        onRemote(normalized);
      },
      () => {
        // Ignore permission/offline errors silently — localStorage keeps admin functional
      }
    );
  } catch {
    return () => {};
  }
}
