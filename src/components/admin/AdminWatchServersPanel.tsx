import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Edit3,
  ExternalLink,
  Globe,
  Loader2,
  Palette,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldAlert,
  Square,
  Wifi,
  XCircle,
} from 'lucide-react';
import { isLikelyNonVideoWebsiteUrl } from '../../lib/clientScraper';
import { extractServerResolvedUrl } from '../../lib/contentAudit';
import { DEFAULT_PLAYER_THEME, PLAYER_THEME_PRESETS, saveStoredPlayerTheme } from '../../lib/playerTheme';
import {
  runBatchServerHealthCheck,
  runMultiStageServerCheck,
  SERVER_HEALTH_META,
  type ServerHealthReport,
  type ServerHealthStatus,
} from '../../lib/serverHealthChecker';
import { MediaItem, PlayerThemeConfig, StreamServer } from '../../types/media';

interface AdminWatchServersPanelProps {
  mode: 'watch_servers' | 'player_theme';
  catalog: MediaItem[];
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
  locationLabel: string;
  serverName: string;
  url: string;
  host: string;
  suspicious: boolean;
}

type HealthFilterKey = 'all' | ServerHealthStatus | 'untested';

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
  const [checkingBatch, setCheckingBatch] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });
  const [checkingSingleUrls, setCheckingSingleUrls] = useState<Record<string, boolean>>({});
  const [healthReports, setHealthReports] = useState<Record<string, ServerHealthReport>>({});
  const batchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      batchAbortRef.current?.abort();
    };
  }, []);

  const serverRows = useMemo<FlattenedServerRow[]>(() => {
    const rows: FlattenedServerRow[] = [];
    const addServer = (item: MediaItem, locationLabel: string, srv: StreamServer) => {
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
            addServer(item, `م${season.seasonNumber} ح${ep.number}`, srv);
          }
          if (ep.watchUrl && (!ep.servers || ep.servers.length === 0)) {
            addServer(item, `م${season.seasonNumber} ح${ep.number}`, {
              id: `ep_${ep.number}`,
              name: 'رابط الحلقة',
              url: ep.watchUrl,
              quality: ep.quality,
              speed: 'سريع',
              tag: ep.quality,
            });
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
    };
    for (const row of serverRows) {
      const report = healthReports[row.url];
      if (!report) {
        counts.untested += 1;
      } else {
        counts[report.status] += 1;
      }
    }
    return counts;
  }, [serverRows, healthReports]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return serverRows.filter((r) => {
      if (hostFilter !== 'all' && r.host !== hostFilter) return false;
      if (statusFilter !== 'all') {
        const rep = healthReports[r.url];
        if (statusFilter === 'untested') {
          if (rep) return false;
        } else if (!rep || rep.status !== statusFilter) {
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
  }, [serverRows, hostFilter, statusFilter, searchQuery, healthReports]);

  const mediaMap = useMemo(() => new Map(catalog.map((m) => [m.id, m])), [catalog]);

  const handleCheckSingleServer = async (row: FlattenedServerRow) => {
    if (checkingSingleUrls[row.url]) return;
    setCheckingSingleUrls((prev) => ({ ...prev, [row.url]: true }));
    try {
      const report = await runMultiStageServerCheck(row.url, {
        serverName: row.serverName,
        verifyVideoPlayback: true,
        verifyIframeLoad: true,
        timeoutMs: 6500,
      });
      setHealthReports((prev) => ({ ...prev, [row.url]: report }));
    } catch (err) {
      onNotify(`تعذر فحص السيرفر: ${err instanceof Error ? err.message : 'خطأ'}`);
    } finally {
      setCheckingSingleUrls((prev) => ({ ...prev, [row.url]: false }));
    }
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
              <span>فحص جميع السيرفرات ({filteredRows.length})</span>
            </button>
          )}
        </div>
      </div>

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
            const isSingleChecking = Boolean(checkingSingleUrls[row.url]);
            const finalBadgeCls = report
              ? STATUS_BADGE_STYLE[report.status]
              : 'bg-white/[0.06] border-white/15 text-[#b7c9ef]';

            return (
              <div
                key={`${row.mediaId}_${idx}`}
                className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-4 space-y-3 hover:border-white/20 transition-colors"
              >
                {/* Header Row: 1. Server Name, 2. Server URL, 6. Final Check Result, Actions */}
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* 1. اسم السيرفر */}
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

                    {/* 2. رابط السيرفر */}
                    <p
                      className="font-latin text-[11px] text-[#9fb2d4] break-all"
                      dir="ltr"
                    >
                      {row.url}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {/* 6. نتيجة الفحص النهائية */}
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-extrabold ${finalBadgeCls}`}
                    >
                      <span>{report ? report.statusEmoji : '⚪'}</span>
                      <span>
                        {report ? report.statusLabel : 'غير مفحوص بعد'}
                      </span>
                    </span>

                    {/* زر إعادة فحص لكل سيرفر */}
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
                        <span>تعديل</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Multi-Stage Grid: 3. Connectivity, 4. Page Load, 5. Video Player */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  {/* 3. حالة الوصول */}
                  <div className="rounded-xl bg-[#12202b] border border-white/[0.06] p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-[#9fb2d4]">
                      <span className="inline-flex items-center gap-1.5">
                        <Wifi className="w-3.5 h-3.5 text-sky-400" />
                        <span>حالة الوصول</span>
                      </span>
                      {report?.httpStatus ? (
                        <span className="font-latin text-[10px] font-black text-white/80">
                          HTTP {report.httpStatus}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs font-extrabold text-white">
                      {report ? report.connectivity.label : 'بانتظار الفحص'}
                    </p>
                    <p className="text-[11px] text-[#b7c9ef]/80 leading-snug">
                      {report ? report.connectivity.detail : 'اضغط فحص متقدم للتحقق من الاتصال.'}
                    </p>
                  </div>

                  {/* 4. حالة تحميل الصفحة */}
                  <div className="rounded-xl bg-[#12202b] border border-white/[0.06] p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-[#9fb2d4]">
                      <span className="inline-flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 text-[#f9c400]" />
                        <span>حالة تحميل الصفحة (Iframe)</span>
                      </span>
                      {report?.pageLoad.frameBlocked && (
                        <span className="text-[10px] font-black text-rose-300">محظور</span>
                      )}
                    </div>
                    <p className="text-xs font-extrabold text-white">
                      {report ? report.pageLoad.label : 'غير مفحوص'}
                    </p>
                    <p className="text-[11px] text-[#b7c9ef]/80 leading-snug">
                      {report ? report.pageLoad.detail : 'يتم فحص سياسات التضمين وتحميل الصفحة.'}
                    </p>
                  </div>

                  {/* 5. حالة مشغل الفيديو */}
                  <div className="rounded-xl bg-[#12202b] border border-white/[0.06] p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-[#9fb2d4]">
                      <span className="inline-flex items-center gap-1.5">
                        <PlayCircle className="w-3.5 h-3.5 text-[#4CAF50]" />
                        <span>حالة مشغل الفيديو</span>
                      </span>
                      {report?.playerCheck.playbackConfirmed && (
                        <span className="text-[10px] font-black text-[#8cf091]">مؤكد</span>
                      )}
                    </div>
                    <p className="text-xs font-extrabold text-white">
                      {report ? report.playerCheck.label : 'غير مفحوص'}
                    </p>
                    <p className="text-[11px] text-[#b7c9ef]/80 leading-snug">
                      {report
                        ? report.playerCheck.detail
                        : 'يتم التحقق من جاهزية عنصر الفيديو أو قيود المصدر.'}
                    </p>
                  </div>
                </div>

                {/* Footer Diagnostics: 7. Problem Reason, 8. Last Check Time, 9. Latency ms */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-white/[0.06] text-[11px]">
                  {/* 7. سبب المشكلة إن وجدت */}
                  <div className="flex items-start gap-1.5 min-w-0">
                    {report?.status === 'confirmed_playing' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#4CAF50] shrink-0 mt-0.5" />
                    ) : report?.status === 'broken' || report?.status === 'iframe_blocked' ? (
                      <XCircle className="w-3.5 h-3.5 text-[#ff8a88] shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-[#f9c400] shrink-0 mt-0.5" />
                    )}
                    <span className="font-bold text-[#dbe6ff] leading-snug">
                      {report
                        ? report.reasonText
                        : row.suspicious
                          ? 'تحذير: الرابط يبدو كصفحة موقع عام وليس مشغل فيديو مباشر.'
                          : 'لم يتم إجراء فحص لهذا السيرفر في هذه الجلسة.'}
                    </span>
                  </div>

                  {/* 8. وقت آخر فحص + 9. مدة الاستجابة بالمللي ثانية */}
                  <div className="flex flex-wrap items-center gap-3 shrink-0 text-[#9fb2d4]">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      <span>آخر فحص: {formatCheckTime(report?.checkedAt)}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 font-latin tabular-nums">
                      <Activity className="w-3.5 h-3.5 text-sky-400" />
                      <span>{report ? `${report.latencyMs} ms` : '— ms'}</span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
