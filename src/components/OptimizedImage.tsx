import { CSSProperties, SyntheticEvent, useEffect, useMemo, useState } from 'react';
import { Film, ImageOff, Tv, User as UserIcon } from 'lucide-react';
import type { ImagePlaceholderConfig, ImageSlotType } from '../types/media';
import {
  buildSlotSrcSet,
  getSlotSizesAttr,
  isImageUrlFailed,
  markImageUrlFailed,
  resolveImageForSlot,
} from '../lib/imageOptimizer';
import {
  buildPlaceholderSurfaceBackground,
  getPlaceholderConfig,
  resolveEffectivePlaceholderForSlot,
  subscribePlaceholderConfig,
} from '../lib/placeholderConfig';

export interface OptimizedImageProps {
  src?: string | null;
  fallbackSrc?: string | null;
  alt: string;
  slot?: ImageSlotType;
  priority?: boolean;
  loading?: 'lazy' | 'eager';
  className?: string;
  imgClassName?: string;
  style?: CSSProperties;
  width?: number;
  height?: number;
  sizes?: string;
  useSrcSet?: boolean;
  draggable?: boolean;
  referrerPolicy?: React.HTMLAttributeReferrerPolicy;
  ariaHidden?: boolean;
  disablePlaceholder?: boolean;
  /** Used strictly by the Admin Placeholder Preview cards to inspect loading/error/loaded states */
  forcePreviewState?: 'loading' | 'loaded' | 'error';
  /** Optional explicit config override used by admin draft previews */
  configOverride?: ImagePlaceholderConfig;
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
  onError?: (event: SyntheticEvent<HTMLImageElement>) => void;
}

export function OptimizedImage({
  src,
  fallbackSrc,
  alt,
  slot = 'card_grid',
  priority = false,
  loading,
  className = '',
  imgClassName = '',
  style,
  width,
  height,
  sizes,
  useSrcSet = true,
  draggable,
  referrerPolicy = 'no-referrer',
  ariaHidden,
  disablePlaceholder = false,
  forcePreviewState,
  configOverride,
  onLoad,
  onError,
}: OptimizedImageProps) {
  const [configVersion, setConfigVersion] = useState(0);

  useEffect(() => {
    if (configOverride) return undefined;
    return subscribePlaceholderConfig(() => {
      setConfigVersion((v) => v + 1);
    });
  }, [configOverride]);

  const placeholderConfig = useMemo(() => {
    if (configOverride) return configOverride;
    void configVersion;
    return getPlaceholderConfig();
  }, [configOverride, configVersion]);

  const appearance = useMemo(
    () => resolveEffectivePlaceholderForSlot(placeholderConfig, slot),
    [placeholderConfig, slot]
  );

  const primaryUrl = useMemo(() => resolveImageForSlot(src, slot), [src, slot]);
  const secondaryFallbackUrl = useMemo(
    () => (fallbackSrc ? resolveImageForSlot(fallbackSrc, slot) : ''),
    [fallbackSrc, slot]
  );

  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>(() => {
    if (forcePreviewState) return forcePreviewState;
    if (!primaryUrl || isImageUrlFailed(primaryUrl)) {
      if (secondaryFallbackUrl && !isImageUrlFailed(secondaryFallbackUrl)) {
        return 'loading';
      }
      return 'error';
    }
    return 'loading';
  });

  const [usedFallbackSrc, setUsedFallbackSrc] = useState<boolean>(() => {
    if (!primaryUrl || isImageUrlFailed(primaryUrl)) {
      return Boolean(secondaryFallbackUrl && !isImageUrlFailed(secondaryFallbackUrl));
    }
    return false;
  });

  useEffect(() => {
    if (forcePreviewState) {
      setLoadState(forcePreviewState);
      return;
    }
    if (!primaryUrl || isImageUrlFailed(primaryUrl)) {
      if (secondaryFallbackUrl && !isImageUrlFailed(secondaryFallbackUrl)) {
        setUsedFallbackSrc(true);
        setLoadState('loading');
      } else {
        setUsedFallbackSrc(false);
        setLoadState('error');
      }
      return;
    }
    setUsedFallbackSrc(false);
    setLoadState('loading');
  }, [primaryUrl, secondaryFallbackUrl, forcePreviewState]);

  const effectiveState = forcePreviewState || loadState;

  const activeUrl = useMemo(() => {
    if (effectiveState === 'error') {
      return appearance.errorFallbackImageUrl || '';
    }
    if (usedFallbackSrc && secondaryFallbackUrl) {
      return secondaryFallbackUrl;
    }
    return primaryUrl;
  }, [effectiveState, usedFallbackSrc, secondaryFallbackUrl, primaryUrl, appearance.errorFallbackImageUrl]);

  const activeSrcSet = useMemo(() => {
    if (!useSrcSet || effectiveState === 'error' || !activeUrl) return undefined;
    return buildSlotSrcSet(activeUrl, slot);
  }, [useSrcSet, effectiveState, activeUrl, slot]);

  const resolvedSizes = sizes || getSlotSizesAttr(slot);
  const effectiveLoading: 'eager' | 'lazy' = priority ? 'eager' : loading || 'lazy';

  const surfaceStyle: CSSProperties = useMemo(
    () => ({
      background: buildPlaceholderSurfaceBackground(appearance),
      '--rtv-shimmer-duration': appearance.shimmerDurationSec,
      ...style,
    } as CSSProperties),
    [appearance, style]
  );

  const renderSlotIcon = () => {
    if (effectiveState === 'error' && !appearance.errorFallbackImageUrl) {
      return <ImageOff className="w-6 h-6 text-white/35" />;
    }
    if (!appearance.showFallbackIcon) return null;
    if (slot === 'cast_avatar') return <UserIcon className="w-6 h-6 text-white/30" />;
    if (slot === 'episode_thumb') return <Tv className="w-6 h-6 text-white/30" />;
    return <Film className="w-6 h-6 text-white/30" />;
  };

  const handleImgLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    if (!forcePreviewState) {
      setLoadState('loaded');
    }
    onLoad?.(e);
  };

  const handleImgError = (e: SyntheticEvent<HTMLImageElement>) => {
    if (forcePreviewState) return;
    if (!usedFallbackSrc && primaryUrl) {
      markImageUrlFailed(primaryUrl);
      if (secondaryFallbackUrl && secondaryFallbackUrl !== primaryUrl && !isImageUrlFailed(secondaryFallbackUrl)) {
        setUsedFallbackSrc(true);
        setLoadState('loading');
        return;
      }
    } else if (usedFallbackSrc && secondaryFallbackUrl) {
      markImageUrlFailed(secondaryFallbackUrl);
    }
    setLoadState('error');
    onError?.(e);
  };

  const showPlaceholderLayer =
    !disablePlaceholder && (effectiveState === 'loading' || (effectiveState === 'error' && !appearance.errorFallbackImageUrl));

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={disablePlaceholder ? style : surfaceStyle}
    >
      {/* Loading / Error Placeholder Layer */}
      {showPlaceholderLayer && (
        <div
          aria-hidden="true"
          className={`absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none ${
            effectiveState === 'loading' && appearance.shimmerEnabled ? 'rtv-placeholder-shimmer' : ''
          }`}
        >
          {/* Optional Custom Loading Placeholder Image */}
          {effectiveState === 'loading' &&
            appearance.mode === 'custom_image' &&
            appearance.customImageUrl && (
              <img
                src={appearance.customImageUrl}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}

          {/* Dimming scrim over placeholder background/image */}
          {appearance.dimOpacity > 0 && (
            <div
              className="absolute inset-0"
              style={{ backgroundColor: `rgba(0, 0, 0, ${appearance.dimOpacity})` }}
            />
          )}

          {/* Centered Emblem / Watermark / Fallback Icon */}
          <div className="relative z-10 flex flex-col items-center justify-center gap-1.5 px-2 text-center">
            {renderSlotIcon()}
            {appearance.showLogoOverlay && (
              <span
                className="font-display text-[11px] sm:text-xs font-black tracking-wide text-white"
                style={{ opacity: appearance.logoOverlayOpacity }}
              >
                RahaL <span className="text-[#E50914]">TV</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Actual Image Element or Custom Error Fallback Image */}
      {effectiveState !== 'loading' && effectiveState === 'error' && appearance.errorFallbackImageUrl ? (
        <img
          src={appearance.errorFallbackImageUrl}
          alt={alt}
          width={width}
          height={height}
          loading={effectiveLoading}
          decoding="async"
          draggable={draggable}
          aria-hidden={ariaHidden}
          referrerPolicy={referrerPolicy}
          className={`relative z-10 block h-full w-full transition-opacity ${imgClassName}`}
          style={{ transitionDuration: `${appearance.fadeInDurationMs}ms` }}
        />
      ) : null}

      {activeUrl && effectiveState !== 'error' && forcePreviewState !== 'loading' ? (
        <img
          src={activeUrl}
          srcSet={activeSrcSet}
          sizes={activeSrcSet ? resolvedSizes : undefined}
          alt={alt}
          width={width}
          height={height}
          loading={effectiveLoading}
          decoding="async"
          {...(priority ? { fetchPriority: 'high' as const } : {})}
          draggable={draggable}
          aria-hidden={ariaHidden}
          referrerPolicy={referrerPolicy}
          onLoad={handleImgLoad}
          onError={handleImgError}
          className={`relative z-10 block h-full w-full transition-opacity ${
            effectiveState === 'loaded' ? 'opacity-100' : 'opacity-0'
          } ${imgClassName}`}
          style={{ transitionDuration: `${appearance.fadeInDurationMs}ms` }}
        />
      ) : null}
    </div>
  );
}
