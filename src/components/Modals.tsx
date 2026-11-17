import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
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
  ShieldCheck,
  Sparkles,
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
import { MediaItem, PlayerThemeConfig, VisitorRequest } from '../types/media';
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
                      src={item.poster}
                      alt={item.title}
                      className="h-18 w-14 rounded-xl object-cover shrink-0"
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

export function TrailerModal({ item, playerTheme, onClose, onWatchFull }: TrailerModalProps) {
  const [playing, setPlaying] = useState(true);
  if (!item) return null;

  const theme = normalizePlayerTheme(playerTheme || loadStoredPlayerTheme());
  const themeVars = buildPlayerThemeVars(theme);
  const parsedTrailer = normalizeTrailerUrl(item.trailerUrl);

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
                src={parsedTrailer.src}
                title={item.trailerLabel}
                allowFullScreen
                allow="autoplay; fullscreen; picture-in-picture"
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
                  <span className="font-latin tabular-nums">
                    {playing ? '00:48' : '00:00'} / {item.trailerDuration}
                  </span>
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
  onClose,
}: PlayerModalProps) {
  const [selectedServer, setSelectedServer] = useState(initialServerIndex);
  const [subtitleLang, setSubtitleLang] = useState<'ar' | 'en' | 'off'>('ar');
  const [isPlaying, setIsPlaying] = useState(true);
  const [episodeNum, setEpisodeNum] = useState(initialEpisode);

  // Server Filtering system states
  const [filterMap, setFilterMap] = useState<Record<number, ServerFilterEntry>>({});
  const [isFiltering, setIsFiltering] = useState(false);
  const [filterAlert, setFilterAlert] = useState<{
    kind: 'switched' | 'warning';
    message: string;
  } | null>(null);
  const [bypassEpisodeSrc, setBypassEpisodeSrc] = useState(false);
  const [playerReloadKey, setPlayerReloadKey] = useState(0);
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const playerBoxRef = useRef<HTMLDivElement | null>(null);

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
    setEpisodeNum(initialEpisode);
    setSelectedServer(initialServerIndex);
    setFilterMap({});
    setFilterAlert(null);
    setBypassEpisodeSrc(false);
    setPlayerReloadKey(0);
  }, [item?.id, initialEpisode, initialServerIndex]);

  // Helper to mark a server faulty at runtime and auto-switch to next healthy server
  const handleServerFaultFailover = useCallback(
    (faultIdx: number, reason: string) => {
      if (!item) return;
      const epList = item.seasons?.[0]?.episodes || [];
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
              : /sandbox/i.test(reason)
                ? 'sandboxed_embed'
                : 'error',
            httpStatus: reason.includes('403') ? 403 : 0,
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
            message: `تنبيه: سيرفر ${faultIdx + 1} به عطل (${reason}) — تم التبديل تلقائياً إلى سيرفر ${candidateIdx + 1}.`,
          });
        } else {
          setFilterAlert({
            kind: 'warning',
            message: `تنبيه: سيرفر ${faultIdx + 1} به عطل (${reason}).`,
          });
        }

        return next;
      });
    },
    [item, episodeNum]
  );

  // Proactive Server Filtering scan on open / episode change (backend + browser/Worker fallback)
  useEffect(() => {
    if (!item) return;

    const episodesList = item.seasons?.[0]?.episodes || [];
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
        const faultySummaries: string[] = [];

        targetServers.forEach((_, idx) => {
          const entry = filterResults?.[idx];
          if (entry) {
            nextMap[idx] = entry;
            if (!entry.ok) {
              faultySummaries.push(`سيرفر ${idx + 1} (${entry.reason})`);
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
            message: `تنبيه: رابط الحلقة الأساسي به عطل (${epResult.reason}) — تم التبديل تلقائياً إلى سيرفر ${firstHealthyIdx + 1}.`,
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
              message: `تنبيه: سيرفر ${safeCurrentIdx + 1} به عطل (${activeEntry.reason}) — تم التبديل تلقائياً إلى سيرفر ${firstHealthyIdx + 1}.`,
            });
          } else {
            setFilterAlert({
              kind: 'warning',
              message: `تنبيه: سيرفر ${safeCurrentIdx + 1} به عطل (${activeEntry.reason}).`,
            });
          }
        } else if (faultySummaries.length > 0) {
          setFilterAlert({
            kind: 'warning',
            message: `تنبيه تصفية السيرفرات: تم استبعاد ${faultySummaries[0]} تلقائياً.`,
          });
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
  }, [item?.id, episodeNum, initialServerIndex]);

  // Listen for postMessage cues from embedded players reporting sandboxed embed or 403 errors
  useEffect(() => {
    if (!item) return;
    const onMessage = (event: MessageEvent) => {
      const payload = typeof event.data === 'string' ? event.data : JSON.stringify(event.data || '');
      if (/sandboxed\s*embed|error\s*403|403\s*forbidden/i.test(payload)) {
        handleServerFaultFailover(
          selectedServer,
          /sandbox/i.test(payload) ? 'رسالة Sandboxed embed' : 'خطأ 403'
        );
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [item?.id, selectedServer, handleServerFaultFailover]);

  if (!item) return null;

  const episodes = item.seasons?.[0]?.episodes || [];
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
  const isDirectVideoFile = Boolean(finalStreamSrc && /\.(mp4|webm|ogg|m3u8)(\?|$)/i.test(finalStreamSrc));

  const handleManualServerSelect = (idx: number) => {
    const entry = filterMap[idx];
    if (entry && !entry.ok) {
      const healthyAlt = serversList.findIndex((_, i) => i !== idx && filterMap[i]?.ok === true);
      if (healthyAlt !== -1) {
        setSelectedServer(healthyAlt);
        setFilterAlert({
          kind: 'switched',
          message: `سيرفر ${idx + 1} معطل حالياً (${entry.reason}) — تم تحويلك تلقائياً إلى سيرفر ${healthyAlt + 1}.`,
        });
        return;
      }
      setFilterAlert({
        kind: 'warning',
        message: `تنبيه: سيرفر ${idx + 1} غير صالح (${entry.reason}).`,
      });
    }
    setSelectedServer(idx);
  };

  const theme = normalizePlayerTheme(playerTheme || loadStoredPlayerTheme());
  const themeVars = buildPlayerThemeVars(theme);

  const healthyNextIdx = serversList.findIndex(
    (_, idx) => idx !== selectedServer && filterMap[idx]?.ok !== false
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4" style={themeVars}>
      <div className="fixed inset-0 bg-black/90 backdrop-blur-md" onClick={onClose} />
      <div
        className="relative z-10 w-[96vw] max-w-[1340px] border border-white/[0.09] shadow-2xl overflow-hidden max-h-[95vh] flex flex-col"
        style={{
          backgroundColor: 'var(--pt-modal)',
          borderRadius: 'var(--pt-radius)',
        }}
      >
        {/* Clean Unified Modal Top Bar */}
        <div
          className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-white/[0.08]"
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
              <h3 className="font-display text-xs sm:text-sm font-extrabold text-white truncate">
                {item.title}
                {item.kind === 'series' ? ` — الحلقة ${String(episodeNum).padStart(2, '0')}` : ''}
              </h3>
              <p className="text-[11px] text-[#9fb2d4] flex items-center gap-1.5 tabular-nums">
                <span className="font-extrabold text-white">سيرفر {selectedServer + 1}</span>
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

        {/* Auto Server Filtering Alert Banner */}
        {filterAlert && (
          <div
            className={`flex items-center justify-between gap-3 px-4 py-2 text-xs font-bold border-b ${
              filterAlert.kind === 'switched'
                ? 'bg-[#f9c400]/10 border-[#f9c400]/25 text-[#f9c400]'
                : 'bg-[#D92321]/12 border-[#D92321]/25 text-[#ff9b99]'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="truncate sm:whitespace-normal">{filterAlert.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setFilterAlert(null)}
              className="rounded p-0.5 hover:bg-white/10 cursor-pointer shrink-0"
              aria-label="إخفاء التنبيه"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Main Body: Server Rail + Sleek Custom-Themed Video Stage */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">
          <div
            className={`grid grid-cols-1 gap-3.5 items-start ${
              isTheaterMode ? 'lg:grid-cols-1' : 'lg:grid-cols-[200px_minmax(0,1fr)]'
            }`}
          >
            {/* Right Sidebar: Strict سيرفر 1, سيرفر 2 ... */}
            {!isTheaterMode && (
              <aside
                className="rounded-xl border border-white/[0.08] p-2.5 space-y-2"
                style={{ backgroundColor: 'var(--pt-frame)' }}
              >
                <div className="flex items-center justify-between px-1 pb-1 border-b border-white/[0.06]">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold text-white">
                    <Server className="w-3.5 h-3.5" style={{ color: 'var(--pt-accent)' }} />
                    <span>سيرفرات المشاهدة</span>
                  </span>
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

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-1 gap-1.5 lg:max-h-[580px] lg:overflow-y-auto">
                  {serversList.map((srv, idx) => {
                    const isActive = selectedServer === idx;
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
                            ? `عطل في سيرفر ${idx + 1}: ${srvFilter?.reason}`
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
                        className={`moov-server-enter group flex items-center justify-between gap-1.5 rounded-lg border px-2.5 py-2 transition-all duration-200 cursor-pointer ${
                          isActive
                            ? 'shadow-lg font-black'
                            : isBroken
                              ? 'bg-[#D92321]/10 border-[#D92321]/25 text-[#ff9d9b] opacity-70 hover:opacity-100'
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

            {/* Main Area: Sleek Custom-Themed Video Box + Series Episodes */}
            <div className="min-w-0 space-y-3">
              <div
                ref={playerBoxRef}
                className="border overflow-hidden transition-all"
                style={{
                  backgroundColor: '#000000',
                  borderColor: 'var(--pt-accent-35)',
                  borderRadius: 'var(--pt-radius)',
                  boxShadow: 'var(--pt-shadow)',
                }}
              >
                {/* Harmonious Obsidian Video Box Header Bar */}
                {theme.showHeaderBar && (
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 border-b border-white/[0.08]"
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
                          سيرفر {selectedServer + 1}
                        </span>
                        <span className="text-white/25">·</span>
                        <span className="font-latin font-bold text-[#f9c400] text-[11px]">
                          {activeQuality}
                        </span>
                      </div>
                    </div>

                    {/* Sleek Unified Controls */}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={selectedServer <= 0}
                        onClick={() => handleManualServerSelect(Math.max(0, selectedServer - 1))}
                        title="السيرفر السابق"
                        aria-label="السيرفر السابق"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.06] border border-white/[0.08] text-white/85 hover:bg-white/[0.14] hover:text-white disabled:opacity-30 transition-colors cursor-pointer"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        disabled={selectedServer >= serversList.length - 1}
                        onClick={() =>
                          handleManualServerSelect(Math.min(serversList.length - 1, selectedServer + 1))
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

                {/* Pure Edge-to-Edge 16:9 Video Stage */}
                <div className="relative aspect-video w-full bg-black overflow-hidden">
                  {isBlockedHomepageUrl ? (
                    <div className="h-full w-full flex flex-col items-center justify-center p-6 text-center bg-[#090d14] space-y-3">
                      <div
                        className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border"
                        style={{
                          backgroundColor: 'var(--pt-accent-12)',
                          borderColor: 'var(--pt-accent-35)',
                          color: 'var(--pt-accent)',
                        }}
                      >
                        <AlertTriangle className="w-7 h-7" />
                      </div>
                      <h4 className="font-display text-base font-extrabold text-white">
                        تم حظر هذا الرابط تلقائياً داخل المشغل
                      </h4>
                      <p className="max-w-md text-xs text-[#b7c9ef] leading-relaxed">
                        اكتشف نظام الحماية أن سيرفر {selectedServer + 1} يفتح صفحة موقع خارجي وليس ملف فيديو فعلي.
                      </p>
                      {healthyNextIdx !== -1 && (
                        <button
                          type="button"
                          onClick={() => handleManualServerSelect(healthyNextIdx)}
                          className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-xs font-extrabold cursor-pointer"
                          style={{
                            backgroundColor: 'var(--pt-accent)',
                            color: 'var(--pt-accent-contrast)',
                          }}
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>الانتقال إلى سيرفر {healthyNextIdx + 1}</span>
                        </button>
                      )}
                    </div>
                  ) : finalStreamSrc ? (
                    isDirectVideoFile ? (
                      <video
                        key={`${finalStreamSrc}-${playerReloadKey}`}
                        src={finalStreamSrc}
                        controls
                        autoPlay
                        playsInline
                        onError={() => handleServerFaultFailover(selectedServer, 'تعذر تحميل ملف الفيديو')}
                        className="h-full w-full bg-black"
                      />
                    ) : (
                      <iframe
                        key={`${finalStreamSrc}-${playerReloadKey}`}
                        src={finalStreamSrc}
                        title={`${item.title} - سيرفر ${selectedServer + 1}`}
                        allowFullScreen
                        referrerPolicy="no-referrer"
                        onError={() => handleServerFaultFailover(selectedServer, 'تعذر تحميل المشغل المدمج')}
                        allow="autoplay; fullscreen; encrypted-media; picture-in-picture; accelerometer; gyroscope"
                        className="h-full w-full border-0 bg-black"
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

                      <div className="absolute top-4 left-4 flex items-center gap-2">
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
                          className="inline-flex h-16 w-16 items-center justify-center rounded-full shadow-2xl hover:scale-105 transition-transform cursor-pointer"
                          style={{
                            backgroundColor: 'var(--pt-accent)',
                            color: 'var(--pt-accent-contrast)',
                          }}
                          aria-label={isPlaying ? 'إيقاف التشغيل' : 'استئناف التشغيل'}
                        >
                          {isPlaying ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 fill-current" />}
                        </button>

                        {subtitleLang !== 'off' && (
                          <div className="mt-8 rounded-lg bg-black/75 px-4 py-1.5 text-sm font-bold text-white border border-white/15">
                            {subtitleLang === 'ar'
                              ? `ترجمة عربية احترافية متزامنة — ${theme.brandLabel}`
                              : `English Subtitles Active — ${theme.brandLabel}`}
                          </div>
                        )}
                      </div>

                      <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-3 bg-black/80 px-4 py-3 backdrop-blur-sm">
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

                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-[#b7c9ef]">الترجمة:</span>
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
                              className={`rounded-lg px-2.5 py-1 font-bold cursor-pointer ${
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

                {/* Clean Footer Bar */}
                {theme.showFooterBar && (
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 border-t border-white/[0.08] text-[11px]"
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
                          handleManualServerSelect((selectedServer + 1) % serversList.length)
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

              {/* Series Episodes Switcher */}
              {episodes.length > 0 && (
                <div
                  className="rounded-xl border border-white/[0.08] p-3"
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
  onLogout: () => Promise<void>;
  onOpenAdmin: () => void;
  onNotify?: (msg: string) => void;
}

export function LoginModal({
  isOpen,
  onClose,
  firebaseUser,
  isAdmin,
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
                <span className="mt-2 inline-flex items-center gap-1 rounded-lg bg-[#f9c400]/15 border border-[#f9c400]/40 px-2.5 py-1 text-[11px] font-black text-[#f9c400]">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  مشرف معتمد
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
