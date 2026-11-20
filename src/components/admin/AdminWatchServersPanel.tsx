import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Edit3,
  ExternalLink,
  Globe,
  History,
  Loader2,
  Palette,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldAlert,
  Square,
  Trash2,
  Wifi,
  Wrench,
  XCircle,
} from 'lucide-react';
import { isLikelyNonVideoWebsiteUrl } from '../../lib/clientScraper';
import { extractServerResolvedUrl } from '../../lib/contentAudit';
import {
  clearServerAttemptHistory,
  type ServerDiagnosticAttemptEntry,
  type ServerDiagnosticRecord,
  subscribeServerDiagnostics,
  syncHealthReportToDiagnostics,
} from '../../lib/playerAutoRepair';
import { DEFAULT_PLAYER_THEME, PLAYER_THEME_PRESETS, saveStoredPlayerTheme } from '../../lib/playerTheme';
import { getWatchModeDisplayInfo } from '../../lib/serverFailover';
import {
  runBatchServerHealthCheck,
  SERVER_HEALTH_META,
  type ServerHealthReport,
  type ServerHealthStatus,
} from '../../lib/serverHealthChecker';
import {
  checkSingleServerImmediately,
  enqueueServerHealthChecks,
  type HealthQueueTarget,
  isServerHealthExpired,
  loadLocalServerHealthCache,
  type ServerHealthQueueState,
  subscribeServerHealthQueue,
} from '../../lib/serverHealthQueue';
import { MediaItem, PlayerThemeConfig, ServerHealthRecord, StreamServer } from '../../types/media';

interface AdminWatchServersPanelProps {
  mode: 'watch_servers' | 'player_theme';
  catalog: MediaItem[];
  adminUid?: string;
  serverHealthMap?: Record<string, ServerHealthRecord>;
  activePlayerTheme: PlayerThemeConfig;
  busyAction: boolean;
  onEditMedia: (item: MediaItem) => void;
  onUpdatePlayerTheme: (patch: Partial<PlayerThemeConfig>, isPreset?: boolean) => void;
  onSavePlayerTheme: (theme: PlayerThemeConfig) => Promise<void>;
  onNotify: (msg: string) => void;
}

interface FlattenedServerRow {
  mediaId: string;
  mediaTitle: string;
  seasonNumber?: number;
  episodeNumber?: number;
  locationLabel: string;
  serverName: string;
  url: string;
  host: string;
  suspicious: boolean;
}

type HealthFilterKey = 'all' | ServerHealthStatus | 'untested' | 'expired' | 'needs_repair';

const STATUS_BADGE_STYLE: Record<ServerHealthStatus, string> = {
  confirmed_playing: 'bg-[#4CAF50]/15 border-[#4CAF50]/45 text-[#8cf091]',
  page_available: 'bg-[#f9c400]/15 border-[#f9c400]/45 text-[#f9c400]',
  needs_manual_check: 'bg-orange-500/15 border-orange-400/45 text-orange-300',
  broken: 'bg-[#D92321]/20 border-[#D92321]/50 text-[#ff9f9d]',
  iframe_blocked: 'bg-[#D92321]/20 border-rose-400/50 text-rose-300',
  unknown_error: 'bg-white/10 border-white/25 text-[#b7c9ef]',
};

function formatCheckTime(iso?: string): string {
  if (!iso) return 'لم يُفحص بعد';
  try {
    return new Date(iso).toLocaleTimeString('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function AdminWatchServersPanel({
  mode,
  catalog,
  adminUid,
  serverHealthMap: externalHealthMap,
  activePlayerTheme,
  busyAction,
  onEditMedia,
  onUpdatePlayerTheme,
  onSavePlayerTheme,
  onNotify,
}: AdminWatchServersPanelProps) {
  const [hostFilter, setHostFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<HealthFilterKey>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [panelTab, setPanelTab] = useState<'servers' | 'history'>('servers');
  const [checkingBatch, setCheckingBatch] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });
  const [checkingSingleUrls, setCheckingSingleUrls] = useState<Record<string, boolean>>({});
  const [healthReports, setHealthReports] = useState<Record<string, ServerHealthReport>>({});
  const [localCachedHealthMap, setLocalCachedHealthMap] = useState<Record<string, ServerHealthRecord>>(() =>
    loadLocalServerHealthCache()
  );
  const [queueState, setQueueState] = useState<ServerHealthQueueState>({
    running: false,
    total: 0,
    completed: 0,
    inFlight: 0,
    queued: 0,
    lastUpdatedUrl: null,
  });
  const [diagnosticsMap, setDiagnosticsMap] = useState<Record<string, ServerDiagnosticRecord>>({});
  const [attemptHistory, setAttemptHistory] = useState<ServerDiagnosticAttemptEntry[]>([]);
  const batchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const unsubscribeDiag = subscribeServerDiagnostics(({ map, history }) => {
      setDiagnosticsMap(map);
      setAttemptHistory(history);
    });
    const unsubscribeQueue = subscribeServerHealthQueue((state, map) => {
      setQueueState(state);
      setLocalCachedHealthMap(map);
    });
    return () => {
      unsubscribeDiag();
      unsubscribeQueue();
      batchAbortRef.current?.abort();
    };
  }, []);

  const mergedCachedHealthMap = useMemo<Record<string, ServerHealthRecord>>(() => {
    const combined: Record<string, ServerHealthRecord> = { ...(externalHealthMap || {}) };
    for (const [url, rec] of Object.entries(localCachedHealthMap)) {
      const existing = combined[url];
      if (!existing || (rec.lastCheckedAtMs || 0) >= (existing.lastCheckedAtMs || 0)) {
        combined[url] = rec;
      }
    }
    return combined;
  }, [externalHealthMap, localCachedHealthMap]);

  const serverRows = useMemo<FlattenedServerRow[]>(() => {
    const rows: FlattenedServerRow[] = [];
    const addServer = (
      item: MediaItem,
      locationLabel: string,
      srv: StreamServer,
      seasonNumber?: number,
      episodeNumber?: number
    ) => {
      const url = extractServerResolvedUrl(srv);
      if (!url) return;
      let host = 'غير معروف';
      try {
        host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
      } catch {
        host = 'رابط غير صالح';
      }
      rows.push({
        mediaId: item.id,
        mediaTitle: item.title,
        seasonNumber,
        episodeNumber,
        locationLabel,
        serverName: srv.name || 'سيرفر',
        url,
        host,
        suspicious: isLikelyNonVideoWebsiteUrl(url) || host === 'رابط غير صالح',
      });
    };

    for (const item of catalog) {
      for (const srv of item.servers || []) {
        addServer(item, 'العمل الرئيسي', srv);
      }
      for (const season of item.seasons || []) {
        for (const ep of season.episodes || []) {
          for (const srv of ep.servers || []) {
            addServer(item, `م${season.seasonNumber} ح${ep.number}`, srv, season.seasonNumber, ep.number);
          }
          if (ep.watchUrl && (!ep.servers || ep.servers.length === 0)) {
            addServer(
              item,
              `م${season.seasonNumber} ح${ep.number}`,
              {
                id: `ep_${ep.number}`,
                name: 'رابط الحلقة',
                url: ep.watchUrl,
                quality: ep.quality,
                speed: 'سريع',
                tag: ep.quality,
              },
              season.seasonNumber,
              ep.number
            );
          }
        }
      }
    }
    return rows;
  }, [catalog]);

  const topHosts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of serverRows) {
      map.set(row.host, (map.get(row.host) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([host, count]) => ({ host, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [serverRows]);

  const statusCounts = useMemo(() => {
    const counts: Record<HealthFilterKey, number> = {
      all: serverRows.length,
      confirmed_playing: 0,
      page_available: 0,
      needs_manual_check: 0,
      broken: 0,
      iframe_blocked: 0,
      unknown_error: 0,
      untested: 0,
      expired: 0,
      needs_repair: 0,
    };
    const nowMs = Date.now();
    for (const row of serverRows) {
      const report = healthReports[row.url];
      const cached = mergedCachedHealthMap[row.url];
      const st = report?.status || cached?.status || diagnosticsMap[row.url]?.status;
      if (!st) {
        counts.untested += 1;
      } else {
        counts[st] += 1;
        if (st === 'broken' || st === 'iframe_blocked' || st === 'unknown_error' || row.suspicious) {
          counts.needs_repair += 1;
        }
      }
      if (cached && isServerHealthExpired(cached, nowMs)) {
        counts.expired += 1;
      }
    }
    return counts;
  }, [serverRows, healthReports, mergedCachedHealthMap, diagnosticsMap]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const nowMs = Date.now();
    return serverRows.filter((r) => {
      if (hostFilter !== 'all' && r.host !== hostFilter) return false;
      if (statusFilter !== 'all') {
        const rep = healthReports[r.url];
        const cached = mergedCachedHealthMap[r.url];
        const st = rep?.status || cached?.status || diagnosticsMap[r.url]?.status;
        if (statusFilter === 'untested') {
          if (st) return false;
        } else if (statusFilter === 'expired') {
          if (!cached || !isServerHealthExpired(cached, nowMs)) return false;
        } else if (statusFilter === 'needs_repair') {
          if (st !== 'broken' && st !== 'iframe_blocked' && st !== 'unknown_error' && !r.suspicious) {
            return false;
          }
        } else if (st !== statusFilter) {
          return false;
        }
      }
      if (!q) return true;
      return (
        r.mediaTitle.toLowerCase().includes(q) ||
        r.host.toLowerCase().includes(q) ||
        r.serverName.toLowerCase().includes(q) ||
        r.url.toLowerCase().includes(q)
      );
    });
  }, [serverRows, hostFilter, statusFilter, searchQuery, healthReports, mergedCachedHealthMap, diagnosticsMap]);

  const mediaMap = useMemo(() => new Map(catalog.map((m) => [m.id, m])), [catalog]);

  const handleCheckSingleServer = async (row: FlattenedServerRow) => {
    if (checkingSingleUrls[row.url]) return;
    setCheckingSingleUrls((prev) => ({ ...prev, [row.url]: true }));
    try {
      const record = await checkSingleServerImmediately(
        {
          url: row.url,
          serverName: row.serverName,
          mediaId: row.mediaId,
          mediaTitle: row.mediaTitle,
          seasonNumber: row.seasonNumber,
          episodeNumber: row.episodeNumber,
          verifyVideoPlayback: true,
          verifyIframeLoad: true,
          forceRefresh: true,
        },
        adminUid
      );
      setLocalCachedHealthMap((prev) => ({ ...prev, [row.url]: record }));
    } catch (err) {
      onNotify(`تعذر فحص السيرفر: ${err instanceof Error ? err.message : 'خطأ'}`);
    } finally {
      setCheckingSingleUrls((prev) => ({ ...prev, [row.url]: false }));
    }
  };

  const handleQueueBackgroundChecks = (onlyFailedOrExpired: boolean) => {
    const nowMs = Date.now();
    const targets: HealthQueueTarget[] = [];
    const seen = new Set<string>();
    for (const r of filteredRows) {
      if (seen.has(r.url)) continue;
      if (onlyFailedOrExpired) {
        const cached = mergedCachedHealthMap[r.url];
        const st = healthReports[r.url]?.status || cached?.status || diagnosticsMap[r.url]?.status;
        const failed = st === 'broken' || st === 'iframe_blocked' || st === 'unknown_error';
        const expired = !cached || isServerHealthExpired(cached, nowMs);
        if (!failed && !expired) continue;
      }
      seen.add(r.url);
      targets.push({
        url: r.url,
        serverName: r.serverName,
        mediaId: r.mediaId,
        mediaTitle: r.mediaTitle,
        seasonNumber: r.seasonNumber,
        episodeNumber: r.episodeNumber,
        verifyIframeLoad: true,
        verifyVideoPlayback: true,
        forceRefresh: true,
      });
    }
    if (targets.length === 0) {
      onNotify(
        onlyFailedOrExpired
          ? 'لا توجد سيرفرات فاشلة أو منتهية الصلاحية (TTL) لإعادة فحصها.'
          : 'لا توجد سيرفرات لجدولتها.'
      );
      return;
    }
    const { enqueuedCount } = enqueueServerHealthChecks(targets, adminUid);
    onNotify(
      `تمت جدولة ${enqueuedCount} رابط سيرفر في طابور الفحص الخلفي بدون تعطيل الواجهة.`
    );
  };

  const handleStopBatchCheck = () => {
    batchAbortRef.current?.abort();
    batchAbortRef.current = null;
    setCheckingBatch(false);
    onNotify('تم إيقاف الفحص الجماعي مؤقتاً.');
  };

  const handleBatchCheckAllServers = async () => {
    const targets = filteredRows.map((r) => ({ url: r.url, serverName: r.serverName }));
    if (targets.length === 0) return;

    batchAbortRef.current?.abort();
    const abortCtrl = new AbortController();
    batchAbortRef.current = abortCtrl;

    const uniqueCount = new Set(targets.map((t) => t.url)).size;
    setCheckingBatch(true);
    setBatchProgress({ done: 0, total: uniqueCount });

    try {
      await runBatchServerHealthCheck(targets, {
        concurrency: 4,
        verifyVideoPlayback: true,
        verifyIframeLoad: false,
        timeoutMs: 6500,
        signal: abortCtrl.signal,
        onProgress: (url, report, done, total) => {
          setHealthReports((prev) => ({ ...prev, [url]: report }));
          syncHealthReportToDiagnostics(report, { source: 'admin_check' });
          setBatchProgress({ done, total });
        },
      });
      if (!abortCtrl.signal.aborted) {
        onNotify(`اكتمل فحص ${uniqueCount} رابط سيرفر بنجاح.`);
      }
    } catch (err) {
      if (!abortCtrl.signal.aborted) {
        onNotify(`تعذر إتمام الفحص: ${err instanceof Error ? err.message : 'خطأ'}`);
      }
    } finally {
      if (batchAbortRef.current === abortCtrl) {
        batchAbortRef.current = null;
      }
      setCheckingBatch(false);
    }
  };

  if (mode === 'player_theme') {
    const borderRadiusClass =
      activePlayerTheme.borderRadius === 'sharp'
        ? 'rounded-none'
        : activePlayerTheme.borderRadius === 'rounded'
          ? 'rounded-xl'
          : 'rounded-3xl';

    const glowShadow =
      activePlayerTheme.glowIntensity === 'none'
        ? 'none'
        : activePlayerTheme.glowIntensity === 'soft'
          ? `0 0 22px ${activePlayerTheme.accentColor}33`
          : `0 0 38px ${activePlayerTheme.accentColor}66`;

    return (
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div
              style={{
                backgroundColor: `${activePlayerTheme.accentColor}22`,
                borderColor: `${activePlayerTheme.accentColor}55`,
                color: activePlayerTheme.accentColor,
              }}
              className="flex h-10 w-10 items-center justify-center rounded-xl border"
            >
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-extrabold text-white">
                تخصيص ثيم المشغّل الداخلي
              </h2>
              <p className="text-xs text-[#b7c9ef] mt-0.5">
                تحكّم كامل في ألوان إطار الفيديو، الاستدارة، التوهج، واسم المشغّل — يُعمّم تلقائياً على الموقع بالكامل عند الحفظ.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const resetTheme = { ...DEFAULT_PLAYER_THEME };
                saveStoredPlayerTheme(resetTheme);
                onUpdatePlayerTheme(resetTheme, true);
                onNotify('تمت استعادة الثيم الافتراضي للمشغّل — اضغط تطبيق للحفظ السحابي');
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3 py-2 text-xs font-bold text-[#b7c9ef] hover:text-white cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>استعادة الافتراضي</span>
            </button>

            <button
              type="button"
              disabled={busyAction}
              onClick={() => void onSavePlayerTheme(activePlayerTheme)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#f9c400] hover:bg-[#dfb20b] px-4 py-2 text-xs font-black text-[#06131c] shadow cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{busyAction ? 'جاري التعميم...' : 'تطبيق وحفظ الثيم'}</span>
            </button>
          </div>
        </div>

        {/* Presets */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {PLAYER_THEME_PRESETS.map((preset) => {
            const isSelected = activePlayerTheme.presetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onUpdatePlayerTheme(preset.theme, true)}
                className={`text-right rounded-xl border p-3 transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-[#1a242e] border-[#f9c400]'
                    : 'bg-[#1a242e]/50 border-white/10 hover:border-white/25'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-extrabold text-white">{preset.name}</span>
                  <div className="flex items-center gap-1">
                    <span
                      className="h-3.5 w-3.5 rounded-full border border-white/25"
                      style={{ backgroundColor: preset.theme.accentColor }}
                    />
                    <span
                      className="h-3.5 w-3.5 rounded-full border border-white/25"
                      style={{ backgroundColor: preset.theme.frameBgColor }}
                    />
                  </div>
                </div>
                <p className="text-[10px] text-[#b7c9ef]/80">{preset.subtitle}</p>
              </button>
            );
          })}
        </div>

        {/* Controls & Preview */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          <div className="xl:col-span-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-[#b7c9ef] mb-1.5">
                اسم المشغّل الظاهر داخل الإطار
              </label>
              <input
                type="text"
                maxLength={40}
                value={activePlayerTheme.brandLabel}
                onChange={(e) => onUpdatePlayerTheme({ brandLabel: e.target.value })}
                className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2 text-xs font-bold text-white"
              />
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <label className="block rounded-xl bg-[#1a242e] border border-white/10 p-2.5 cursor-pointer">
                <span className="block text-[10px] font-bold text-[#b7c9ef] mb-1">اللون المميز</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={activePlayerTheme.accentColor}
                    onChange={(e) => onUpdatePlayerTheme({ accentColor: e.target.value })}
                    className="h-7 w-9 border-0 bg-transparent cursor-pointer"
                  />
                  <span className="font-latin text-[11px] font-bold text-white uppercase">
                    {activePlayerTheme.accentColor}
                  </span>
                </div>
              </label>

              <label className="block rounded-xl bg-[#1a242e] border border-white/10 p-2.5 cursor-pointer">
                <span className="block text-[10px] font-bold text-[#b7c9ef] mb-1">خلفية الإطار</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={activePlayerTheme.frameBgColor}
                    onChange={(e) => onUpdatePlayerTheme({ frameBgColor: e.target.value })}
                    className="h-7 w-9 border-0 bg-transparent cursor-pointer"
                  />
                  <span className="font-latin text-[11px] font-bold text-white uppercase">
                    {activePlayerTheme.frameBgColor}
                  </span>
                </div>
              </label>

              <label className="block rounded-xl bg-[#1a242e] border border-white/10 p-2.5 cursor-pointer">
                <span className="block text-[10px] font-bold text-[#b7c9ef] mb-1">خلفية النافذة</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={activePlayerTheme.modalBgColor}
                    onChange={(e) => onUpdatePlayerTheme({ modalBgColor: e.target.value })}
                    className="h-7 w-9 border-0 bg-transparent cursor-pointer"
                  />
                  <span className="font-latin text-[11px] font-bold text-white uppercase">
                    {activePlayerTheme.modalBgColor}
                  </span>
                </div>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="block text-[11px] font-bold text-[#b7c9ef] mb-1.5">استدارة الحواف</span>
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#1a242e] p-1 border border-white/10">
                  {(['sharp', 'rounded', 'cinema'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => onUpdatePlayerTheme({ borderRadius: r })}
                      className={`rounded-lg py-1.5 text-[11px] font-extrabold cursor-pointer ${
                        activePlayerTheme.borderRadius === r ? 'bg-white/15 text-white' : 'text-[#b7c9ef]'
                      }`}
                    >
                      {r === 'sharp' ? 'حاد' : r === 'rounded' ? 'ناعم' : 'سينمائي'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-[11px] font-bold text-[#b7c9ef] mb-1.5">شدة التوهج</span>
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#1a242e] p-1 border border-white/10">
                  {(['none', 'soft', 'strong'] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => onUpdatePlayerTheme({ glowIntensity: g })}
                      className={`rounded-lg py-1.5 text-[11px] font-extrabold cursor-pointer ${
                        activePlayerTheme.glowIntensity === g ? 'bg-white/15 text-white' : 'text-[#b7c9ef]'
                      }`}
                    >
                      {g === 'none' ? 'بدون' : g === 'soft' ? 'خفيف' : 'قوي'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="flex items-center gap-2 rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-[11px] font-bold text-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={activePlayerTheme.showHeaderBar}
                  onChange={(e) => onUpdatePlayerTheme({ showHeaderBar: e.target.checked })}
                  className="h-3.5 w-3.5 accent-[#f9c400]"
                />
                <span>الشريط العلوي</span>
              </label>
              <label className="flex items-center gap-2 rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-[11px] font-bold text-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={activePlayerTheme.showFooterBar}
                  onChange={(e) => onUpdatePlayerTheme({ showFooterBar: e.target.checked })}
                  className="h-3.5 w-3.5 accent-[#f9c400]"
                />
                <span>الشريط السفلي</span>
              </label>
              <label className="flex items-center gap-2 rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-[11px] font-bold text-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={activePlayerTheme.showBrandBadge}
                  onChange={(e) => onUpdatePlayerTheme({ showBrandBadge: e.target.checked })}
                  className="h-3.5 w-3.5 accent-[#f9c400]"
                />
                <span>شارة المشغل</span>
              </label>
            </div>
          </div>

          {/* Live Mini Player Preview */}
          <div className="xl:col-span-6">
            <div
              style={{ backgroundColor: activePlayerTheme.modalBgColor }}
              className="rounded-2xl border border-white/10 p-4 space-y-3"
            >
              {activePlayerTheme.showHeaderBar && (
                <div className="flex items-center justify-between text-xs font-extrabold text-white">
                  <span>معاينة المشغّل المباشرة</span>
                  {activePlayerTheme.showBrandBadge && (
                    <span
                      style={{ backgroundColor: activePlayerTheme.accentColor }}
                      className="rounded-md px-2 py-0.5 text-[10px] font-black text-white"
                    >
                      {activePlayerTheme.brandLabel || 'RahaL TV'}
                    </span>
                  )}
                </div>
              )}

              <div
                style={{
                  backgroundColor: activePlayerTheme.frameBgColor,
                  borderColor: `${activePlayerTheme.accentColor}66`,
                  boxShadow: glowShadow,
                }}
                className={`aspect-video border-2 flex items-center justify-center ${borderRadiusClass}`}
              >
                <div className="text-center space-y-1">
                  <span
                    style={{ backgroundColor: activePlayerTheme.accentColor }}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white font-black shadow-lg"
                  >
                    ▶
                  </span>
                  <p className="text-[11px] font-bold text-white/80">16:9 / HLS &amp; Embed Ready</p>
                </div>
              </div>

              {activePlayerTheme.showFooterBar && (
                <div className="flex items-center justify-between text-[11px] text-[#b7c9ef]">
                  <span>سيرفر 1 • سريع</span>
                  <span style={{ color: activePlayerTheme.accentColor }} className="font-bold">
                    جودة 1080p
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Watch Servers Multi-Stage Health Checker Mode
  const suspiciousCount = serverRows.filter((r) => r.suspicious).length;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-extrabold text-white flex items-center gap-2">
            <Server className="w-5 h-5 text-[#4CAF50]" />
            <span>فاحص صحة سيرفرات المشاهدة متعدد المراحل</span>
          </h2>
          <p className="text-xs text-[#b7c9ef] mt-1">
            إجمالي الروابط المفهرسة: {serverRows.length} سيرفر عبر {topHosts.length}+ نطاق — لا تُمنح علامة التشغيل المؤكد إلا عند التحقق الفعلي من المشغل.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-[#12202b] border border-white/10 p-1">
            <button
              type="button"
              onClick={() => setPanelTab('servers')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-extrabold cursor-pointer transition-colors ${
                panelTab === 'servers' ? 'bg-white/15 text-white' : 'text-[#b7c9ef] hover:text-white'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>السيرفرات ({serverRows.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setPanelTab('history')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-extrabold cursor-pointer transition-colors ${
                panelTab === 'history' ? 'bg-white/15 text-white' : 'text-[#b7c9ef] hover:text-white'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span className="tabular-nums">السجل التاريخي ({attemptHistory.length})</span>
            </button>
          </div>

          {panelTab === 'servers' && (
            <>
              {queueState.running && (
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500/15 border border-sky-400/35 px-3 py-2 text-[11px] font-extrabold text-sky-300 tabular-nums">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>
                    الطابور الخلفي: {queueState.completed}/{queueState.total}
                  </span>
                </span>
              )}
              <button
                type="button"
                disabled={serverRows.length === 0}
                onClick={() => handleQueueBackgroundChecks(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-orange-500/20 border border-orange-400/35 disabled:opacity-50 px-3.5 py-2.5 text-xs font-extrabold text-orange-300 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>
                  إعادة فحص الفاشلة والمنتهية TTL ({statusCounts.needs_repair + statusCounts.expired})
                </span>
              </button>
              <button
                type="button"
                disabled={filteredRows.length === 0}
                onClick={() => handleQueueBackgroundChecks(false)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-sky-500/20 border border-sky-400/35 disabled:opacity-50 px-3.5 py-2.5 text-xs font-extrabold text-sky-300 cursor-pointer"
              >
                <Server className="w-3.5 h-3.5" />
                <span>جدولة بالطابور ({filteredRows.length})</span>
              </button>
              {checkingBatch ? (
                <button
                  type="button"
                  onClick={handleStopBatchCheck}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#D92321] hover:bg-[#b71c1b] px-4 py-2.5 text-xs font-black text-white cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>
                    إيقاف الفحص ({batchProgress.done}/{batchProgress.total})
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={filteredRows.length === 0}
                  onClick={() => void handleBatchCheckAllServers()}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#f9c400] hover:bg-[#dfb20b] disabled:opacity-50 px-4 py-2.5 text-xs font-black text-[#06131c] cursor-pointer"
                >
                  <Activity className="w-4 h-4" />
                  <span>فحص مباشر الآن ({filteredRows.length})</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {panelTab === 'history' ? (
        <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
            <div>
              <h3 className="font-display text-base font-extrabold text-white flex items-center gap-2">
                <History className="w-4 h-4 text-[#f9c400]" />
                <span>السجل التاريخي لمحاولات الفحص والتشغيل</span>
              </h3>
              <p className="text-xs text-[#9fb2d4] mt-0.5">
                يسجّل محاولات التشغيل التلقائي من المشاهدين وفحوصات لوحة الإدارة مع الأوضاع المجربة وتفاصيل الأخطاء.
              </p>
            </div>
            {attemptHistory.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  clearServerAttemptHistory();
                  onNotify('تم مسح السجل التاريخي للمحاولات.');
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-[#D92321]/20 border border-white/10 px-3 py-1.5 text-xs font-bold text-[#ff9f9d] cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>مسح السجل</span>
              </button>
            )}
          </div>

          {attemptHistory.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#9fb2d4]">
              لا توجد محاولات تشغيل أو فحص مسجلة بعد. ستظهر هنا تلقائياً عند تشغيل أي سيرفر أو فحصه.
            </div>
          ) : (
            <div className="space-y-2.5">
              {attemptHistory.map((entry) => {
                const meta = SERVER_HEALTH_META[entry.status];
                return (
                  <div
                    key={entry.id}
                    className="rounded-2xl bg-[#12202b] border border-white/[0.06] p-3.5 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span
                          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-extrabold ${STATUS_BADGE_STYLE[entry.status]}`}
                        >
                          <span>{meta.emoji}</span>
                          <span>{meta.shortLabel}</span>
                        </span>
                        <span className="text-xs font-extrabold text-white">
                          {entry.serverName}
                        </span>
                        {entry.mediaTitle && (
                          <span className="text-[11px] font-bold text-[#b7c9ef]">
                            · {entry.mediaTitle}
                          </span>
                        )}
                        <span className="rounded bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold text-[#9fb2d4]">
                          {entry.source === 'viewer_auto' ? 'مشاهدة تلقائية' : 'فحص الإدارة'}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#9fb2d4] tabular-nums">
                        {entry.httpStatus > 0 && (
                          <span className="font-latin font-bold text-white/85">
                            HTTP {entry.httpStatus}
                          </span>
                        )}
                        <span className="font-latin">{entry.latencyMs} ms</span>
                        <span>محاولة #{entry.attemptCount}</span>
                        <span>{formatCheckTime(entry.timestamp)}</span>
                      </div>
                    </div>

                    <p className="font-latin text-[11px] text-[#9fb2d4] break-all" dir="ltr">
                      {entry.url}
                    </p>

                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="text-[#9fb2d4]">
                        التضمين: <strong className="text-white">{entry.embedCheckResult}</strong>
                      </span>
                      <span className="text-white/25">·</span>
                      <span className="text-[#9fb2d4]">
                        المشغل: <strong className="text-white">{entry.playerInitResult}</strong>
                      </span>
                      <span className="text-white/25">·</span>
                      <span className={entry.playbackConfirmed ? 'font-extrabold text-[#8cf091]' : 'font-bold text-[#f9c400]'}>
                        {entry.playbackConfirmed ? 'تشغيل مؤكد' : 'غير مؤكد آلياً'}
                      </span>

                      {entry.triedModes.length > 0 && (
                        <>
                          <span className="text-white/25">·</span>
                          <span className="text-[#9fb2d4]">
                            الأوضاع المجربة:{' '}
                            <strong className="text-white">
                              {entry.triedModes.map((m) => getWatchModeDisplayInfo(m).shortLabel).join(' ← ')}
                            </strong>
                          </span>
                        </>
                      )}

                      {entry.succeededMode && (
                        <>
                          <span className="text-white/25">·</span>
                          <span className="font-extrabold text-[#8cf091]">
                            الوضع الناجح: {getWatchModeDisplayInfo(entry.succeededMode).shortLabel}
                          </span>
                        </>
                      )}
                    </div>

                    {(entry.failureReason || entry.errorDetail || (entry.repairsApplied && entry.repairsApplied.length > 0)) && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/[0.06] text-[11px]">
                        {(entry.failureReason || entry.errorDetail) && (
                          <span className="text-[#ff9f9d] font-bold">
                            السبب: {entry.failureReason || entry.errorDetail}
                          </span>
                        )}
                        {entry.repairsApplied && entry.repairsApplied.length > 0 && (
                          <span className="inline-flex items-center gap-1 font-latin text-sky-300">
                            <Wrench className="w-3 h-3" />
                            <span>Repairs: {entry.repairsApplied.join(', ')}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <>

      {/* 6-State Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {(
          [
            { key: 'confirmed_playing', count: statusCounts.confirmed_playing, accent: 'border-[#4CAF50]/35 text-[#8cf091]' },
            { key: 'page_available', count: statusCounts.page_available, accent: 'border-[#f9c400]/35 text-[#f9c400]' },
            { key: 'needs_manual_check', count: statusCounts.needs_manual_check, accent: 'border-orange-400/35 text-orange-300' },
            { key: 'broken', count: statusCounts.broken, accent: 'border-[#D92321]/40 text-[#ff9f9d]' },
            { key: 'iframe_blocked', count: statusCounts.iframe_blocked, accent: 'border-rose-400/40 text-rose-300' },
            { key: 'unknown_error', count: statusCounts.unknown_error, accent: 'border-white/20 text-[#b7c9ef]' },
          ] as const
        ).map((card) => {
          const meta = SERVER_HEALTH_META[card.key];
          const isSelected = statusFilter === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => setStatusFilter(isSelected ? 'all' : card.key)}
              className={`rounded-2xl bg-[#0c1821] border p-3 text-right transition-all cursor-pointer ${
                isSelected ? 'ring-2 ring-[#f9c400] border-[#f9c400]' : card.accent
              }`}
            >
              <div className="flex items-center justify-between gap-1 text-xs font-black">
                <span>{meta.emoji}</span>
                <span className="font-latin text-base tabular-nums text-white">{card.count}</span>
              </div>
              <p className="mt-1 text-[11px] font-bold truncate">{meta.label}</p>
            </button>
          );
        })}
      </div>

      {/* Host distribution chips & search */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-extrabold text-[#b7c9ef] flex items-center gap-1.5">
            <Globe className="w-4 h-4 text-sky-400" />
            <span>تصفية حسب النطاق أو الحالة</span>
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'needs_repair' ? 'all' : 'needs_repair')}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold cursor-pointer ${
                statusFilter === 'needs_repair'
                  ? 'bg-[#D92321] border-[#D92321] text-white'
                  : 'bg-[#1a242e] border-white/10 text-[#ff9f9d]'
              }`}
            >
              بحاجة لإصلاح ({statusCounts.needs_repair})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'expired' ? 'all' : 'expired')}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold cursor-pointer ${
                statusFilter === 'expired'
                  ? 'bg-orange-500 border-orange-400 text-[#06131c]'
                  : 'bg-[#1a242e] border-white/10 text-orange-300'
              }`}
            >
              منتهي TTL ({statusCounts.expired})
            </button>
            {statusFilter !== 'all' && (
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className="rounded-lg bg-white/10 hover:bg-white/20 px-2.5 py-1 text-[11px] font-bold text-white cursor-pointer"
              >
                إلغاء فلتر الحالة
              </button>
            )}
            {suspiciousCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-[#D92321]/15 border border-[#D92321]/35 px-2.5 py-1 text-[11px] font-extrabold text-[#ff9f9d]">
                <ShieldAlert className="w-3.5 h-3.5" />
                {suspiciousCount} رابط مشبوه (قد يكون صفحة موقع)
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setHostFilter('all')}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer ${
              hostFilter === 'all'
                ? 'bg-[#D92321] text-white'
                : 'bg-[#1a242e] text-[#b7c9ef] hover:text-white'
            }`}
          >
            الكل ({serverRows.length})
          </button>
          {topHosts.map((h) => (
            <button
              key={h.host}
              type="button"
              onClick={() => setHostFilter(hostFilter === h.host ? 'all' : h.host)}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold font-latin cursor-pointer ${
                hostFilter === h.host
                  ? 'bg-[#f9c400] text-[#06131c]'
                  : 'bg-[#1a242e] text-[#b7c9ef] hover:text-white'
              }`}
            >
              {h.host} ({h.count})
            </button>
          ))}
        </div>

        <div className="relative pt-1">
          <Search className="w-4 h-4 text-[#b7c9ef] absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث باسم العمل أو السيرفر أو النطاق أو الرابط..."
            className="w-full rounded-xl bg-[#1a242e] border border-white/10 pr-10 pl-3 py-2 text-xs text-white focus:border-[#f9c400] focus:outline-none"
          />
        </div>
      </div>

      {/* Detailed Server Health Cards (All 9 Requested Fields) */}
      <div className="space-y-3">
        {filteredRows.length === 0 ? (
          <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-8 text-center text-xs text-[#b7c9ef]">
            لا توجد سيرفرات مطابقة لخيارات التصفية الحالية.
          </div>
        ) : (
          filteredRows.slice(0, 120).map((row, idx) => {
            const mediaItem = mediaMap.get(row.mediaId);
            const report = healthReports[row.url];
            const cached = mergedCachedHealthMap[row.url];
            const diag = diagnosticsMap[row.url];
            const isSingleChecking = Boolean(checkingSingleUrls[row.url]);
            const resolvedStatus: ServerHealthStatus | null =
              report?.status || cached?.status || diag?.status || null;
            const resolvedMeta = resolvedStatus ? SERVER_HEALTH_META[resolvedStatus] : null;
            const finalBadgeCls = resolvedStatus
              ? STATUS_BADGE_STYLE[resolvedStatus]
              : 'bg-white/[0.06] border-white/15 text-[#b7c9ef]';
            const httpCode = report?.httpStatus || cached?.httpStatus || diag?.httpStatus || 0;
            const latency = report ? report.latencyMs : cached?.latencyMs ?? diag?.latencyMs;
            const checkedAt =
              report?.checkedAt ||
              (cached?.lastCheckedAtMs ? new Date(cached.lastCheckedAtMs).toISOString() : undefined) ||
              diag?.lastCheckedAt;
            const isExpiredTtl = cached ? isServerHealthExpired(cached) : false;
            const triedModes =
              (diag?.triedModes && diag.triedModes.length > 0 ? diag.triedModes : undefined) ||
              (cached?.triedModes && cached.triedModes.length > 0 ? cached.triedModes : undefined) ||
              report?.triedModes ||
              [];
            const succeededMode =
              diag?.succeededMode ??
              (cached?.lastSuccessfulMode || undefined) ??
              report?.succeededMode ??
              null;
            const attemptCount = diag?.attemptCount ?? report?.attemptCount;
            const failureDetail =
              diag?.errorDetail ||
              diag?.failureReason ||
              cached?.lastFailureReason ||
              report?.errorDetail ||
              report?.reasonText;

            return (
              <div
                key={`${row.mediaId}_${idx}`}
                className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-4 space-y-3 hover:border-white/20 transition-colors"
              >
                {/* Header Row: 1. Server Name, 2. Server URL, 6. Final Check Result, Actions */}
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-extrabold text-white">
                        {row.serverName}
                      </span>
                      <span className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] font-bold text-[#b7c9ef]">
                        {row.mediaTitle} · {row.locationLabel}
                      </span>
                      <span className="rounded-md bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-sky-300 font-latin">
                        {row.host}
                      </span>
                      {row.suspicious && (
                        <span className="rounded-md bg-[#D92321]/20 px-2 py-0.5 text-[10px] font-black text-[#ff9f9d]">
                          رابط مشبوه
                        </span>
                      )}
                    </div>

                    <p
                      className="font-latin text-[11px] text-[#9fb2d4] break-all"
                      dir="ltr"
                    >
                      {row.url}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-extrabold ${finalBadgeCls}`}
                    >
                      <span>{resolvedMeta ? resolvedMeta.emoji : '⚪'}</span>
                      <span>
                        {resolvedMeta ? resolvedMeta.label : 'غير مفحوص بعد'}
                      </span>
                    </span>

                    <button
                      type="button"
                      disabled={isSingleChecking}
                      onClick={() => void handleCheckSingleServer(row)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#f9c400] hover:bg-[#dfb20b] disabled:opacity-60 px-3 py-1.5 text-xs font-black text-[#06131c] cursor-pointer"
                    >
                      {isSingleChecking ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      <span>{report ? 'إعادة فحص' : 'فحص متقدم'}</span>
                    </button>

                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 p-2 text-[#b7c9ef] hover:text-white"
                      title="فتح الرابط في تبويب خارجي"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>

                    {mediaItem && (
                      <button
                        type="button"
                        onClick={() => onEditMedia(mediaItem)}
                        className="inline-flex items-center gap-1 rounded-xl bg-[#1a242e] hover:bg-[#D92321] border border-white/10 px-3 py-1.5 text-[11px] font-bold text-white cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>{resolvedStatus === 'broken' ? 'استبدال / إصلاح' : 'تعديل'}</span>
                      </button>
                    )}
                    {isExpiredTtl && (
                      <span className="rounded-md bg-orange-500/15 border border-orange-400/35 px-2 py-1 text-[10px] font-black text-orange-300">
                        منتهي TTL
                      </span>
                    )}
                  </div>
                </div>

                {/* Multi-Stage Grid: Connectivity, Page Load, Video Player */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  <div className="rounded-xl bg-[#12202b] border border-white/[0.06] p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-[#9fb2d4]">
                      <span className="inline-flex items-center gap-1.5">
                        <Wifi className="w-3.5 h-3.5 text-sky-400" />
                        <span>حالة الوصول</span>
                      </span>
                      {httpCode ? (
                        <span className="font-latin text-[10px] font-black text-white/80">
                          HTTP {httpCode}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs font-extrabold text-white">
                      {report ? report.connectivity.label : diag ? diag.connectivityStatus : 'بانتظار الفحص'}
                    </p>
                    <p className="text-[11px] text-[#b7c9ef]/80 leading-snug">
                      {report
                        ? report.connectivity.detail
                        : diag?.connectivityDetail || 'اضغط فحص متقدم للتحقق من الاتصال.'}
                    </p>
                  </div>

                  <div className="rounded-xl bg-[#12202b] border border-white/[0.06] p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-[#9fb2d4]">
                      <span className="inline-flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 text-[#f9c400]" />
                        <span>نتيجة التضمين (Iframe)</span>
                      </span>
                      {report?.pageLoad.frameBlocked && (
                        <span className="text-[10px] font-black text-rose-300">محظور</span>
                      )}
                    </div>
                    <p className="text-xs font-extrabold text-white">
                      {report ? report.pageLoad.label : diag?.embedCheckResult || 'غير مفحوص'}
                    </p>
                    <p className="text-[11px] text-[#b7c9ef]/80 leading-snug">
                      {report ? report.pageLoad.detail : 'يتم فحص سياسات التضمين وتحميل الصفحة.'}
                    </p>
                  </div>

                  <div className="rounded-xl bg-[#12202b] border border-white/[0.06] p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-[#9fb2d4]">
                      <span className="inline-flex items-center gap-1.5">
                        <PlayCircle className="w-3.5 h-3.5 text-[#4CAF50]" />
                        <span>تهيئة المشغل والتشغيل</span>
                      </span>
                      {resolvedStatus && (
                        <span
                          className={`text-[10px] font-black ${
                            (report?.playerCheck.playbackConfirmed || diag?.playbackConfirmed)
                              ? 'text-[#8cf091]'
                              : 'text-[#f9c400]'
                          }`}
                        >
                          {(report?.playerCheck.playbackConfirmed || diag?.playbackConfirmed)
                            ? 'مؤكد'
                            : 'غير مؤكد'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-extrabold text-white">
                      {report ? report.playerCheck.label : diag?.playerInitResult || 'غير مفحوص'}
                    </p>
                    <p className="text-[11px] text-[#b7c9ef]/80 leading-snug">
                      {report
                        ? report.playerCheck.detail
                        : 'يتم التحقق من جاهزية عنصر الفيديو أو قيود المصدر.'}
                    </p>
                  </div>
                </div>

                {/* Mode Fallback, Attempt Count, Succeeded Mode & Auto-Repairs Telemetry */}
                {(triedModes.length > 0 || succeededMode || attemptCount || (diag?.repairsApplied && diag.repairsApplied.length > 0)) && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[#101c26] border border-white/[0.05] px-3 py-2 text-[11px]">
                    {attemptCount !== undefined && (
                      <span className="text-[#9fb2d4] tabular-nums">
                        المحاولات: <strong className="text-white">{attemptCount}</strong>
                      </span>
                    )}
                    {triedModes.length > 0 && (
                      <span className="text-[#9fb2d4]">
                        الأوضاع المجربة:{' '}
                        <strong className="text-white">
                          {triedModes.map((m) => getWatchModeDisplayInfo(m).shortLabel).join(' · ')}
                        </strong>
                      </span>
                    )}
                    {succeededMode && (
                      <span className="rounded bg-[#4CAF50]/15 border border-[#4CAF50]/30 px-2 py-0.5 text-[10px] font-extrabold text-[#8cf091]">
                        الوضع الناجح: {getWatchModeDisplayInfo(succeededMode).shortLabel}
                      </span>
                    )}
                    {diag?.repairsApplied && diag.repairsApplied.length > 0 && (
                      <span className="font-latin text-[10px] text-sky-300">
                        إصلاحات تلقائية: {diag.repairsApplied.join(', ')}
                      </span>
                    )}
                  </div>
                )}

                {/* Footer Diagnostics: Problem Reason, Last Check Time, Latency ms */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-white/[0.06] text-[11px]">
                  <div className="flex items-start gap-1.5 min-w-0">
                    {resolvedStatus === 'confirmed_playing' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#4CAF50] shrink-0 mt-0.5" />
                    ) : resolvedStatus === 'broken' || resolvedStatus === 'iframe_blocked' ? (
                      <XCircle className="w-3.5 h-3.5 text-[#ff8a88] shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-[#f9c400] shrink-0 mt-0.5" />
                    )}
                    <span className="font-bold text-[#dbe6ff] leading-snug">
                      {failureDetail
                        ? failureDetail
                        : row.suspicious
                          ? 'تحذير: الرابط يبدو كصفحة موقع عام وليس مشغل فيديو مباشر.'
                          : 'لم يتم إجراء فحص لهذا السيرفر في هذه الجلسة.'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 shrink-0 text-[#9fb2d4]">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      <span>آخر فحص: {formatCheckTime(checkedAt)}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 font-latin tabular-nums">
                      <Activity className="w-3.5 h-3.5 text-sky-400" />
                      <span>{latency !== undefined ? `${latency} ms` : '— ms'}</span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
        </>
      )}
    </div>
  );
}
