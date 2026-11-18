import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Film,
  LayoutDashboard,
  Loader2,
  LogOut,
  Maximize2,
  Minimize2,
  MonitorPlay,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  Send,
  Server,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Tv,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { User } from 'firebase/auth';
import {
  filterServersInBrowser,
  isLikelyNonVideoWebsiteUrl,
  resolveApiEndpoint,
} from '../lib/clientScraper';
import { resolveDisplayShortUrl } from '../lib/permalink';
import {
  getFirebaseAuthErrorMessage,
  registerMemberWithEmailPassword,
  signInWithEmailPassword,
} from '../lib/firebase';
import {
  buildPlayerThemeVars,
  loadStoredPlayerTheme,
  normalizePlayerTheme,
} from '../lib/playerTheme';
import {
  appendPopupShieldLog,
  loadStoredPopupShieldConfig,
  normalizePopupShieldConfig,
  resolveEffectiveShieldDecision,
  setActiveShieldPlayerContext,
} from '../lib/popupShield';
import { handlePosterError } from '../lib/mediaFilters';
import { getPosterUrl } from '../lib/mediaImages';
import {
  AdminPrivilegeRole,
  MediaItem,
  PlayerThemeConfig,
  PopupShieldConfig,
  PopupShieldHostRule,
  PopupShieldProfileMode,
  VisitorRequest,
} from '../types/media';
import { FooterTopic } from './Footer';

/* ---------------- Watchlist Modal ---------------- */
interface WatchlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: MediaItem[];
  onSelectMedia: (item: MediaItem) => void;
  onRemove: (item: MediaItem) => void;
}

export function WatchlistModal({
  isOpen,
  onClose,
  items,
  onSelectMedia,
  onRemove,
}: WatchlistModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl rounded-3xl bg-[#0c1821] border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between bg-[#1a242e] px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <Bookmark className="w-5 h-5 text-[#4CAF50]" />
            <h2 className="font-display text-lg font-extrabold text-white">
              قائمتي للمشاهدة لاحقًا ({items.length})
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-white hover:bg-[#D92321] cursor-pointer"
            aria-label="إغلاق قائمتي"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-5">
          {items.length === 0 ? (
            <div className="py-12 text-center">
              <Film className="w-12 h-12 mx-auto text-[#b7c9ef]/30 mb-3" />
              <p className="text-sm font-bold text-white mb-1">قائمتك فارغة حاليًا</p>
              <p className="text-xs text-[#b7c9ef]">
                اضغط على زر "أضافة الي قائمتي" داخل أي فيلم أو مسلسل لحفظه هنا.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-4 rounded-2xl bg-[#1a242e]/80 border border-white/[0.07] p-3"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectMedia(item);
                      onClose();
                    }}
                    className="flex items-center gap-3.5 text-right flex-1 min-w-0 cursor-pointer group"
                  >
                    <img
                      src={getPosterUrl(item)}
                      alt={item.title}
                      referrerPolicy="no-referrer"
                      onError={handlePosterError}
                      className="h-18 w-14 rounded-xl object-cover object-top shrink-0"
                    />
                    <div className="min-w-0">
                      <h3 className="font-display text-sm font-bold text-white group-hover:text-[#D92321] truncate">
                        {item.title}
                      </h3>
                      <p className="text-xs text-[#b7c9ef] mt-1">
                        {item.year} • {item.quality} • {item.duration}
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(item)}
                    aria-label="إزالة من قائمتي"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-[#b7c9ef] hover:bg-[#D92321] hover:text-white transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Trailer Modal ---------------- */
interface TrailerModalProps {
  item: MediaItem | null;
  playerTheme?: PlayerThemeConfig;
  popupShieldConfig?: PopupShieldConfig;
  onClose: () => void;
  onWatchFull: (item: MediaItem) => void;
}

function normalizeTrailerUrl(url?: string): { kind: 'video' | 'iframe'; src: string } | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  if (/\.(mp4|webm|ogg)(\?|$)/i.test(trimmed)) {
    return { kind: 'video', src: trimmed };
  }
  const ytMatch = trimmed.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{6,})/i
  );
  if (ytMatch) {
    return { kind: 'iframe', src: `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1` };
  }
  return { kind: 'iframe', src: trimmed };
}

export function TrailerModal({
  item,
  playerTheme,
  popupShieldConfig,
  onClose,
  onWatchFull,
}: TrailerModalProps) {
  const [playing, setPlaying] = useState(true);
  const parsedTrailer = item ? normalizeTrailerUrl(item.trailerUrl) : null;
  const trailerShieldDecision = resolveEffectiveShieldDecision(
    parsedTrailer?.src,
    popupShieldConfig || loadStoredPopupShieldConfig()
  );

  useEffect(() => {
    if (!item) return;
    setActiveShieldPlayerContext({
      serverHost: trailerShieldDecision.hostname || 'trailer',
      serverName: 'الإعلان الرسمي',
      mediaTitle: item.title,
      mode: trailerShieldDecision.mode,
    });
    return () => {
      setActiveShieldPlayerContext(null);
    };
  }, [item?.id, item?.title, trailerShieldDecision.hostname, trailerShieldDecision.mode]);

  if (!item) return null;

  const theme = normalizePlayerTheme(playerTheme || loadStoredPlayerTheme());
  const themeVars = buildPlayerThemeVars(theme);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5" style={themeVars}>
      <div className="fixed inset-0 bg-black/85 backdrop-blur-md" onClick={onClose} />
      <div
        className="relative z-10 w-full max-w-4xl border overflow-hidden"
        style={{
          backgroundColor: 'var(--pt-frame)',
          borderColor: 'var(--pt-accent-35)',
          borderRadius: 'var(--pt-radius)',
          boxShadow: 'var(--pt-shadow)',
        }}
      >
        <div
          className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-white/[0.08]"
          style={{ backgroundColor: 'var(--pt-modal)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg shrink-0"
              style={{
                backgroundColor: 'var(--pt-accent)',
                color: 'var(--pt-accent-contrast)',
              }}
            >
              <Film className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <span
                className="text-[10px] font-black tracking-wide block uppercase"
                style={{ color: 'var(--pt-accent)' }}
              >
                {theme.brandLabel} · TRAILER
              </span>
              <h3 className="font-display text-sm sm:text-base font-bold text-white truncate">
                {item.trailerLabel}
              </h3>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onWatchFull(item);
              }}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-extrabold transition-opacity hover:opacity-90 cursor-pointer"
              style={{
                backgroundColor: 'var(--pt-accent)',
                color: 'var(--pt-accent-contrast)',
              }}
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>مشاهدة العمل كامل</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] border border-white/10 text-white/85 hover:bg-white/15 hover:text-white transition-colors cursor-pointer"
              aria-label="إغلاق الإعلان"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Clean Cinema 16:9 Trailer Stage */}
        <div className="relative aspect-video w-full bg-black overflow-hidden">
          {parsedTrailer ? (
            parsedTrailer.kind === 'video' ? (
              <video
                src={parsedTrailer.src}
                controls
                autoPlay
                playsInline
                className="h-full w-full bg-black"
              />
            ) : (
              <iframe
                key={`${parsedTrailer.src}-${trailerShieldDecision.mode}`}
                src={parsedTrailer.src}
                title={item.trailerLabel}
                sandbox={trailerShieldDecision.sandboxAttr}
                allowFullScreen
                allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                className="h-full w-full border-0 bg-black"
              />
            )
          ) : (
            <>
              <img
                src={item.backdrop || item.poster}
                alt={item.title}
                className={`h-full w-full object-cover transition-transform duration-[6000ms] ${
                  playing ? 'scale-110' : 'scale-100'
                }`}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-transparent" />

              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                <button
                  type="button"
                  onClick={() => setPlaying((p) => !p)}
                  className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full shadow-2xl hover:scale-105 transition-transform cursor-pointer"
                  style={{
                    backgroundColor: 'var(--pt-accent)',
                    color: 'var(--pt-accent-contrast)',
                  }}
                  aria-label={playing ? 'إيقاف مؤقت' : 'تشغيل'}
                >
                  {playing ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 fill-current" />}
                </button>
                <p className="font-display text-xl sm:text-2xl font-extrabold text-white drop-shadow">
                  {item.title}
                </p>
                <p className="mt-1 max-w-xl text-xs sm:text-sm text-[#b7c9ef]">{item.tagline}</p>
              </div>

              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-4 bg-black/75 px-5 py-3 backdrop-blur-sm border-t border-white/10">
                <div className="flex items-center gap-3 text-xs font-bold text-white">
                  <Volume2 className="w-4 h-4" style={{ color: 'var(--pt-accent)' }} />
                  <span>معاينة الإعلان الرسمي</span>
                  <div className="hidden sm:block h-1.5 w-44 rounded-full bg-white/20 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-700 ${
                        playing ? 'w-2/5' : 'w-0'
                      }`}
                      style={{ backgroundColor: 'var(--pt-accent)' }}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onWatchFull(item);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-extrabold transition-opacity hover:opacity-90 cursor-pointer"
                  style={{
                    backgroundColor: 'var(--pt-accent)',
                    color: 'var(--pt-accent-contrast)',
                  }}
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>مشاهدة العمل كامل</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Interactive Multi-Server Stream Player Modal ---------------- */
interface PlayerModalProps {
  item: MediaItem | null;
  initialEpisode?: number;
  initialServerIndex?: number;
  playerTheme?: PlayerThemeConfig;
  popupShieldConfig?: PopupShieldConfig;
  onUpdateHostRule?: (rule: PopupShieldHostRule) => void;
  isInWatchlist?: boolean;
  onToggleWatchlist?: (item: MediaItem) => void;
  onNotify?: (message: string) => void;
  onClose: () => void;
}

interface ServerFilterEntry {
  url: string;
  ok: boolean;
  faultType: '403' | 'sandboxed_embed' | '404' | 'frame_blocked' | 'not_video' | 'error' | null;
  httpStatus: number;
  reason: string;
  directStreamUrl?: string | null;
}

function getFriendlyServerError(entry?: ServerFilterEntry | null): {
  title: string;
  subtitle: string;
  shortStatus: string;
} {
  if (!entry) {
    return {
      title: 'تعذر تشغيل هذا السيرفر',
      subtitle: 'حدث انقطاع مؤقت في السيرفر. يمكنك تجربة سيرفر آخر.',
      shortStatus: 'غير متاح',
    };
  }
  if (entry.faultType === '403' || entry.httpStatus === 403) {
    return {
      title: 'السيرفر غير متاح حالياً',
      subtitle: 'تعذر الوصول إلى مصدر البث في هذا السيرفر. جرّب سيرفراً آخر للمشاهدة.',
      shortStatus: 'غير متاح',
    };
  }
  if (entry.faultType === '404' || entry.httpStatus === 404 || entry.httpStatus === 410) {
    return {
      title: 'الفيديو غير متوفر على هذا السيرفر',
      subtitle: 'لم يتم العثور على ملف المشاهدة هنا. اختر سيرفراً بديلاً للمتابعة.',
      shortStatus: 'غير متوفر',
    };
  }
  if (entry.faultType === 'frame_blocked' || entry.faultType === 'sandboxed_embed') {
    return {
      title: 'تعذر تشغيل هذا السيرفر هنا',
      subtitle: 'هذا السيرفر لا يدعم التشغيل داخل المشغل الحالي. جرّب سيرفراً آخر.',
      shortStatus: 'غير متوافق',
    };
  }
  if (entry.faultType === 'not_video') {
    return {
      title: 'الرابط لا يحتوي على فيديو مباشر',
      subtitle: 'تم إيقاف هذا الرابط لأنه لا يفتح مشغل فيديو. جرّب سيرفراً آخر.',
      shortStatus: 'غير متاح',
    };
  }
  return {
    title: 'تعذر الاتصال بالسيرفر',
    subtitle: 'قد يكون السيرفر مشغولاً حالياً. يمكنك تجربة سيرفر آخر أو إعادة المحاولة.',
    shortStatus: 'متعطل',
  };
}

function cleanQualityIdentifier(quality?: string, fallback?: string): string {
  const cleaned = String(quality || fallback || 'HD')
    .replace(/مستورد|embed/gi, '')
    .trim();
  return cleaned || String(fallback || 'HD').replace(/مستورد|embed/gi, '').trim() || 'HD';
}

function extractSafeStreamSrc(embedCode?: string, url?: string): string | null {
  if (embedCode) {
    const match = embedCode.match(/src\s*=\s*["']([^"']+)["']/i);
    if (match && /^https?:\/\//i.test(match[1].trim())) {
      return match[1].trim();
    }
    if (/^https?:\/\//i.test(embedCode.trim())) {
      return embedCode.trim();
    }
  }
  if (url && /^https?:\/\//i.test(url.trim())) {
    return url.trim();
  }
  return null;
}

export function PlayerModal({
  item,
  initialEpisode = 1,
  initialServerIndex = 0,
  playerTheme,
  popupShieldConfig,
  onUpdateHostRule,
  isInWatchlist = false,
  onToggleWatchlist,
  onNotify,
  onClose,
}: PlayerModalProps) {
  const [selectedServer, setSelectedServer] = useState(initialServerIndex);
  const [subtitleLang, setSubtitleLang] = useState<'ar' | 'en' | 'off'>('ar');
  const [isPlaying, setIsPlaying] = useState(true);
  const [seasonIdx, setSeasonIdx] = useState(0);
  const [episodeNum, setEpisodeNum] = useState(initialEpisode);

  // Server Filtering system states
  const [filterMap, setFilterMap] = useState<Record<number, ServerFilterEntry>>({});
  const [isFiltering, setIsFiltering] = useState(false);
  const [filterAlert, setFilterAlert] = useState<{
    kind: 'switched' | 'warning';
    message: string;
  } | null>(null);
  const [bypassEpisodeSrc, setBypassEpisodeSrc] = useState(false);
  const [manualBypassFault, setManualBypassFault] = useState<Record<number, boolean>>({});
  const [playerReloadKey, setPlayerReloadKey] = useState(0);
  const [shieldSessionOverrides, setShieldSessionOverrides] = useState<
    Record<number, Exclude<PopupShieldProfileMode, 'direct_media'>>
  >({});
  const [showMobileDetails, setShowMobileDetails] = useState(false);
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const playerBoxRef = useRef<HTMLDivElement | null>(null);
  const lastBlurObservedRef = useRef<number>(0);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const handleToggleFullscreen = async () => {
    const el = playerBoxRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      // Fullscreen may be restricted inside nested preview frames
    }
  };

  // Reset selections when media item or initial props change
  useEffect(() => {
    const seasons = item?.seasons || [];
    const matchingSeason = seasons.findIndex((s) =>
      (s.episodes || []).some((e) => e.number === initialEpisode)
    );
    setSeasonIdx(matchingSeason >= 0 ? matchingSeason : 0);
    setEpisodeNum(initialEpisode);
    setSelectedServer(initialServerIndex);
    setFilterMap({});
    setFilterAlert(null);
    setBypassEpisodeSrc(false);
    setManualBypassFault({});
    setPlayerReloadKey(0);
    setShieldSessionOverrides({});
    setShowMobileDetails(false);
  }, [item?.id, initialEpisode, initialServerIndex]);

  // Helper to mark a server faulty at runtime and auto-switch to next healthy server
  const handleServerFaultFailover = useCallback(
    (faultIdx: number, reason: string) => {
      if (!item) return;
      const epList = item.seasons?.[seasonIdx]?.episodes || item.seasons?.[0]?.episodes || [];
      const activeEp = epList.find((e) => e.number === episodeNum);
      const effectiveServers =
        activeEp?.servers && activeEp.servers.length > 0 ? activeEp.servers : item.servers;
      const total = effectiveServers.length;
      setFilterMap((prev) => {
        const next: Record<number, ServerFilterEntry> = {
          ...prev,
          [faultIdx]: {
            url: prev[faultIdx]?.url || '',
            ok: false,
            faultType: reason.includes('403')
              ? '403'
              : reason.includes('404')
                ? '404'
                : /sandbox/i.test(reason)
                  ? 'sandboxed_embed'
                  : 'error',
            httpStatus: reason.includes('403') ? 403 : reason.includes('404') ? 404 : 0,
            reason,
          },
        };

        // Find first non-faulty alternative server
        let candidateIdx = -1;
        for (let i = 0; i < total; i++) {
          if (i !== faultIdx && next[i]?.ok !== false) {
            candidateIdx = i;
            break;
          }
        }

        if (candidateIdx !== -1) {
          setSelectedServer(candidateIdx);
          setFilterAlert({
            kind: 'switched',
            message: `سيرفر ${faultIdx + 1} غير متاح حالياً — تم التبديل تلقائياً إلى سيرفر ${candidateIdx + 1}.`,
          });
        } else {
          setFilterAlert({
            kind: 'warning',
            message: `تعذر تشغيل سيرفر ${faultIdx + 1} — يمكنك تجربة سيرفر آخر أو إعادة المحاولة.`,
          });
        }

        return next;
      });
    },
    [item, seasonIdx, episodeNum]
  );

  // Proactive Server Filtering scan on open / episode change (backend + browser/Worker fallback)
  useEffect(() => {
    if (!item) return;

    const episodesList = item.seasons?.[seasonIdx]?.episodes || item.seasons?.[0]?.episodes || [];
    const activeEp = episodesList.find((e) => e.number === episodeNum);
    const hasPerEpisodeServers = Boolean(activeEp?.servers && activeEp.servers.length > 0);
    const targetServers = hasPerEpisodeServers ? activeEp!.servers! : item.servers;

    const rawEpSrc = hasPerEpisodeServers
      ? null
      : extractSafeStreamSrc(activeEp?.embedCode, activeEp?.watchUrl);
    const epSrc = rawEpSrc && !isLikelyNonVideoWebsiteUrl(rawEpSrc) ? rawEpSrc : null;

    const serverUrls = targetServers.map((srv) => extractSafeStreamSrc(srv.embedCode, srv.url) || '');
    const allUrls = epSrc ? [...serverUrls, epSrc] : serverUrls;

    if (allUrls.every((u) => !u)) return;

    let cancelled = false;
    setIsFiltering(true);
    setBypassEpisodeSrc(false);

    (async () => {
      try {
        let filterResults: ServerFilterEntry[] | null = null;

        try {
          const res = await fetch(resolveApiEndpoint('/api/filter-servers'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: allUrls }),
          });
          const contentType = res.headers.get('content-type') || '';
          if (res.ok && contentType.includes('application/json')) {
            const data = (await res.json()) as { ok?: boolean; results?: ServerFilterEntry[] };
            if (data.ok && Array.isArray(data.results)) {
              filterResults = data.results;
            }
          }
        } catch {
          // Static hosting -> fall through to browser/Worker filter
        }

        if (!filterResults) {
          filterResults = await filterServersInBrowser(allUrls);
        }

        if (cancelled || !filterResults) return;

        const nextMap: Record<number, ServerFilterEntry> = {};
        const faultyIndices: number[] = [];

        targetServers.forEach((_, idx) => {
          const entry = filterResults?.[idx];
          if (entry) {
            nextMap[idx] = entry;
            if (!entry.ok) {
              faultyIndices.push(idx + 1);
            }
          }
        });

        setFilterMap(nextMap);

        // If episode-specific URL failed, bypass it if we have a working server
        const epResult = epSrc ? filterResults[targetServers.length] : null;
        const firstHealthyIdx = targetServers.findIndex((_, idx) => nextMap[idx]?.ok === true);

        if (epSrc && epResult && !epResult.ok && firstHealthyIdx !== -1) {
          setBypassEpisodeSrc(true);
          setSelectedServer(firstHealthyIdx);
          setFilterAlert({
            kind: 'switched',
            message: `تم التبديل تلقائياً إلى سيرفر ${firstHealthyIdx + 1} لضمان تشغيل الحلقة.`,
          });
          return;
        }

        const safeCurrentIdx = selectedServer < targetServers.length ? selectedServer : 0;
        const activeEntry = nextMap[safeCurrentIdx];
        if (activeEntry && !activeEntry.ok) {
          if (firstHealthyIdx !== -1 && firstHealthyIdx !== safeCurrentIdx) {
            setSelectedServer(firstHealthyIdx);
            setFilterAlert({
              kind: 'switched',
              message: `سيرفر ${safeCurrentIdx + 1} غير متاح حالياً — تم التبديل تلقائياً إلى سيرفر ${firstHealthyIdx + 1}.`,
            });
          } else {
            setFilterAlert({
              kind: 'warning',
              message: `سيرفر ${safeCurrentIdx + 1} غير متاح حالياً — جرّب سيرفراً آخر.`,
            });
          }
        } else if (faultyIndices.length > 0 && targetServers.length > 1) {
          setFilterAlert(null);
        }
      } catch {
        // Silent fallback
      } finally {
        if (!cancelled) setIsFiltering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [item?.id, seasonIdx, episodeNum, initialServerIndex]);

  const effectiveShieldConfig = normalizePopupShieldConfig(
    popupShieldConfig || loadStoredPopupShieldConfig()
  );

  // Derive active stream URL cleanly before runtime Shield effects
  const activeMediaEpisodes = item?.seasons?.[seasonIdx]?.episodes || item?.seasons?.[0]?.episodes || [];
  const activeEpPreview = activeMediaEpisodes.find((e) => e.number === episodeNum);
  const effectivePreviewServers =
    activeEpPreview?.servers && activeEpPreview.servers.length > 0
      ? activeEpPreview.servers
      : item?.servers || [];
  const previewServerIndex =
    selectedServer < effectivePreviewServers.length ? selectedServer : 0;
  const previewServerObj = effectivePreviewServers[previewServerIndex];
  const rawPreviewEpSrc =
    activeEpPreview?.servers && activeEpPreview.servers.length > 0
      ? null
      : bypassEpisodeSrc
        ? null
        : extractSafeStreamSrc(activeEpPreview?.embedCode, activeEpPreview?.watchUrl);
  const previewEpSrc =
    rawPreviewEpSrc && !isLikelyNonVideoWebsiteUrl(rawPreviewEpSrc) ? rawPreviewEpSrc : null;
  const previewServerSrc =
    filterMap[previewServerIndex]?.directStreamUrl ||
    extractSafeStreamSrc(previewServerObj?.embedCode, previewServerObj?.url);
  const currentActiveStreamSrc = previewEpSrc || previewServerSrc;
  const currentShieldDecision = resolveEffectiveShieldDecision(
    currentActiveStreamSrc,
    effectiveShieldConfig,
    shieldSessionOverrides[previewServerIndex] || null
  );

  // Sync active Shield player context for parent window guards (window.open / target=_blank)
  useEffect(() => {
    if (!item) return;
    setActiveShieldPlayerContext({
      serverHost: currentShieldDecision.hostname || 'player',
      serverName: `سيرفر ${previewServerIndex + 1}`,
      mediaTitle: item.title,
      mode: currentShieldDecision.mode,
    });
    return () => {
      setActiveShieldPlayerContext(null);
    };
  }, [
    item?.id,
    item?.title,
    previewServerIndex,
    currentShieldDecision.hostname,
    currentShieldDecision.mode,
  ]);

  // Passive cross-origin blur observation: NEVER pretends external unsandboxed popups were blocked
  useEffect(() => {
    if (!item || !currentActiveStreamSrc) return;
    if (
      currentShieldDecision.mode === 'direct_media' ||
      currentShieldDecision.mode === 'strict_sandbox' ||
      !effectiveShieldConfig.enabled
    ) {
      return;
    }

    const onWindowBlur = () => {
      const now = Date.now();
      if (now - lastBlurObservedRef.current < 4000) return;
      window.setTimeout(() => {
        if (document.activeElement?.tagName === 'IFRAME') {
          lastBlurObservedRef.current = Date.now();
          appendPopupShieldLog({
            kind: 'observed_external_blur',
            prevented: false,
            serverHost: currentShieldDecision.hostname || 'external-embed',
            serverName: `سيرفر ${previewServerIndex + 1}`,
            mediaTitle: item.title,
            targetUrl: currentActiveStreamSrc,
            detail:
              'رُصد انتقال التركيز خارج المشغل (السيرفر يعمل في وضع التوافق المباشر لرفضه العزل، وقد يفتح تبويباً خارج نطاق Cross-Origin).',
          });
        }
      }, 65);
    };

    window.addEventListener('blur', onWindowBlur);
    return () => window.removeEventListener('blur', onWindowBlur);
  }, [
    item?.id,
    item?.title,
    currentActiveStreamSrc,
    currentShieldDecision.mode,
    currentShieldDecision.hostname,
    effectiveShieldConfig.enabled,
    previewServerIndex,
  ]);

  // Listen for postMessage cues from embedded players reporting sandboxed embed or 403 errors
  useEffect(() => {
    if (!item) return;
    const onMessage = (event: MessageEvent) => {
      const payload = typeof event.data === 'string' ? event.data : JSON.stringify(event.data || '');
      const isSandboxRejection =
        /sandboxed\s*embed|please\s*disable\s+sandbox|embedding\s+in\s+sandbox/i.test(payload);
      if (
        isSandboxRejection &&
        effectiveShieldConfig.autoFallbackOnReject &&
        currentShieldDecision.mode !== 'direct_unrestricted' &&
        currentShieldDecision.mode !== 'direct_media'
      ) {
        setShieldSessionOverrides((prev) => ({
          ...prev,
          [previewServerIndex]: 'direct_unrestricted',
        }));
        if (currentShieldDecision.hostname && onUpdateHostRule) {
          onUpdateHostRule({
            hostname: currentShieldDecision.hostname,
            mode: 'direct_unrestricted',
            compatibility: 'incompatible',
            note: 'تم التحويل التلقائي لوضع التوافق المباشر بعد رفض السيرفر لـ sandbox.',
            lastTestedAt: new Date().toISOString(),
          });
        }
        appendPopupShieldLog({
          kind: 'sandbox_rejected_fallback',
          prevented: false,
          serverHost: currentShieldDecision.hostname || 'external-embed',
          serverName: `سيرفر ${previewServerIndex + 1}`,
          mediaTitle: item.title,
          targetUrl: currentActiveStreamSrc || '',
          detail: 'رفض السيرفر قيود sandbox — تم تبديله فوراً إلى التشغيل المتوافق دون تعطيل الفيديو.',
        });
        setFilterAlert({
          kind: 'switched',
          message: `تم ضبط التوافق لسيرفر ${previewServerIndex + 1} تلقائياً لضمان التشغيل.`,
        });
        return;
      }

      if (/error\s*403|403\s*forbidden/i.test(payload)) {
        handleServerFaultFailover(selectedServer, 'خطأ 403');
      } else if (isSandboxRejection) {
        handleServerFaultFailover(selectedServer, 'رسالة Sandboxed embed');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [
    item?.id,
    item?.title,
    selectedServer,
    previewServerIndex,
    currentActiveStreamSrc,
    currentShieldDecision.mode,
    currentShieldDecision.hostname,
    effectiveShieldConfig.autoFallbackOnReject,
    onUpdateHostRule,
    handleServerFaultFailover,
  ]);

  if (!item) return null;

  const seasons = item.seasons || [];
  const episodes = activeMediaEpisodes;
  const activeEpisodeObj = episodes.find((e) => e.number === episodeNum);
  const perEpisodeServers =
    activeEpisodeObj?.servers && activeEpisodeObj.servers.length > 0
      ? activeEpisodeObj.servers
      : item.servers;

  const serversList =
    perEpisodeServers.length > 0
      ? perEpisodeServers
      : [
          {
            id: 'default',
            name: 'سيرفر 1',
            quality: item.quality,
            speed: 'سريع',
            tag: item.quality,
          },
        ];

  const safeServerIndex = selectedServer < serversList.length ? selectedServer : 0;
  const activeServer = serversList[safeServerIndex] || serversList[0];
  const activeQuality = cleanQualityIdentifier(activeServer.quality, item.quality);

  const rawEpFallbackSrc =
    activeEpisodeObj?.servers && activeEpisodeObj.servers.length > 0
      ? null
      : bypassEpisodeSrc
        ? null
        : extractSafeStreamSrc(activeEpisodeObj?.embedCode, activeEpisodeObj?.watchUrl);
  const episodeSpecificSrc =
    rawEpFallbackSrc && !isLikelyNonVideoWebsiteUrl(rawEpFallbackSrc) ? rawEpFallbackSrc : null;

  const activeFilterEntry = filterMap[safeServerIndex];
  const serverSrc =
    activeFilterEntry?.directStreamUrl || extractSafeStreamSrc(activeServer.embedCode, activeServer.url);
  const finalStreamSrc = episodeSpecificSrc || serverSrc;
  const isBlockedHomepageUrl = Boolean(
    finalStreamSrc &&
      (isLikelyNonVideoWebsiteUrl(finalStreamSrc) || activeFilterEntry?.faultType === 'not_video')
  );
  const isActiveServerFaulty = Boolean(
    activeFilterEntry && !activeFilterEntry.ok && !manualBypassFault[safeServerIndex]
  );
  const friendlyServerError = getFriendlyServerError(activeFilterEntry);
  const isDirectVideoFile = Boolean(finalStreamSrc && /\.(mp4|webm|ogg|m3u8)(\?|$)/i.test(finalStreamSrc));
  const shieldDecision = resolveEffectiveShieldDecision(
    finalStreamSrc,
    effectiveShieldConfig,
    shieldSessionOverrides[safeServerIndex] || null
  );

  const handleCycleShieldMode = () => {
    if (shieldDecision.mode === 'direct_media') return;
    const nextMode: Exclude<PopupShieldProfileMode, 'direct_media'> =
      shieldDecision.mode === 'strict_sandbox'
        ? 'redirect_guard'
        : shieldDecision.mode === 'redirect_guard'
          ? 'direct_unrestricted'
          : 'strict_sandbox';
    setShieldSessionOverrides((prev) => ({ ...prev, [safeServerIndex]: nextMode }));
    if (shieldDecision.hostname && onUpdateHostRule) {
      onUpdateHostRule({
        hostname: shieldDecision.hostname,
        mode: nextMode,
        compatibility:
          nextMode === 'strict_sandbox'
            ? 'compatible'
            : nextMode === 'redirect_guard'
              ? 'partial'
              : 'incompatible',
        note: 'تم تعديله من شريط المشغّل',
        lastTestedAt: new Date().toISOString(),
      });
    }
  };

  const handleManualServerSelect = (idx: number) => {
    const entry = filterMap[idx];
    if (entry && !entry.ok) {
      const healthyAlt = serversList.findIndex((_, i) => i !== idx && filterMap[i]?.ok === true);
      if (healthyAlt !== -1) {
        setSelectedServer(healthyAlt);
        setFilterAlert({
          kind: 'switched',
          message: `سيرفر ${idx + 1} غير متاح حالياً — تم التبديل تلقائياً إلى سيرفر ${healthyAlt + 1}.`,
        });
        return;
      }
      setFilterAlert({
        kind: 'warning',
        message: `سيرفر ${idx + 1} غير متاح حالياً — جرّب سيرفراً آخر.`,
      });
    }
    setSelectedServer(idx);
  };

  const handleSwitchToNextServer = () => {
    if (serversList.length <= 1) {
      setManualBypassFault((prev) => ({ ...prev, [safeServerIndex]: true }));
      setPlayerReloadKey((k) => k + 1);
      return;
    }
    const nextHealthy = serversList.findIndex(
      (_, idx) => idx !== safeServerIndex && filterMap[idx]?.ok === true
    );
    const nextNonBroken = serversList.findIndex(
      (_, idx) => idx !== safeServerIndex && filterMap[idx]?.ok !== false
    );
    const fallbackIdx = (safeServerIndex + 1) % serversList.length;
    const targetIdx = nextHealthy !== -1 ? nextHealthy : nextNonBroken !== -1 ? nextNonBroken : fallbackIdx;
    setSelectedServer(targetIdx);
  };

  const handleShareMedia = async () => {
    const urlToShare = resolveDisplayShortUrl(
      item,
      episodes.length > 0 ? episodeNum : undefined
    );
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: item.title,
          text: `${item.title} — شاهد الآن على RahaL TV`,
          url: urlToShare,
        });
        return;
      } catch {
        // User cancelled or share unsupported in embedded frame -> fallback to copy
      }
    }
    try {
      await navigator.clipboard.writeText(urlToShare);
    } catch {
      // Clipboard fallback ignored
    }
    onNotify?.('تم نسخ رابط المشاهدة بنجاح');
  };

  const theme = normalizePlayerTheme(playerTheme || loadStoredPlayerTheme());
  const themeVars = buildPlayerThemeVars(theme);

  const healthyNextIdx = serversList.findIndex(
    (_, idx) => idx !== safeServerIndex && filterMap[idx]?.ok !== false
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch lg:items-center justify-center p-0 lg:p-4 overflow-x-hidden"
      style={themeVars}
    >
      <div className="fixed inset-0 bg-black/95 lg:bg-black/90 lg:backdrop-blur-md" onClick={onClose} />
      <div
        className="rtv-mobile-watch-modal relative z-10 w-full lg:w-[96vw] lg:max-w-[1340px] border-0 lg:border border-white/[0.09] shadow-2xl overflow-hidden lg:max-h-[95vh] flex flex-col"
        style={{
          backgroundColor: 'var(--pt-modal)',
          borderRadius: 'var(--pt-radius)',
        }}
      >
        {/* Mobile Slim Watch Header (< 1024px) */}
        <div
          className="flex lg:hidden items-center justify-between gap-2 px-2.5 h-11 border-b border-white/[0.08] shrink-0"
          style={{ backgroundColor: 'var(--pt-frame)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.07] text-white active:scale-95 transition-transform cursor-pointer shrink-0"
              aria-label="إغلاق المشغل"
            >
              <X className="w-4 h-4" />
            </button>
            <h3 className="font-display text-xs font-extrabold text-white truncate">
              {item.title}
              {episodes.length > 0 ? ` · ح ${String(episodeNum).padStart(2, '0')}` : ''}
            </h3>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] font-bold text-[#b7c9ef] tabular-nums whitespace-nowrap">
              سيرفر {safeServerIndex + 1}
            </span>
            <button
              type="button"
              onClick={() => setPlayerReloadKey((k) => k + 1)}
              title="إعادة تحميل المشغل"
              aria-label="إعادة تحميل المشغل"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.07] text-white/90 active:scale-95 transition-transform cursor-pointer"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void handleToggleFullscreen()}
              title="ملء الشاشة"
              aria-label="ملء الشاشة"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg active:scale-95 transition-transform cursor-pointer"
              style={{
                backgroundColor: 'var(--pt-accent)',
                color: 'var(--pt-accent-contrast)',
              }}
            >
              {isFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Desktop & TV Unified Modal Top Bar (>= 1024px) */}
        <div
          className="hidden lg:flex items-center justify-between gap-3 px-4 py-2.5 border-b border-white/[0.08]"
          style={{ backgroundColor: 'var(--pt-frame)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0 shadow-md"
              style={{
                backgroundColor: 'var(--pt-accent)',
                color: 'var(--pt-accent-contrast)',
              }}
            >
              <Tv className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-display text-sm font-extrabold text-white truncate">
                {item.title}
                {item.kind === 'series' ? ` — الحلقة ${String(episodeNum).padStart(2, '0')}` : ''}
              </h3>
              <p className="text-[11px] text-[#9fb2d4] flex items-center gap-1.5 tabular-nums">
                <span className="font-extrabold text-white">سيرفر {safeServerIndex + 1}</span>
                <span>·</span>
                <span className="font-latin font-black text-[#f9c400]">{activeQuality}</span>
                {isFiltering && (
                  <>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold" style={{ color: 'var(--pt-accent)' }}>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>فحص السيرفرات...</span>
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] border border-white/10 text-white/85 hover:bg-white/15 hover:text-white transition-colors cursor-pointer shrink-0"
            aria-label="إغلاق المشغل"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Auto Server Filtering Alert Banner (Simple, Non-Technical) */}
        {filterAlert && (
          <div
            className={`flex items-center justify-between gap-2 px-3 lg:px-4 py-1.5 lg:py-2 text-[11px] lg:text-xs font-bold border-b shrink-0 ${
              filterAlert.kind === 'switched'
                ? 'bg-[#f9c400]/10 border-[#f9c400]/25 text-[#f9c400]'
                : 'bg-[#D92321]/12 border-[#D92321]/25 text-[#ff9b99]'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-3.5 h-3.5 lg:w-4 lg:h-4 shrink-0" />
              <span className="truncate sm:whitespace-normal">{filterAlert.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setFilterAlert(null)}
              className="rounded p-1 hover:bg-white/10 cursor-pointer shrink-0"
              aria-label="إخفاء التنبيه"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Main Body: Mobile Edge-to-Edge Watch First | Desktop Server Rail + Video Stage */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-0 lg:p-4">
          <div
            className={`flex flex-col lg:grid gap-0 lg:gap-3.5 lg:items-start ${
              isTheaterMode ? 'lg:grid-cols-1' : 'lg:grid-cols-[200px_minmax(0,1fr)]'
            }`}
          >
            {/* Right Sidebar on Desktop / Placed Below Player on Mobile */}
            {!isTheaterMode && (
              <aside
                id="mobile-server-selector"
                className="order-2 lg:order-1 mx-3 mt-3 lg:mx-0 lg:mt-0 rounded-2xl lg:rounded-xl border border-white/[0.08] p-3 lg:p-2.5 space-y-2.5 lg:space-y-2"
                style={{ backgroundColor: 'var(--pt-frame)' }}
              >
                <div className="flex items-center justify-between px-0.5 pb-1.5 border-b border-white/[0.06]">
                  <span className="inline-flex items-center gap-1.5 text-xs lg:text-[11px] font-extrabold text-white">
                    <Server className="w-3.5 h-3.5" style={{ color: 'var(--pt-accent)' }} />
                    <span>سيرفرات المشاهدة</span>
                  </span>
                  <div className="flex items-center gap-2">
                    {isFiltering && (
                      <span className="lg:hidden inline-flex items-center gap-1 text-[10px] font-bold text-[#9fb2d4]">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>فحص</span>
                      </span>
                    )}
                    <span
                      className="font-latin tabular-nums rounded px-1.5 py-0.5 text-[10px] font-black"
                      style={{
                        backgroundColor: 'var(--pt-accent-20)',
                        color: 'var(--pt-accent)',
                      }}
                    >
                      {serversList.length}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 min-[390px]:grid-cols-3 lg:grid-cols-1 gap-2 lg:gap-1.5 lg:max-h-[580px] lg:overflow-y-auto">
                  {serversList.map((srv, idx) => {
                    const isActive = safeServerIndex === idx;
                    const srvFilter = filterMap[idx];
                    const isBroken = Boolean(srvFilter && !srvFilter.ok);
                    const isVerifiedOk = Boolean(srvFilter && srvFilter.ok);
                    const qualityLabel = cleanQualityIdentifier(srv.quality, item.quality);

                    return (
                      <button
                        key={srv.id || idx}
                        type="button"
                        onClick={() => handleManualServerSelect(idx)}
                        title={
                          isBroken
                            ? `سيرفر ${idx + 1} غير متاح حالياً`
                            : `سيرفر ${idx + 1} (${qualityLabel})`
                        }
                        style={{
                          animationDelay: `${idx * 35}ms`,
                          ...(isActive
                            ? {
                                backgroundColor: 'var(--pt-accent)',
                                color: 'var(--pt-accent-contrast)',
                                borderColor: 'transparent',
                              }
                            : {}),
                        }}
                        className={`moov-server-enter group flex items-center justify-between gap-1.5 rounded-xl lg:rounded-lg border px-2.5 min-h-[44px] lg:min-h-0 py-2 transition-all duration-200 cursor-pointer ${
                          isActive
                            ? 'shadow-lg font-black ring-2 ring-white/25 lg:ring-0'
                            : isBroken
                              ? 'bg-[#D92321]/10 border-[#D92321]/25 text-[#ff9d9b] opacity-75 hover:opacity-100'
                              : 'bg-white/[0.04] border-white/[0.07] text-white/90 hover:bg-white/[0.09] hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors ${
                              isActive
                                ? 'bg-black/20 text-current'
                                : isBroken
                                  ? 'bg-[#D92321]/20 text-[#ff8a88]'
                                  : 'bg-white/[0.07] text-white/80'
                            }`}
                          >
                            <Play className="w-2.5 h-2.5 fill-current" />
                          </span>

                          <span className="text-xs font-extrabold truncate tabular-nums">
                            سيرفر {idx + 1}
                          </span>

                          {isBroken ? (
                            <AlertTriangle className="w-3 h-3 text-[#f9c400] shrink-0" />
                          ) : isVerifiedOk && !isActive ? (
                            <CheckCircle2 className="w-3 h-3 text-[#4CAF50] shrink-0" />
                          ) : null}
                        </div>

                        <span
                          className={`font-latin shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black ${
                            isActive
                              ? 'bg-black/20 text-current'
                              : 'bg-black/35 text-[#b7c9ef] border border-white/[0.06]'
                          }`}
                        >
                          {qualityLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </aside>
            )}

            {/* Main Area: Edge-to-Edge Video Stage + Desktop Episodes */}
            <div className="order-1 lg:order-2 min-w-0 w-full lg:space-y-3">
              <div
                ref={playerBoxRef}
                className="rtv-mobile-player-box border-0 lg:border overflow-hidden transition-all"
                style={{
                  backgroundColor: '#000000',
                  borderColor: 'var(--pt-accent-35)',
                  borderRadius: 'var(--pt-radius)',
                  boxShadow: 'var(--pt-shadow)',
                }}
              >
                {/* Desktop Video Box Header Bar */}
                {theme.showHeaderBar && (
                  <div
                    className="hidden lg:flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 border-b border-white/[0.08]"
                    style={{ backgroundColor: 'var(--pt-frame)' }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {theme.showBrandBadge && (
                        <span
                          className="inline-flex h-6 px-2 items-center gap-1.5 rounded-md text-[11px] font-black tracking-wide shrink-0 shadow-sm"
                          style={{
                            backgroundColor: 'var(--pt-accent)',
                            color: 'var(--pt-accent-contrast)',
                          }}
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span className="font-latin">{theme.brandLabel}</span>
                        </span>
                      )}
                      <div className="flex items-center gap-1.5 text-xs min-w-0">
                        <span className="font-extrabold text-white/95 tabular-nums">
                          سيرفر {safeServerIndex + 1}
                        </span>
                        <span className="text-white/25">·</span>
                        <span className="font-latin font-bold text-[#f9c400] text-[11px]">
                          {activeQuality}
                        </span>
                      </div>
                    </div>

                    {/* Sleek Unified Controls */}
                    <div className="flex items-center gap-1.5">
                      {effectiveShieldConfig.showPlayerBadge && finalStreamSrc && (
                        <button
                          type="button"
                          onClick={handleCycleShieldMode}
                          disabled={shieldDecision.mode === 'direct_media'}
                          title={`${shieldDecision.label} — ${shieldDecision.description}${
                            shieldDecision.mode !== 'direct_media'
                              ? ' (اضغط لتبديل وضع التوافق لهذا السيرفر)'
                              : ''
                          }`}
                          className={`hidden sm:inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] font-extrabold transition-colors cursor-pointer disabled:cursor-default ${
                            shieldDecision.mode === 'strict_sandbox' ||
                            shieldDecision.mode === 'direct_media'
                              ? 'bg-[#4CAF50]/15 border-[#4CAF50]/35 text-[#4CAF50] hover:bg-[#4CAF50]/25'
                              : shieldDecision.mode === 'redirect_guard'
                                ? 'bg-[#f9c400]/15 border-[#f9c400]/35 text-[#f9c400] hover:bg-[#f9c400]/25'
                                : 'bg-sky-500/15 border-sky-400/35 text-sky-300 hover:bg-sky-500/25'
                          }`}
                        >
                          {shieldDecision.mode === 'direct_unrestricted' ? (
                            <ShieldAlert className="w-3 h-3 shrink-0" />
                          ) : (
                            <ShieldCheck className="w-3 h-3 shrink-0" />
                          )}
                          <span>{shieldDecision.shortLabel}</span>
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={safeServerIndex <= 0}
                        onClick={() => handleManualServerSelect(Math.max(0, safeServerIndex - 1))}
                        title="السيرفر السابق"
                        aria-label="السيرفر السابق"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.06] border border-white/[0.08] text-white/85 hover:bg-white/[0.14] hover:text-white disabled:opacity-30 transition-colors cursor-pointer"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        disabled={safeServerIndex >= serversList.length - 1}
                        onClick={() =>
                          handleManualServerSelect(Math.min(serversList.length - 1, safeServerIndex + 1))
                        }
                        title="السيرفر التالي"
                        aria-label="السيرفر التالي"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.06] border border-white/[0.08] text-white/85 hover:bg-white/[0.14] hover:text-white disabled:opacity-30 transition-colors cursor-pointer"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setPlayerReloadKey((k) => k + 1)}
                        title="إعادة تحميل المشغل"
                        aria-label="إعادة تحميل المشغل"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.06] border border-white/[0.08] text-white/85 hover:bg-white/[0.14] hover:text-white transition-colors cursor-pointer"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setIsTheaterMode((t) => !t)}
                        title={isTheaterMode ? 'إظهار قائمة السيرفرات' : 'توسيع العرض'}
                        aria-label={isTheaterMode ? 'إظهار قائمة السيرفرات' : 'توسيع العرض'}
                        className={`hidden lg:inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[11px] font-bold transition-colors cursor-pointer ${
                          isTheaterMode
                            ? 'border-transparent'
                            : 'bg-white/[0.06] border-white/[0.08] text-white/85 hover:bg-white/[0.14] hover:text-white'
                        }`}
                        style={
                          isTheaterMode
                            ? {
                                backgroundColor: 'var(--pt-accent)',
                                color: 'var(--pt-accent-contrast)',
                              }
                            : undefined
                        }
                      >
                        <MonitorPlay className="w-3.5 h-3.5" />
                        <span>{isTheaterMode ? 'السيرفرات' : 'تكبير'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleToggleFullscreen()}
                        title="ملء الشاشة"
                        aria-label="ملء الشاشة"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-opacity hover:opacity-90 cursor-pointer"
                        style={{
                          backgroundColor: 'var(--pt-accent)',
                          color: 'var(--pt-accent-contrast)',
                        }}
                      >
                        {isFullscreen ? (
                          <Minimize2 className="w-3.5 h-3.5" />
                        ) : (
                          <Maximize2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Pure Edge-to-Edge 16:9 Video Stage (Landscape-Safe on Mobile) */}
                <div className="rtv-mobile-player-shell w-full bg-black">
                  <div className="rtv-mobile-player-stage relative aspect-video w-full bg-black overflow-hidden">
                    {isBlockedHomepageUrl || isActiveServerFaulty ? (
                      <div className="h-full w-full flex flex-col items-center justify-center p-4 sm:p-6 text-center bg-[#090d14] space-y-2.5 sm:space-y-3">
                        <div
                          className="inline-flex h-11 w-11 sm:h-14 sm:w-14 items-center justify-center rounded-2xl border"
                          style={{
                            backgroundColor: 'var(--pt-accent-12)',
                            borderColor: 'var(--pt-accent-35)',
                            color: 'var(--pt-accent)',
                          }}
                        >
                          <AlertTriangle className="w-5 h-5 sm:w-7 sm:h-7" />
                        </div>
                        <h4 className="font-display text-sm sm:text-base font-extrabold text-white">
                          {isBlockedHomepageUrl
                            ? 'الرابط غير صالح للمشاهدة'
                            : friendlyServerError.title}
                        </h4>
                        <p className="max-w-md text-xs text-[#b7c9ef] leading-relaxed">
                          {isBlockedHomepageUrl
                            ? `سيرفر ${safeServerIndex + 1} لا يعرض فيديو مباشراً. يمكنك تجربة سيرفر آخر.`
                            : friendlyServerError.subtitle}
                        </p>
                        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                          {serversList.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                handleManualServerSelect(
                                  healthyNextIdx !== -1
                                    ? healthyNextIdx
                                    : (safeServerIndex + 1) % serversList.length
                                )
                              }
                              className="inline-flex items-center gap-2 rounded-xl px-4 min-h-[42px] py-2 text-xs font-extrabold cursor-pointer"
                              style={{
                                backgroundColor: 'var(--pt-accent)',
                                color: 'var(--pt-accent-contrast)',
                              }}
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>تجربة سيرفر آخر</span>
                            </button>
                          )}
                          {!isBlockedHomepageUrl && (
                            <button
                              type="button"
                              onClick={() => {
                                setManualBypassFault((prev) => ({
                                  ...prev,
                                  [safeServerIndex]: true,
                                }));
                                setPlayerReloadKey((k) => k + 1);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-white/[0.08] border border-white/15 px-3.5 min-h-[42px] py-2 text-xs font-bold text-white/90 hover:bg-white/15 cursor-pointer"
                            >
                              <RotateCw className="w-3.5 h-3.5" />
                              <span>إعادة المحاولة</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ) : finalStreamSrc ? (
                      isDirectVideoFile ? (
                        <video
                          key={`${finalStreamSrc}-${playerReloadKey}`}
                          src={finalStreamSrc}
                          controls
                          autoPlay
                          playsInline
                          onError={() => handleServerFaultFailover(safeServerIndex, 'تعذر تحميل ملف الفيديو')}
                          className="h-full w-full max-w-full block bg-black"
                        />
                      ) : (
                        <iframe
                          key={`${finalStreamSrc}-${shieldDecision.mode}-${playerReloadKey}`}
                          src={finalStreamSrc}
                          title={`${item.title} - سيرفر ${safeServerIndex + 1}`}
                          sandbox={shieldDecision.sandboxAttr}
                          allowFullScreen
                          referrerPolicy="no-referrer"
                          onError={() => handleServerFaultFailover(safeServerIndex, 'تعذر تحميل المشغل المدمج')}
                          allow="autoplay; fullscreen; encrypted-media; picture-in-picture; accelerometer; gyroscope"
                          className="h-full w-full max-w-full block border-0 bg-black"
                        />
                      )
                    ) : (
                      <>
                        <img
                          src={item.backdrop || item.poster}
                          alt={item.title}
                          className={`h-full w-full object-cover opacity-80 transition-transform duration-[8000ms] ${
                            isPlaying ? 'scale-105' : 'scale-100'
                          }`}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/25 to-black/40" />

                        <div className="absolute top-3 left-3 flex items-center gap-2">
                          <span
                            className="font-latin rounded-lg px-2.5 py-1 text-[11px] font-black"
                            style={{
                              backgroundColor: 'var(--pt-accent)',
                              color: 'var(--pt-accent-contrast)',
                            }}
                          >
                            {activeQuality}
                          </span>
                        </div>

                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
                          <button
                            type="button"
                            onClick={() => setIsPlaying((p) => !p)}
                            className="inline-flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-full shadow-2xl hover:scale-105 transition-transform cursor-pointer"
                            style={{
                              backgroundColor: 'var(--pt-accent)',
                              color: 'var(--pt-accent-contrast)',
                            }}
                            aria-label={isPlaying ? 'إيقاف التشغيل' : 'استئناف التشغيل'}
                          >
                            {isPlaying ? <Pause className="w-6 h-6 sm:w-7 sm:h-7" /> : <Play className="w-6 h-6 sm:w-7 sm:h-7 fill-current" />}
                          </button>

                          {subtitleLang !== 'off' && (
                            <div className="mt-5 sm:mt-8 rounded-lg bg-black/75 px-3 py-1 text-xs sm:text-sm font-bold text-white border border-white/15">
                              {subtitleLang === 'ar'
                                ? `ترجمة عربية متزامنة — ${theme.brandLabel}`
                                : `English Subtitles Active — ${theme.brandLabel}`}
                            </div>
                          )}
                        </div>

                        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-2 bg-black/80 px-3 sm:px-4 py-2 sm:py-3 backdrop-blur-sm">
                          <div className="flex items-center gap-3 text-xs font-bold text-white">
                            <button
                              type="button"
                              onClick={() => setIsPlaying((p) => !p)}
                              className="hover:opacity-80 cursor-pointer"
                            >
                              {isPlaying ? 'إيقاف' : 'تشغيل'}
                            </button>
                            <span className="font-latin text-[#b7c9ef] tabular-nums">
                              {isPlaying ? '14:22' : '00:00'} / {item.duration}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 text-[11px] sm:text-xs">
                            <span className="text-[#b7c9ef] hidden sm:inline">الترجمة:</span>
                            {(
                              [
                                { id: 'ar', label: 'العربية' },
                                { id: 'en', label: 'English' },
                                { id: 'off', label: 'إيقاف' },
                              ] as const
                            ).map((sub) => (
                              <button
                                key={sub.id}
                                type="button"
                                onClick={() => setSubtitleLang(sub.id)}
                                className={`rounded-lg px-2 py-1 font-bold cursor-pointer ${
                                  subtitleLang === sub.id
                                    ? ''
                                    : 'bg-white/10 text-[#b7c9ef] hover:text-white'
                                }`}
                                style={
                                  subtitleLang === sub.id
                                    ? {
                                        backgroundColor: 'var(--pt-accent)',
                                        color: 'var(--pt-accent-contrast)',
                                      }
                                    : undefined
                                }
                              >
                                {sub.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Desktop Video Box Footer Bar */}
                {theme.showFooterBar && (
                  <div
                    className="hidden lg:flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 border-t border-white/[0.08] text-[11px]"
                    style={{ backgroundColor: 'var(--pt-frame)' }}
                  >
                    <div className="flex items-center gap-2 text-[#9fb2d4]">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--pt-accent)' }} />
                      <span>
                        مشغّل <strong className="text-white">{theme.brandLabel}</strong> المحمي — إذا تعذر التحميل بدّل للسيرفر التالي
                      </span>
                    </div>
                    {serversList.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          handleManualServerSelect((safeServerIndex + 1) % serversList.length)
                        }
                        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-extrabold transition-opacity hover:opacity-90 cursor-pointer"
                        style={{
                          backgroundColor: 'var(--pt-accent)',
                          color: 'var(--pt-accent-contrast)',
                        }}
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>السيرفر التالي</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Mobile Prominent "تغيير السيرفر" Bar Directly Below Player */}
              <div
                className="flex lg:hidden items-center justify-between gap-2 px-3 py-2.5 border-b border-white/[0.08]"
                style={{ backgroundColor: 'var(--pt-frame)' }}
              >
                <div className="flex items-center gap-2 min-w-0 text-xs">
                  <span className="font-extrabold text-white tabular-nums">
                    سيرفر {safeServerIndex + 1}
                  </span>
                  <span className="text-white/30">·</span>
                  <span className="font-latin font-black text-[#f9c400] text-[11px]">
                    {activeQuality}
                  </span>
                  {activeFilterEntry && (
                    <>
                      <span className="text-white/30">·</span>
                      <span
                        className={`text-[11px] font-bold ${
                          activeFilterEntry.ok ? 'text-[#4CAF50]' : 'text-[#ff8a88]'
                        }`}
                      >
                        {activeFilterEntry.ok ? 'متاح' : friendlyServerError.shortStatus}
                      </span>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleSwitchToNextServer}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3.5 min-h-[40px] py-1.5 text-xs font-extrabold transition-opacity active:scale-95 shrink-0 cursor-pointer"
                  style={{
                    backgroundColor: 'var(--pt-accent)',
                    color: 'var(--pt-accent-contrast)',
                  }}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>{serversList.length > 1 ? 'تغيير السيرفر' : 'إعادة التحميل'}</span>
                </button>
              </div>

              {/* Desktop Series Episodes Switcher */}
              {episodes.length > 0 && (
                <div
                  className="hidden lg:block rounded-xl border border-white/[0.08] p-3"
                  style={{ backgroundColor: 'var(--pt-frame)' }}
                >
                  <p className="text-xs font-extrabold text-white mb-2">التنقل السريع بين الحلقات:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {episodes.map((ep) => {
                      const epSrvCount = ep.servers?.length || 0;
                      return (
                        <button
                          key={ep.number}
                          type="button"
                          onClick={() => {
                            setEpisodeNum(ep.number);
                            setSelectedServer(0);
                            setFilterMap({});
                            setFilterAlert(null);
                            setManualBypassFault({});
                            setPlayerReloadKey((k) => k + 1);
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                            episodeNum === ep.number
                              ? ''
                              : 'bg-white/[0.05] text-[#b7c9ef] border border-white/10 hover:text-white'
                          }`}
                          style={
                            episodeNum === ep.number
                              ? {
                                  backgroundColor: 'var(--pt-accent)',
                                  color: 'var(--pt-accent-contrast)',
                                }
                              : undefined
                          }
                        >
                          <span>الحلقة {String(ep.number).padStart(2, '0')}</span>
                          {epSrvCount > 0 && (
                            <span className="font-latin rounded bg-black/25 px-1.5 py-0.5 text-[10px] font-black tabular-nums">
                              {epSrvCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Mobile Movie Info, Watchlist & Share, Seasons/Episodes, & Collapsible Details */}
            <div className="order-3 lg:hidden px-3 pt-3 pb-[max(2rem,env(safe-area-inset-bottom))] space-y-3">
              {/* Movie Title + Concise Year & Rating */}
              <div
                className="rounded-2xl border border-white/[0.08] p-3.5 space-y-3"
                style={{ backgroundColor: 'var(--pt-frame)' }}
              >
                <div className="space-y-1">
                  <h2 className="font-display text-base font-extrabold text-white leading-snug">
                    {item.title}
                    {episodes.length > 0 ? ` — الحلقة ${String(episodeNum).padStart(2, '0')}` : ''}
                  </h2>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-[#b7c9ef]">
                    <span className="font-latin tabular-nums text-white/90">{item.year}</span>
                    <span className="text-white/30">·</span>
                    <span className="inline-flex items-center gap-1 font-latin tabular-nums text-[#f9c400]">
                      <Star className="w-3.5 h-3.5 fill-current" />
                      <span>{item.imdb.toFixed(1)}</span>
                    </span>
                    <span className="text-white/30">·</span>
                    <span className="font-latin text-white/90">{item.quality}</span>
                    {item.duration && (
                      <>
                        <span className="text-white/30">·</span>
                        <span>{item.duration}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Organized Favorites & Share Row */}
                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => onToggleWatchlist?.(item)}
                    className={`flex items-center justify-center gap-2 rounded-xl border min-h-[44px] px-3 py-2 text-xs font-extrabold transition-colors cursor-pointer ${
                      isInWatchlist
                        ? 'bg-[#4CAF50]/20 border-[#4CAF50]/60 text-[#4CAF50]'
                        : 'bg-white/[0.05] border-white/10 text-white hover:bg-white/10'
                    }`}
                  >
                    {isInWatchlist ? <Check className="w-4 h-4 shrink-0" /> : <Bookmark className="w-4 h-4 shrink-0" />}
                    <span>{isInWatchlist ? 'في المفضلة' : 'إضافة للمفضلة'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleShareMedia()}
                    className="flex items-center justify-center gap-2 rounded-xl bg-white/[0.05] border border-white/10 min-h-[44px] px-3 py-2 text-xs font-extrabold text-white hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <Share2 className="w-4 h-4 shrink-0" />
                    <span>مشاركة</span>
                  </button>
                </div>
              </div>

              {/* Mobile Seasons & Episodes Organization */}
              {episodes.length > 0 && (
                <div
                  className="rounded-2xl border border-white/[0.08] p-3 space-y-2.5"
                  style={{ backgroundColor: 'var(--pt-frame)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-white">
                      <Tv className="w-3.5 h-3.5 text-[#f9c400]" />
                      <span>الحلقات ({episodes.length})</span>
                    </span>
                    {seasons.length > 1 && (
                      <span className="text-[11px] font-bold text-[#9fb2d4]">
                        {seasons[seasonIdx]?.label}
                      </span>
                    )}
                  </div>

                  {seasons.length > 1 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                      {seasons.map((s, sIdx) => (
                        <button
                          key={s.seasonNumber}
                          type="button"
                          onClick={() => {
                            setSeasonIdx(sIdx);
                            const firstEp = s.episodes?.[0]?.number || 1;
                            setEpisodeNum(firstEp);
                            setSelectedServer(0);
                            setFilterMap({});
                            setFilterAlert(null);
                            setManualBypassFault({});
                            setPlayerReloadKey((k) => k + 1);
                          }}
                          className={`shrink-0 rounded-xl px-3 min-h-[38px] py-1.5 text-xs font-extrabold border transition-colors cursor-pointer ${
                            seasonIdx === sIdx
                              ? 'border-transparent'
                              : 'bg-white/[0.04] border-white/10 text-[#b7c9ef]'
                          }`}
                          style={
                            seasonIdx === sIdx
                              ? {
                                  backgroundColor: 'var(--pt-accent)',
                                  color: 'var(--pt-accent-contrast)',
                                }
                              : undefined
                          }
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-3 min-[390px]:grid-cols-4 gap-2 max-h-52 overflow-y-auto">
                    {episodes.map((ep) => {
                      const isEpActive = episodeNum === ep.number;
                      return (
                        <button
                          key={ep.number}
                          type="button"
                          onClick={() => {
                            setEpisodeNum(ep.number);
                            setSelectedServer(0);
                            setFilterMap({});
                            setFilterAlert(null);
                            setManualBypassFault({});
                            setPlayerReloadKey((k) => k + 1);
                          }}
                          className={`flex items-center justify-center rounded-xl border min-h-[44px] px-2 py-2 text-xs font-extrabold transition-colors cursor-pointer tabular-nums ${
                            isEpActive
                              ? 'border-transparent shadow-md'
                              : 'bg-white/[0.04] border-white/10 text-[#b7c9ef]'
                          }`}
                          style={
                            isEpActive
                              ? {
                                  backgroundColor: 'var(--pt-accent)',
                                  color: 'var(--pt-accent-contrast)',
                                }
                              : undefined
                          }
                        >
                          حلقة {String(ep.number).padStart(2, '0')}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Collapsible Secondary Details */}
              <div
                className="rounded-2xl border border-white/[0.08] overflow-hidden"
                style={{ backgroundColor: 'var(--pt-frame)' }}
              >
                <button
                  type="button"
                  onClick={() => setShowMobileDetails((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 px-3.5 min-h-[46px] py-2.5 text-xs font-extrabold text-white cursor-pointer"
                >
                  <span>تفاصيل القصة والعمل</span>
                  {showMobileDetails ? (
                    <ChevronUp className="w-4 h-4 text-[#9fb2d4]" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[#9fb2d4]" />
                  )}
                </button>

                {showMobileDetails && (
                  <div className="px-3.5 pb-3.5 pt-1 space-y-3 border-t border-white/[0.06] text-xs">
                    {item.story && (
                      <p className="text-[#b7c9ef] leading-relaxed">{item.story}</p>
                    )}
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded-xl bg-black/25 px-3 py-2">
                        <span className="block text-[#9fb2d4] mb-0.5">التصنيف</span>
                        <span className="font-bold text-white">{item.categories[0]}</span>
                      </div>
                      <div className="rounded-xl bg-black/25 px-3 py-2">
                        <span className="block text-[#9fb2d4] mb-0.5">النوع</span>
                        <span className="font-bold text-white">{item.genres.slice(0, 2).join(' · ')}</span>
                      </div>
                      <div className="rounded-xl bg-black/25 px-3 py-2">
                        <span className="block text-[#9fb2d4] mb-0.5">اللغة</span>
                        <span className="font-bold text-white">{item.language}</span>
                      </div>
                      <div className="rounded-xl bg-black/25 px-3 py-2">
                        <span className="block text-[#9fb2d4] mb-0.5">الدولة</span>
                        <span className="font-bold text-white">{item.country}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Email/Password Auth Login Modal ---------------- */
interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  firebaseUser: User | null;
  isAdmin: boolean;
  adminRole?: AdminPrivilegeRole | null;
  onLogout: () => Promise<void>;
  onOpenAdmin: () => void;
  onNotify?: (msg: string) => void;
}

export function LoginModal({
  isOpen,
  onClose,
  firebaseUser,
  isAdmin,
  adminRole,
  onLogout,
  onOpenAdmin,
  onNotify,
}: LoginModalProps) {
  const [signingIn, setSigningIn] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) {
      setAuthError('يرجى إدخال اسم المستخدم أو البريد الإلكتروني وكلمة المرور.');
      return;
    }
    setAuthError(null);
    setSigningIn(true);
    try {
      if (mode === 'login') {
        const cred = await signInWithEmailPassword(identifier, password);
        onNotify?.(`مرحبًا بك يا ${cred.user.displayName || cred.user.email || 'مستخدم'} في RahaL TV`);
      } else {
        const cred = await registerMemberWithEmailPassword(identifier, password, displayName);
        onNotify?.(`تم إنشاء حسابك بنجاح، أهلاً بك ${cred.user.displayName || ''}`);
      }
      setPassword('');
      onClose();
    } catch (err: unknown) {
      setAuthError(getFirebaseAuthErrorMessage(err));
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-3xl bg-[#0c1821] border border-white/10 p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-lg font-extrabold text-white">
            {firebaseUser
              ? 'حسابي على RahaL TV'
              : mode === 'login'
                ? 'تسجيل الدخول إلى RahaL TV'
                : 'إنشاء حساب جديد'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-white hover:bg-[#D92321] cursor-pointer"
            aria-label="إغلاق نافذة الحساب"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {firebaseUser ? (
          <div className="space-y-4 text-center">
            {firebaseUser.photoURL ? (
              <img
                src={firebaseUser.photoURL}
                alt={firebaseUser.displayName || 'User'}
                referrerPolicy="no-referrer"
                className="mx-auto h-16 w-16 rounded-2xl object-cover border-2 border-[#D92321]"
              />
            ) : (
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#D92321]/20 border border-[#D92321] text-xl font-black text-white">
                {(firebaseUser.displayName || firebaseUser.email || 'RT').slice(0, 2).toUpperCase()}
              </div>
            )}

            <div>
              <p className="text-base font-extrabold text-white">
                أهلاً بك، {firebaseUser.displayName || 'عضو RahaL TV'}
              </p>
              <p className="text-xs text-[#b7c9ef] mt-1">{firebaseUser.email}</p>
              {isAdmin && (
                <span
                  className={`mt-2 inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-black border ${
                    adminRole === 'moderator'
                      ? 'bg-sky-500/15 border-sky-400/40 text-sky-300'
                      : 'bg-[#f9c400]/15 border-[#f9c400]/40 text-[#f9c400]'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {adminRole === 'moderator'
                    ? 'مشرف — النشر والتعديل والجلب'
                    : 'مسؤول — صلاحيات كاملة'}
                </span>
              )}
            </div>

            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAdmin();
                }}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#f9c400] hover:bg-[#dfb20b] py-3 text-xs font-black text-[#06131c] transition-colors cursor-pointer"
              >
                <LayoutDashboard className="w-4 h-4" />
                <span>فتح لوحة تحكم الإدارة</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                void onLogout();
                onClose();
              }}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 hover:bg-[#D92321] py-3 text-xs font-extrabold text-white transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3.5">
            <p className="text-xs text-[#b7c9ef] leading-relaxed">
              {mode === 'login'
                ? 'أدخل البريد الإلكتروني (أو اسم المستخدم) وكلمة المرور للدخول إلى حسابك أو لوحة الإدارة.'
                : 'أنشئ حسابًا جديدًا بالبريد الإلكتروني وكلمة المرور لحفظ قائمتك ومتابعة طلباتك.'}
            </p>

            {mode === 'register' && (
              <div>
                <label className="block text-xs font-bold text-[#b7c9ef] mb-1">الاسم</label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="مثال: رحال أحمد"
                  className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-sm text-white focus:border-[#D92321] focus:outline-none"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-[#b7c9ef] mb-1">
                البريد الإلكتروني أو اسم المستخدم
              </label>
              <input
                type="text"
                required
                dir="ltr"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="admin@rahaltv.com أو admin"
                className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-sm text-white focus:border-[#D92321] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#b7c9ef] mb-1">كلمة المرور</label>
              <input
                type="password"
                required
                minLength={6}
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-sm text-white focus:border-[#D92321] focus:outline-none"
              />
            </div>

            {authError && (
              <div className="rounded-xl bg-[#D92321]/15 border border-[#D92321]/40 p-3 text-xs text-red-200 leading-relaxed">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={signingIn}
              className="w-full inline-flex items-center justify-center gap-2.5 rounded-xl bg-[#D92321] hover:bg-[#dc0e30] disabled:opacity-60 py-3.5 text-sm font-extrabold text-white shadow-lg transition-colors cursor-pointer"
            >
              <ShieldCheck className="w-5 h-5" />
              <span>
                {signingIn
                  ? 'جاري المعالجة...'
                  : mode === 'login'
                    ? 'تسجيل الدخول'
                    : 'إنشاء الحساب'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setAuthError(null);
                setMode((m) => (m === 'login' ? 'register' : 'login'));
              }}
              className="w-full text-center text-xs font-bold text-[#b7c9ef] hover:text-white pt-1 cursor-pointer"
            >
              {mode === 'login'
                ? 'ليس لديك حساب؟ إنشاء حساب عضو جديد'
                : 'لديك حساب بالفعل؟ العودة لتسجيل الدخول'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/* ---------------- Footer Topics & Visitor Requests Modal ---------------- */
interface FooterInfoModalProps {
  topic: FooterTopic | null;
  onClose: () => void;
  firebaseUser: User | null;
  onOpenLogin: () => void;
  requests: VisitorRequest[];
  onAddRequest: (req: { title: string; type: VisitorRequest['type']; notes: string }) => Promise<void>;
}

export function FooterInfoModal({
  topic,
  onClose,
  firebaseUser,
  onOpenLogin,
  requests,
  onAddRequest,
}: FooterInfoModalProps) {
  const [reqTitle, setReqTitle] = useState('');
  const [reqType, setReqType] = useState<VisitorRequest['type']>('فيلم');
  const [reqNotes, setReqNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (!topic) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reqTitle.trim() || !firebaseUser) return;
    setSubmitting(true);
    try {
      await onAddRequest({ title: reqTitle.trim(), type: reqType, notes: reqNotes.trim() });
      setReqTitle('');
      setReqNotes('');
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 3000);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xl rounded-3xl bg-[#0c1821] border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between bg-[#1a242e] px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            {topic === 'requests' ? (
              <Sparkles className="w-5 h-5 text-[#4CAF50]" />
            ) : topic === 'community' ? (
              <Users className="w-5 h-5 text-[#D92321]" />
            ) : (
              <ShieldCheck className="w-5 h-5 text-[#f9c400]" />
            )}
            <h2 className="font-display text-lg font-extrabold text-white">
              {topic === 'terms' && 'سياسة الاستخدام'}
              {topic === 'privacy' && 'سياسة الخصوصية'}
              {topic === 'community' && 'مجتمع RahaL TV'}
              {topic === 'requests' && 'اتصل بنا وطلبات الزوار — اطلب فيلمك أو مسلسلك'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-white hover:bg-[#D92321] cursor-pointer"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 max-h-[70vh] overflow-y-auto space-y-4 text-sm leading-relaxed text-[#b7c9ef]">
          {topic === 'terms' && (
            <>
              <p className="text-white font-bold">مرحبًا بك في منصة RahaL TV الترفيهية.</p>
              <p>
                تتيح المنصة فهرسة واستعراض أحدث الأفلام والمسلسلات العربية والعالمية وعروض
                المصارعة بجودات متعددة، مع مراعاة قواعد الاستخدام الآمن وعدم إعادة نشر المحتوى
                لأغراض تجارية.
              </p>
              <p>
                يتم تحديث السيرفرات يوميًا لضمان استقرار المشاهدة وتوفير روابط تحميل مباشرة خالية
                من الأعطال.
              </p>
            </>
          )}

          {topic === 'privacy' && (
            <>
              <p className="text-white font-bold">حماية خصوصية الزوار أولوية أساسية لدينا.</p>
              <p>
                تُحفظ قائمة المشاهدة (قائمتي) وتفضيلات البحث محليًا على جهازك فقط دون تتبع بيانات
                حساسة أو مشاركتها مع أي طرف خارجي.
              </p>
            </>
          )}

          {topic === 'community' && (
            <>
              <p className="text-white font-bold">انضم إلى مجتمع عشاق السينما والدراما على RahaL TV.</p>
              <p>
                يمكنك متابعة أحدث إصدارات رمضان 2026، وتقييمات IMDb المحدثة يوميًا، وترشيح الأعمال
                المفضلة ليتم إضافتها في قائمة العروض المثبتة.
              </p>
            </>
          )}

          {topic === 'requests' && (
            <div className="space-y-5">
              {!firebaseUser ? (
                <div className="rounded-2xl bg-[#1a242e] border border-white/10 p-5 text-center space-y-3">
                  <p className="text-sm font-bold text-white">
                    سجّل الدخول بحسابك لإرسال طلبك ومتابعة حالة تنفيذه في قاعدة البيانات
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenLogin();
                    }}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#D92321] hover:bg-[#dc0e30] px-5 py-2.5 text-xs font-extrabold text-white cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>تسجيل الدخول</span>
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold text-white mb-1">اسم العمل المطلوب</label>
                      <input
                        type="text"
                        required
                        value={reqTitle}
                        onChange={(e) => setReqTitle(e.target.value)}
                        placeholder="مثال: فيلم Dune Part Three"
                        className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-sm text-white focus:border-[#4CAF50] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-white mb-1">النوع</label>
                      <select
                        value={reqType}
                        onChange={(e) => setReqType(e.target.value as VisitorRequest['type'])}
                        className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2.5 text-sm text-white focus:border-[#4CAF50] focus:outline-none"
                      >
                        <option value="فيلم">فيلم</option>
                        <option value="مسلسل">مسلسل</option>
                        <option value="عرض مصارعة">عرض مصارعة</option>
                        <option value="مسرحية">مسرحية</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-white mb-1">
                      ملاحظات أو سنة الإصدار (اختياري)
                    </label>
                    <input
                      type="text"
                      value={reqNotes}
                      onChange={(e) => setReqNotes(e.target.value)}
                      placeholder="يفضل جودة BluRay 1080p مترجم"
                      className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-sm text-white focus:border-[#4CAF50] focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] px-5 py-2.5 text-xs font-extrabold text-white transition-colors cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                    <span>{submitting ? 'جاري الإرسال...' : 'إرسال الطلب لإدارة RahaL TV'}</span>
                  </button>
                  {submitted && (
                    <p className="inline-flex items-center gap-1.5 mr-3 text-xs font-bold text-[#4CAF50]">
                      <CheckCircle2 className="w-4 h-4" />
                      تم حفظ طلبك في قاعدة البيانات!
                    </p>
                  )}
                </form>
              )}

              {requests.length > 0 && (
                <div className="border-t border-white/10 pt-4">
                  <p className="text-xs font-extrabold text-white mb-2.5">
                    طلباتك المسجلة ({requests.length}):
                  </p>
                  <div className="space-y-2">
                    {requests.map((req) => (
                      <div
                        key={req.id}
                        className="rounded-xl bg-[#1a242e] px-3.5 py-2.5 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <span className="font-bold text-white">{req.title}</span>
                            {req.notes && <span className="text-[#b7c9ef] mr-2">— {req.notes}</span>}
                          </div>
                          <span className="rounded-md bg-[#4CAF50]/20 px-2 py-0.5 font-bold text-[#4CAF50] shrink-0">
                            {req.status === 'completed'
                              ? 'تمت الإضافة'
                              : req.status === 'approved'
                                ? 'موافق عليه'
                                : req.status === 'rejected'
                                  ? 'مرفوض'
                                  : 'قيد المراجعة'}
                          </span>
                        </div>
                        {req.adminNote && (
                          <p className="text-[11px] text-[#f9c400]">رد الإدارة: {req.adminNote}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
