import { CSSProperties } from 'react';
import { PlayerThemeConfig, PlayerThemePresetId } from '../types/media';

export const PLAYER_THEME_STORAGE_KEY = 'rahaltv_player_theme_v1';

export const DEFAULT_PLAYER_THEME: PlayerThemeConfig = {
  presetId: 'rahaltv-crimson',
  brandLabel: 'RahaL TV',
  accentColor: '#D92321',
  frameBgColor: '#111822',
  modalBgColor: '#091119',
  borderRadius: 'rounded',
  glowIntensity: 'soft',
  showHeaderBar: true,
  showFooterBar: true,
  showBrandBadge: true,
};

export const PLAYER_THEME_PRESETS: {
  id: Exclude<PlayerThemePresetId, 'custom'>;
  name: string;
  subtitle: string;
  theme: PlayerThemeConfig;
}[] = [
  {
    id: 'rahaltv-crimson',
    name: 'RahaL الأحمر السينمائي',
    subtitle: 'رمادي داكن متوازن مع لمسات حمراء أنيقة',
    theme: {
      ...DEFAULT_PLAYER_THEME,
      presetId: 'rahaltv-crimson',
      accentColor: '#D92321',
      frameBgColor: '#111822',
      modalBgColor: '#091119',
    },
  },
  {
    id: 'cinema-gold',
    name: 'السينما الملكي الذهبي',
    subtitle: 'أسود فحمي فاخر مع ذهبي دافئ',
    theme: {
      ...DEFAULT_PLAYER_THEME,
      presetId: 'cinema-gold',
      accentColor: '#eab308',
      frameBgColor: '#141418',
      modalBgColor: '#0a0a0d',
    },
  },
  {
    id: 'midnight-blue',
    name: 'الأزرق الليلي العميق',
    subtitle: 'أزرق داكن هادئ وإضاءة سماوية مريحة للعين',
    theme: {
      ...DEFAULT_PLAYER_THEME,
      presetId: 'midnight-blue',
      accentColor: '#3b82f6',
      frameBgColor: '#0f1829',
      modalBgColor: '#070d18',
    },
  },
  {
    id: 'emerald-neon',
    name: 'الزمردي الحديث',
    subtitle: 'تباين داكن ناعم مع أخضر زمردي مشرق',
    theme: {
      ...DEFAULT_PLAYER_THEME,
      presetId: 'emerald-neon',
      accentColor: '#10b981',
      frameBgColor: '#0f1b19',
      modalBgColor: '#070f0e',
    },
  },
];

function sanitizeHexColor(val: unknown, fallback: string): string {
  const s = typeof val === 'string' ? val.trim() : '';
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : fallback.toLowerCase();
}

export function normalizePlayerTheme(raw?: Partial<PlayerThemeConfig> | null): PlayerThemeConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PLAYER_THEME };

  const validPresets: PlayerThemePresetId[] = [
    'rahaltv-crimson',
    'cinema-gold',
    'midnight-blue',
    'emerald-neon',
    'custom',
  ];
  const presetId = validPresets.includes(raw.presetId as PlayerThemePresetId)
    ? (raw.presetId as PlayerThemePresetId)
    : 'custom';

  const brandLabel =
    typeof raw.brandLabel === 'string' && raw.brandLabel.trim().length > 0
      ? raw.brandLabel.trim().slice(0, 40)
      : DEFAULT_PLAYER_THEME.brandLabel;

  const borderRadius =
    raw.borderRadius === 'sharp' || raw.borderRadius === 'rounded' || raw.borderRadius === 'cinema'
      ? raw.borderRadius
      : DEFAULT_PLAYER_THEME.borderRadius;

  const glowIntensity =
    raw.glowIntensity === 'none' || raw.glowIntensity === 'soft' || raw.glowIntensity === 'strong'
      ? raw.glowIntensity
      : DEFAULT_PLAYER_THEME.glowIntensity;

  return {
    presetId,
    brandLabel,
    accentColor: sanitizeHexColor(raw.accentColor, DEFAULT_PLAYER_THEME.accentColor),
    frameBgColor: sanitizeHexColor(raw.frameBgColor, DEFAULT_PLAYER_THEME.frameBgColor),
    modalBgColor: sanitizeHexColor(raw.modalBgColor, DEFAULT_PLAYER_THEME.modalBgColor),
    borderRadius,
    glowIntensity,
    showHeaderBar: raw.showHeaderBar ?? true,
    showFooterBar: raw.showFooterBar ?? true,
    showBrandBadge: raw.showBrandBadge ?? true,
  };
}

export function loadStoredPlayerTheme(): PlayerThemeConfig {
  if (typeof window === 'undefined') return { ...DEFAULT_PLAYER_THEME };
  try {
    const raw = localStorage.getItem(PLAYER_THEME_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PLAYER_THEME };
    return normalizePlayerTheme(JSON.parse(raw) as Partial<PlayerThemeConfig>);
  } catch {
    return { ...DEFAULT_PLAYER_THEME };
  }
}

export function saveStoredPlayerTheme(theme: PlayerThemeConfig): PlayerThemeConfig {
  const clean = normalizePlayerTheme(theme);
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(PLAYER_THEME_STORAGE_KEY, JSON.stringify(clean));
    } catch {
      // Ignore storage errors
    }
  }
  return clean;
}

export function getContrastTextHex(hex: string): string {
  const clean = sanitizeHexColor(hex, '#d92321').slice(1);
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#081018' : '#ffffff';
}

export function hexWithAlpha(hex: string, alpha: number): string {
  const clean = sanitizeHexColor(hex, '#d92321').slice(1);
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function getPlayerRadiusPx(radius: PlayerThemeConfig['borderRadius']): string {
  if (radius === 'sharp') return '8px';
  if (radius === 'cinema') return '22px';
  return '16px';
}

export function getPlayerBoxShadow(
  accentColor: string,
  glow: PlayerThemeConfig['glowIntensity']
): string {
  if (glow === 'none') {
    return '0 20px 45px -16px rgba(0, 0, 0, 0.85)';
  }
  if (glow === 'strong') {
    return `0 22px 55px -14px rgba(0, 0, 0, 0.9), 0 0 42px -8px ${hexWithAlpha(accentColor, 0.42)}`;
  }
  return `0 20px 48px -15px rgba(0, 0, 0, 0.88), 0 0 28px -12px ${hexWithAlpha(accentColor, 0.28)}`;
}

export function buildPlayerThemeVars(theme?: Partial<PlayerThemeConfig> | null): CSSProperties {
  const t = normalizePlayerTheme(theme);
  return {
    '--pt-accent': t.accentColor,
    '--pt-accent-contrast': getContrastTextHex(t.accentColor),
    '--pt-accent-12': hexWithAlpha(t.accentColor, 0.12),
    '--pt-accent-20': hexWithAlpha(t.accentColor, 0.2),
    '--pt-accent-35': hexWithAlpha(t.accentColor, 0.35),
    '--pt-accent-55': hexWithAlpha(t.accentColor, 0.55),
    '--pt-frame': t.frameBgColor,
    '--pt-modal': t.modalBgColor,
    '--pt-radius': getPlayerRadiusPx(t.borderRadius),
    '--pt-shadow': getPlayerBoxShadow(t.accentColor, t.glowIntensity),
  } as CSSProperties;
}
