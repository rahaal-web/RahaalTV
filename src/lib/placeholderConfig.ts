import type {
  ImagePlaceholderConfig,
  ImagePlaceholderMode,
  ImagePlaceholderSlotKey,
  ImagePlaceholderSlotOverride,
  ImageSlotType,
} from '../types/media';
import { resolveUploadedImageAssetUrl } from './imageCompressor';

export const IMAGE_PLACEHOLDER_STORAGE_KEY = 'rahaltv_image_placeholders_v1';

const VALID_MODES: ImagePlaceholderMode[] = [
  'solid',
  'gradient',
  'shimmer',
  'logo_badge',
  'custom_image',
];

const VALID_SHIMMER_SPEEDS = ['slow', 'normal', 'fast'] as const;

export const PLACEHOLDER_GRADIENT_PRESETS: Array<{
  id: string;
  label: string;
  primaryColor: string;
  secondaryColor: string;
  gradientAngle: number;
}> = [
  {
    id: 'cinema_abyss',
    label: 'أزرق سينمائي داكن (الافتراضي)',
    primaryColor: '#0c1821',
    secondaryColor: '#1a2836',
    gradientAngle: 145,
  },
  {
    id: 'crimson_obsidian',
    label: 'أوبسيديان وأحمر RahaL',
    primaryColor: '#0f0f14',
    secondaryColor: '#3a0e13',
    gradientAngle: 135,
  },
  {
    id: 'slate_graphite',
    label: 'رمادي جرافيتي هادئ',
    primaryColor: '#14181f',
    secondaryColor: '#252c37',
    gradientAngle: 160,
  },
  {
    id: 'midnight_emerald',
    label: 'ليلي زمردي',
    primaryColor: '#081818',
    secondaryColor: '#123136',
    gradientAngle: 135,
  },
  {
    id: 'royal_indigo',
    label: 'نيلي عميق',
    primaryColor: '#0b1024',
    secondaryColor: '#1d264a',
    gradientAngle: 145,
  },
];

function createDefaultSlotOverride(): ImagePlaceholderSlotOverride {
  return {
    enabled: false,
    mode: 'gradient',
    primaryColor: '#0c1821',
    secondaryColor: '#1a2836',
    gradientAngle: 145,
    customImageUrl: '',
    errorFallbackImageUrl: '',
    dimOpacityPct: 25,
    showLogoOverlay: true,
    showFallbackIcon: true,
  };
}

export const DEFAULT_IMAGE_PLACEHOLDER_CONFIG: ImagePlaceholderConfig = {
  mode: 'shimmer',
  primaryColor: '#0c1821',
  secondaryColor: '#1a2836',
  gradientAngle: 145,
  shimmerEnabled: true,
  shimmerSpeed: 'normal',
  showLogoOverlay: true,
  logoOverlayOpacityPct: 28,
  customImageUrl: '',
  errorFallbackImageUrl: '',
  backdropDimPct: 24,
  showFallbackIcon: true,
  fadeInDurationMs: 260,
  slotOverrides: {
    poster: createDefaultSlotOverride(),
    backdrop: createDefaultSlotOverride(),
    cast: createDefaultSlotOverride(),
    episode: createDefaultSlotOverride(),
  },
};

function normalizeHex(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed.split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function normalizeImageAssetRef(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > 600 && !trimmed.startsWith('local-image://')) return '';
  if (/^(https?:\/\/|\/uploads\/|\/|local-image:\/\/)/i.test(trimmed)) {
    return trimmed.slice(0, 600);
  }
  return '';
}

function normalizeSlotOverride(
  raw?: Partial<ImagePlaceholderSlotOverride> | null
): ImagePlaceholderSlotOverride {
  const def = createDefaultSlotOverride();
  if (!raw || typeof raw !== 'object') return def;
  const mode = VALID_MODES.includes(raw.mode as ImagePlaceholderMode)
    ? (raw.mode as ImagePlaceholderMode)
    : def.mode;
  return {
    enabled: Boolean(raw.enabled),
    mode,
    primaryColor: normalizeHex(raw.primaryColor, def.primaryColor),
    secondaryColor: normalizeHex(raw.secondaryColor, def.secondaryColor),
    gradientAngle: clampInt(raw.gradientAngle, 0, 360, def.gradientAngle),
    customImageUrl: normalizeImageAssetRef(raw.customImageUrl),
    errorFallbackImageUrl: normalizeImageAssetRef(raw.errorFallbackImageUrl),
    dimOpacityPct: clampInt(raw.dimOpacityPct, 0, 85, def.dimOpacityPct),
    showLogoOverlay: raw.showLogoOverlay !== false,
    showFallbackIcon: raw.showFallbackIcon !== false,
  };
}

export function normalizeImagePlaceholderConfig(
  raw?: Partial<ImagePlaceholderConfig> | null
): ImagePlaceholderConfig {
  const def = DEFAULT_IMAGE_PLACEHOLDER_CONFIG;
  if (!raw || typeof raw !== 'object') {
    return {
      ...def,
      slotOverrides: {
        poster: createDefaultSlotOverride(),
        backdrop: createDefaultSlotOverride(),
        cast: createDefaultSlotOverride(),
        episode: createDefaultSlotOverride(),
      },
    };
  }

  const mode = VALID_MODES.includes(raw.mode as ImagePlaceholderMode)
    ? (raw.mode as ImagePlaceholderMode)
    : def.mode;
  const shimmerSpeed = (VALID_SHIMMER_SPEEDS as readonly string[]).includes(
    String(raw.shimmerSpeed)
  )
    ? (raw.shimmerSpeed as ImagePlaceholderConfig['shimmerSpeed'])
    : def.shimmerSpeed;

  const rawSlots = raw.slotOverrides || ({} as Partial<Record<ImagePlaceholderSlotKey, ImagePlaceholderSlotOverride>>);

  return {
    mode,
    primaryColor: normalizeHex(raw.primaryColor, def.primaryColor),
    secondaryColor: normalizeHex(raw.secondaryColor, def.secondaryColor),
    gradientAngle: clampInt(raw.gradientAngle, 0, 360, def.gradientAngle),
    shimmerEnabled: raw.shimmerEnabled !== false,
    shimmerSpeed,
    showLogoOverlay: raw.showLogoOverlay !== false,
    logoOverlayOpacityPct: clampInt(raw.logoOverlayOpacityPct, 5, 90, def.logoOverlayOpacityPct),
    customImageUrl: normalizeImageAssetRef(raw.customImageUrl),
    errorFallbackImageUrl: normalizeImageAssetRef(raw.errorFallbackImageUrl),
    backdropDimPct: clampInt(raw.backdropDimPct, 0, 85, def.backdropDimPct),
    showFallbackIcon: raw.showFallbackIcon !== false,
    fadeInDurationMs: clampInt(raw.fadeInDurationMs, 0, 600, def.fadeInDurationMs),
    slotOverrides: {
      poster: normalizeSlotOverride(rawSlots.poster),
      backdrop: normalizeSlotOverride(rawSlots.backdrop),
      cast: normalizeSlotOverride(rawSlots.cast),
      episode: normalizeSlotOverride(rawSlots.episode),
    },
  };
}

export function mapImageSlotToOverrideKey(slot?: ImageSlotType): ImagePlaceholderSlotKey {
  if (!slot) return 'poster';
  if (slot === 'slider_backdrop' || slot === 'backdrop_card' || slot === 'backdrop_detail') {
    return 'backdrop';
  }
  if (slot === 'cast_avatar') return 'cast';
  if (slot === 'episode_thumb') return 'episode';
  return 'poster';
}

export interface EffectivePlaceholderAppearance {
  mode: ImagePlaceholderMode;
  primaryColor: string;
  secondaryColor: string;
  gradientAngle: number;
  shimmerEnabled: boolean;
  shimmerDurationSec: string;
  showLogoOverlay: boolean;
  logoOverlayOpacity: number;
  customImageUrl: string;
  errorFallbackImageUrl: string;
  dimOpacity: number;
  showFallbackIcon: boolean;
  fadeInDurationMs: number;
}

export function resolveEffectivePlaceholderForSlot(
  config: ImagePlaceholderConfig,
  slot?: ImageSlotType
): EffectivePlaceholderAppearance {
  const key = mapImageSlotToOverrideKey(slot);
  const ov = config.slotOverrides?.[key];
  const useOv = Boolean(ov && ov.enabled);

  const mode = useOv ? ov!.mode : config.mode;
  const primaryColor = useOv ? ov!.primaryColor : config.primaryColor;
  const secondaryColor = useOv ? ov!.secondaryColor : config.secondaryColor;
  const gradientAngle = useOv ? ov!.gradientAngle : config.gradientAngle;
  const customImageUrl = resolveUploadedImageAssetUrl(
    useOv && ov!.customImageUrl ? ov!.customImageUrl : config.customImageUrl
  );
  const errorFallbackImageUrl = resolveUploadedImageAssetUrl(
    useOv && ov!.errorFallbackImageUrl ? ov!.errorFallbackImageUrl : config.errorFallbackImageUrl
  );
  const dimOpacity = (useOv ? ov!.dimOpacityPct : config.backdropDimPct) / 100;
  const showLogoOverlay =
    mode === 'logo_badge' ? true : useOv ? ov!.showLogoOverlay : config.showLogoOverlay;
  const showFallbackIcon = useOv ? ov!.showFallbackIcon : config.showFallbackIcon;

  const shimmerDurationSec =
    config.shimmerSpeed === 'slow' ? '2.4s' : config.shimmerSpeed === 'fast' ? '1.05s' : '1.6s';

  return {
    mode,
    primaryColor,
    secondaryColor,
    gradientAngle,
    shimmerEnabled: (config.shimmerEnabled || mode === 'shimmer') && mode !== 'solid',
    shimmerDurationSec,
    showLogoOverlay,
    logoOverlayOpacity: Math.min(0.95, Math.max(0.05, config.logoOverlayOpacityPct / 100)),
    customImageUrl,
    errorFallbackImageUrl,
    dimOpacity: Math.min(0.85, Math.max(0, dimOpacity)),
    showFallbackIcon,
    fadeInDurationMs: config.fadeInDurationMs,
  };
}

export function buildPlaceholderSurfaceBackground(appearance: EffectivePlaceholderAppearance): string {
  if (appearance.mode === 'solid') {
    return appearance.primaryColor;
  }
  return `linear-gradient(${appearance.gradientAngle}deg, ${appearance.primaryColor} 0%, ${appearance.secondaryColor} 100%)`;
}

export function sanitizePlaceholderConfigForFirestore(
  cfg: ImagePlaceholderConfig
): ImagePlaceholderConfig {
  const cleanRef = (val: string) =>
    val.startsWith('local-image://') || val.startsWith('data:image/') ? '' : val.slice(0, 600);

  return {
    ...cfg,
    customImageUrl: cleanRef(cfg.customImageUrl),
    errorFallbackImageUrl: cleanRef(cfg.errorFallbackImageUrl),
    slotOverrides: {
      poster: {
        ...cfg.slotOverrides.poster,
        customImageUrl: cleanRef(cfg.slotOverrides.poster.customImageUrl),
        errorFallbackImageUrl: cleanRef(cfg.slotOverrides.poster.errorFallbackImageUrl),
      },
      backdrop: {
        ...cfg.slotOverrides.backdrop,
        customImageUrl: cleanRef(cfg.slotOverrides.backdrop.customImageUrl),
        errorFallbackImageUrl: cleanRef(cfg.slotOverrides.backdrop.errorFallbackImageUrl),
      },
      cast: {
        ...cfg.slotOverrides.cast,
        customImageUrl: cleanRef(cfg.slotOverrides.cast.customImageUrl),
        errorFallbackImageUrl: cleanRef(cfg.slotOverrides.cast.errorFallbackImageUrl),
      },
      episode: {
        ...cfg.slotOverrides.episode,
        customImageUrl: cleanRef(cfg.slotOverrides.episode.customImageUrl),
        errorFallbackImageUrl: cleanRef(cfg.slotOverrides.episode.errorFallbackImageUrl),
      },
    },
  };
}

/* ---------------- Pub/Sub Reactive Store for OptimizedImage Components ---------------- */
let activeStoredConfig: ImagePlaceholderConfig | null = null;
let activePreviewConfig: ImagePlaceholderConfig | null = null;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Ignore subscriber errors
    }
  });
}

export function loadStoredPlaceholderConfig(): ImagePlaceholderConfig {
  if (typeof window === 'undefined') {
    return normalizeImagePlaceholderConfig(DEFAULT_IMAGE_PLACEHOLDER_CONFIG);
  }
  try {
    const raw = window.localStorage.getItem(IMAGE_PLACEHOLDER_STORAGE_KEY);
    if (!raw) return normalizeImagePlaceholderConfig(DEFAULT_IMAGE_PLACEHOLDER_CONFIG);
    return normalizeImagePlaceholderConfig(JSON.parse(raw) as Partial<ImagePlaceholderConfig>);
  } catch {
    return normalizeImagePlaceholderConfig(DEFAULT_IMAGE_PLACEHOLDER_CONFIG);
  }
}

export function saveStoredPlaceholderConfig(
  cfg: Partial<ImagePlaceholderConfig>
): ImagePlaceholderConfig {
  const normalized = normalizeImagePlaceholderConfig(cfg);
  activeStoredConfig = normalized;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(IMAGE_PLACEHOLDER_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Ignore storage quota errors
    }
  }
  notifyListeners();
  return normalized;
}

export function getPlaceholderConfig(): ImagePlaceholderConfig {
  if (activePreviewConfig) return activePreviewConfig;
  if (!activeStoredConfig) {
    activeStoredConfig = loadStoredPlaceholderConfig();
  }
  return activeStoredConfig;
}

export function setPreviewPlaceholderConfig(cfg: Partial<ImagePlaceholderConfig> | null): void {
  activePreviewConfig = cfg ? normalizeImagePlaceholderConfig(cfg) : null;
  notifyListeners();
}

export function clearPreviewPlaceholderConfig(): void {
  if (!activePreviewConfig) return;
  activePreviewConfig = null;
  notifyListeners();
}

export function subscribePlaceholderConfig(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
