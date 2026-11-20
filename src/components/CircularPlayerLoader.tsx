import { Play, RefreshCw, RotateCw } from 'lucide-react';

export type CircularLoaderViewMode = 'loading' | 'needs_interaction' | 'failed' | 'hidden';

interface CircularPlayerLoaderProps {
  mode: CircularLoaderViewMode;
  percent: number;
  isWaitingExternal?: boolean;
  hasAlternativeServers?: boolean;
  onPlayClick?: () => void;
  onRetryClick?: () => void;
  onSwitchServerClick?: () => void;
}

const CIRCLE_SIZE = 128;
const STROKE_WIDTH = 6;
const RADIUS = (CIRCLE_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function CircularPlayerLoader({
  mode,
  percent,
  isWaitingExternal = false,
  hasAlternativeServers = false,
  onPlayClick,
  onRetryClick,
  onSwitchServerClick,
}: CircularPlayerLoaderProps) {
  if (mode === 'hidden') return null;

  const clampedPercent = Math.max(0, Math.min(100, Math.round(percent)));
  const dashOffset = CIRCUMFERENCE * (1 - clampedPercent / 100);

  return (
    <div
      role="status"
      aria-live="polite"
      data-rtv-player-loader={mode}
      className={`absolute inset-0 z-30 flex flex-col items-center justify-center p-4 sm:p-6 text-center select-none ${
        mode === 'needs_interaction' ? 'bg-[#090f18]/85 backdrop-blur-[4px]' : 'bg-[#0b121c]'
      }`}
    >
      {mode === 'loading' && (
        <div className="flex flex-col items-center justify-center gap-4 max-w-xs">
          <div className="relative h-24 w-24 sm:h-28 sm:w-28 md:h-32 md:w-32 flex items-center justify-center">
            <svg
              viewBox={`0 0 ${CIRCLE_SIZE} ${CIRCLE_SIZE}`}
              className="h-full w-full -rotate-90 transform"
              aria-hidden="true"
            >
              {/* Subtle ambient ring pulse only while awaiting external network/player step */}
              {isWaitingExternal && (
                <circle
                  cx={CIRCLE_SIZE / 2}
                  cy={CIRCLE_SIZE / 2}
                  r={RADIUS}
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.08)"
                  strokeWidth={STROKE_WIDTH + 2}
                  className="animate-pulse"
                />
              )}
              <circle
                cx={CIRCLE_SIZE / 2}
                cy={CIRCLE_SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke="#1d2b3a"
                strokeWidth={STROKE_WIDTH}
              />
              <circle
                cx={CIRCLE_SIZE / 2}
                cy={CIRCLE_SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke="var(--pt-accent, #3b82f6)"
                strokeWidth={STROKE_WIDTH}
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={dashOffset}
                style={{
                  transition: 'stroke-dashoffset 280ms cubic-bezier(0.22, 1, 0.36, 1)',
                }}
              />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span
                className="font-latin text-2xl sm:text-3xl font-black text-white tabular-nums tracking-tight"
                dir="ltr"
              >
                {clampedPercent}%
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <p className="font-display text-sm sm:text-base font-extrabold text-white">
              جاري تجهيز المشاهدة
            </p>
            <p className="text-xs text-[#93a7c7]">يرجى الانتظار قليلاً</p>
          </div>
        </div>
      )}

      {mode === 'needs_interaction' && (
        <div className="flex flex-col items-center justify-center gap-3.5 max-w-xs">
          <button
            type="button"
            onClick={onPlayClick}
            aria-label="بدء تشغيل الفيديو"
            className="inline-flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-full shadow-2xl transition-transform hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/60 cursor-pointer"
            style={{
              backgroundColor: 'var(--pt-accent, #f9c400)',
              color: 'var(--pt-accent-contrast, #06131c)',
            }}
          >
            <Play className="w-8 h-8 sm:w-9 sm:h-9 fill-current translate-x-0.5" />
          </button>

          <p className="font-display text-sm sm:text-base font-extrabold text-white">
            اضغط لبدء المشاهدة
          </p>
        </div>
      )}

      {mode === 'failed' && (
        <div className="flex flex-col items-center justify-center gap-4 max-w-md px-2">
          <div className="relative h-20 w-20 sm:h-24 sm:w-24 flex items-center justify-center">
            <svg
              viewBox={`0 0 ${CIRCLE_SIZE} ${CIRCLE_SIZE}`}
              className="h-full w-full -rotate-90 transform"
              aria-hidden="true"
            >
              <circle
                cx={CIRCLE_SIZE / 2}
                cy={CIRCLE_SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke="rgba(217, 35, 33, 0.25)"
                strokeWidth={STROKE_WIDTH}
              />
              <circle
                cx={CIRCLE_SIZE / 2}
                cy={CIRCLE_SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke="#D92321"
                strokeWidth={STROKE_WIDTH}
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={0}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-latin text-lg sm:text-xl font-black text-[#ff9f9d] tabular-nums" dir="ltr">
                100%
              </span>
            </div>
          </div>

          <p className="font-display text-sm sm:text-base font-extrabold text-white leading-relaxed">
            تعذر تشغيل هذا السيرفر، جرّب إعادة المحاولة أو اختر سيرفر آخر.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
            {onRetryClick && (
              <button
                type="button"
                onClick={onRetryClick}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl px-4 min-h-[44px] py-2 text-xs sm:text-sm font-extrabold transition-transform active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
                style={{
                  backgroundColor: 'var(--pt-accent, #f9c400)',
                  color: 'var(--pt-accent-contrast, #06131c)',
                }}
              >
                <RotateCw className="w-4 h-4" />
                <span>إعادة المحاولة</span>
              </button>
            )}

            {hasAlternativeServers && onSwitchServerClick && (
              <button
                type="button"
                onClick={onSwitchServerClick}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-white/[0.1] hover:bg-white/[0.18] border border-white/20 px-4 min-h-[44px] py-2 text-xs sm:text-sm font-bold text-white transition-transform active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>تغيير السيرفر</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
