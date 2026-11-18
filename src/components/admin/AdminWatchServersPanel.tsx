import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Edit3,
  ExternalLink,
  Globe,
  Loader2,
  Palette,
  RotateCcw,
  Search,
  Server,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { checkServerUrlsInBrowser, isLikelyNonVideoWebsiteUrl } from '../../lib/clientScraper';
import { extractServerResolvedUrl } from '../../lib/contentAudit';
import { DEFAULT_PLAYER_THEME, PLAYER_THEME_PRESETS, saveStoredPlayerTheme } from '../../lib/playerTheme';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [checkingBatch, setCheckingBatch] = useState(false);
  const [probeResults, setProbeResults] = useState<
    Record<string, { ok: boolean; statusText: string }>
  >({});

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

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return serverRows.filter((r) => {
      if (hostFilter !== 'all' && r.host !== hostFilter) return false;
      if (!q) return true;
      return (
        r.mediaTitle.toLowerCase().includes(q) ||
        r.host.toLowerCase().includes(q) ||
        r.serverName.toLowerCase().includes(q)
      );
    });
  }, [serverRows, hostFilter, searchQuery]);

  const mediaMap = useMemo(() => new Map(catalog.map((m) => [m.id, m])), [catalog]);

  const handleBatchProbeVisible = async () => {
    const sample = filteredRows.slice(0, 25);
    if (sample.length === 0) return;
    setCheckingBatch(true);
    try {
      const urls = sample.map((s) => s.url);
      const checked = await checkServerUrlsInBrowser(urls);
      const next: Record<string, { ok: boolean; statusText: string }> = { ...probeResults };
      checked.forEach((res, idx) => {
        const u = sample[idx]?.url;
        if (!u) return;
        const ok = res.status === 'working';
        next[u] = {
          ok,
          statusText: res.label || (ok ? 'متاح' : 'غير مستجيب'),
        };
      });
      setProbeResults(next);
      onNotify(`تم فحص ${sample.length} رابط سيرفر من المتصفح/البروكسي.`);
    } catch (err) {
      onNotify(`تعذر إتمام الفحص: ${err instanceof Error ? err.message : 'خطأ'}`);
    } finally {
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

  // Watch Servers Health & Domain Inventory Mode
  const suspiciousCount = serverRows.filter((r) => r.suspicious).length;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-extrabold text-white flex items-center gap-2">
            <Server className="w-5 h-5 text-[#4CAF50]" />
            <span>جرد وصحة سيرفرات المشاهدة</span>
          </h2>
          <p className="text-xs text-[#b7c9ef] mt-1">
            إجمالي روابط التشغيل المفهرسة: {serverRows.length} سيرفر عبر {topHosts.length}+ نطاق مختلف.
          </p>
        </div>

        <button
          type="button"
          disabled={checkingBatch || filteredRows.length === 0}
          onClick={() => void handleBatchProbeVisible()}
          className="inline-flex items-center gap-2 rounded-xl bg-[#f9c400] hover:bg-[#dfb20b] disabled:opacity-50 px-4 py-2.5 text-xs font-black text-[#06131c] cursor-pointer"
        >
          {checkingBatch ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
          <span>فحص أول 25 سيرفر الآن</span>
        </button>
      </div>

      {/* Host distribution chips */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-extrabold text-[#b7c9ef] flex items-center gap-1.5">
            <Globe className="w-4 h-4 text-sky-400" />
            <span>النطاقات المستضيفة للسيرفرات (اضغط للتصفية)</span>
          </h3>
          {suspiciousCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-[#D92321]/15 border border-[#D92321]/35 px-2.5 py-1 text-[11px] font-extrabold text-[#ff9f9d]">
              <ShieldAlert className="w-3.5 h-3.5" />
              {suspiciousCount} رابط مشبوه (قد يكون صفحة قسم/موقع)
            </span>
          )}
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
            placeholder="بحث باسم العمل أو النطاق أو اسم السيرفر..."
            className="w-full rounded-xl bg-[#1a242e] border border-white/10 pr-10 pl-3 py-2 text-xs text-white focus:border-[#f9c400] focus:outline-none"
          />
        </div>
      </div>

      {/* Inventory Table */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] overflow-hidden">
        <div className="max-h-[480px] overflow-auto divide-y divide-white/[0.06]">
          {filteredRows.slice(0, 120).map((row, idx) => {
            const mediaItem = mediaMap.get(row.mediaId);
            const probe = probeResults[row.url];
            return (
              <div
                key={`${row.mediaId}_${idx}`}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 hover:bg-white/[0.02]"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-extrabold text-white truncate">
                      {row.mediaTitle}
                    </span>
                    <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] font-bold text-[#b7c9ef]">
                      {row.locationLabel}
                    </span>
                    <span className="rounded bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-sky-300 font-latin">
                      {row.host}
                    </span>
                    {row.suspicious && (
                      <span className="rounded bg-[#D92321]/20 px-2 py-0.5 text-[10px] font-black text-[#ff9f9d]">
                        رابط مشبوه
                      </span>
                    )}
                    {probe && (
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-black ${
                          probe.ok
                            ? 'bg-[#4CAF50]/20 text-[#a6f5a9]'
                            : 'bg-[#D92321]/20 text-[#ff9f9d]'
                        }`}
                      >
                        {probe.statusText}
                      </span>
                    )}
                  </div>
                  <p className="font-latin text-[10px] text-[#b7c9ef] truncate" dir="ltr">
                    {row.serverName}: {row.url}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg bg-[#1a242e] hover:bg-white/10 p-2 text-[#b7c9ef] hover:text-white"
                    title="فتح الرابط"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  {mediaItem && (
                    <button
                      type="button"
                      onClick={() => onEditMedia(mediaItem)}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#1a242e] hover:bg-[#D92321] px-3 py-1.5 text-[11px] font-bold text-white cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>تعديل</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
