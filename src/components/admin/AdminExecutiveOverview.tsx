import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Database,
  Eye,
  Film,
  Heart,
  Image as ImageIcon,
  Layers,
  MessageSquarePlus,
  Plus,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  Users,
  Wand2,
} from 'lucide-react';
import { CATALOG_ITEMS } from '../../data/catalog';
import { ClientErrorRecord, loadClientErrorLogs } from '../../lib/adminPreferences';
import {
  extractServerResolvedUrl,
  isSuspiciousServerUrl,
  runCatalogContentAudit,
} from '../../lib/contentAudit';
import {
  CrawlTaskRecord,
  loadCrawlTasks,
  subscribeCrawlTasks,
} from '../../lib/crawlTasksDb';
import { getMediaImageQualityStatus, getPosterUrl } from '../../lib/mediaImages';
import {
  type AggregatedAnalyticsSummary,
  type AnalyticsTimeframe,
  loadMergedAnalyticsSummary,
} from '../../lib/analytics';
import {
  AdminRoleRecord,
  MediaItem,
  MediaKind,
  SiteSettings,
  UserProfileRecord,
  VisitorRequest,
} from '../../types/media';
import type { AdminTab } from './adminNavigation';

const KIND_LABELS: Record<MediaKind, string> = {
  movie: 'فيلم',
  series: 'مسلسل',
  tv: 'برنامج / مسرحية',
  wrestling: 'مصارعة حرة',
};

interface AdminExecutiveOverviewProps {
  mode: 'overview' | 'analytics';
  catalog: MediaItem[];
  requests: VisitorRequest[];
  usersList: UserProfileRecord[];
  adminsList: AdminRoleRecord[];
  siteSettings: SiteSettings;
  isFirestoreSeeded: boolean;
  busyAction: boolean;
  customApiUrl: string;
  onSeedDatabase: () => void;
  onNavigateTab: (tab: AdminTab) => void;
  onOpenNewMedia: () => void;
  onEditMedia: (item: MediaItem) => void;
}

export function AdminExecutiveOverview({
  mode,
  catalog,
  requests,
  usersList,
  adminsList,
  siteSettings,
  isFirestoreSeeded,
  busyAction,
  customApiUrl,
  onSeedDatabase,
  onNavigateTab,
  onOpenNewMedia,
  onEditMedia,
}: AdminExecutiveOverviewProps) {
  const [analyticsSort, setAnalyticsSort] = useState<'views' | 'rating' | 'likes'>('views');
  const [analyticsTimeframe, setAnalyticsTimeframe] = useState<AnalyticsTimeframe>('weekly');
  const [analyticsSummary, setAnalyticsSummary] = useState<AggregatedAnalyticsSummary | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [crawlTasks, setCrawlTasks] = useState<CrawlTaskRecord[]>(() => loadCrawlTasks());
  const [clientErrors, setClientErrors] = useState<ClientErrorRecord[]>(() => loadClientErrorLogs());

  useEffect(() => {
    setCrawlTasks(loadCrawlTasks());
    setClientErrors(loadClientErrorLogs());
    return subscribeCrawlTasks(() => {
      setCrawlTasks(loadCrawlTasks());
    });
  }, []);

  useEffect(() => {
    if (mode !== 'analytics') return;
    let active = true;
    setLoadingAnalytics(true);
    void loadMergedAnalyticsSummary(analyticsTimeframe)
      .then((res) => {
        if (active) setAnalyticsSummary(res);
      })
      .finally(() => {
        if (active) setLoadingAnalytics(false);
      });
    return () => {
      active = false;
    };
  }, [mode, analyticsTimeframe]);

  const auditReport = useMemo(() => runCatalogContentAudit(catalog), [catalog]);

  const metrics = useMemo(() => {
    const totalViews = catalog.reduce((sum, item) => sum + (item.views || 0), 0);
    const totalLikes = catalog.reduce((sum, item) => sum + (item.likes || 0), 0);
    const pendingRequests = requests.filter((r) => r.status === 'pending').length;
    const pinnedCount = catalog.filter((c) => c.pinned).length;
    const ratedItems = catalog.filter((c) => (c.communityRating?.count || 0) > 0);
    const avgImdb =
      ratedItems.length > 0
        ? (
            ratedItems.reduce((s, c) => s + (c.communityRating?.average || 0), 0) /
            ratedItems.length
          ).toFixed(1)
        : '0.0';

    let totalServers = 0;
    let healthyServers = 0;
    let suspiciousServers = 0;
    let totalEpisodes = 0;
    let totalSeasons = 0;
    let hqImages = 0;

    const inspectServerList = (servers?: Array<{ url?: string; embedCode?: string }>) => {
      for (const srv of servers || []) {
        totalServers += 1;
        const resolved = extractServerResolvedUrl(srv);
        if (isSuspiciousServerUrl(resolved)) {
          suspiciousServers += 1;
        } else {
          healthyServers += 1;
        }
      }
    };

    for (const item of catalog) {
      inspectServerList(item.servers);
      if (item.seasons) {
        totalSeasons += item.seasons.length;
        for (const s of item.seasons) {
          totalEpisodes += s.episodes?.length || 0;
          for (const ep of s.episodes || []) {
            inspectServerList(ep.servers);
          }
        }
      }
      if (getMediaImageQualityStatus(item) === 'high') hqImages += 1;
    }

    const healthScore =
      catalog.length > 0
        ? Math.round((auditReport.healthyCount / catalog.length) * 100)
        : 100;

    return {
      totalViews,
      totalLikes,
      pendingRequests,
      pinnedCount,
      avgImdb,
      totalServers,
      healthyServers,
      suspiciousServers,
      totalEpisodes,
      totalSeasons,
      hqImages,
      healthScore,
    };
  }, [catalog, requests, auditReport.healthyCount]);

  const recentMedia = useMemo(() => catalog.slice(0, 5), [catalog]);
  const runningCrawlCount = useMemo(
    () => crawlTasks.filter((t) => t.status === 'running').length,
    [crawlTasks]
  );

  const topGenres = useMemo(() => {
    const map = new Map<string, { count: number; views: number }>();
    for (const item of catalog) {
      for (const g of item.genres || []) {
        const clean = g.trim();
        if (!clean) continue;
        const curr = map.get(clean) || { count: 0, views: 0 };
        curr.count += 1;
        curr.views += item.views || 0;
        map.set(clean, curr);
      }
    }
    return Array.from(map.entries())
      .map(([genre, stats]) => ({ genre, ...stats }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [catalog]);

  const qualityDistribution = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of catalog) {
      const q = (item.quality || 'غير محدد').trim();
      map.set(q, (map.get(q) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([quality, count]) => ({ quality, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [catalog]);

  const rankedMedia = useMemo(() => {
    return [...catalog]
      .sort((a, b) => {
        if (analyticsSort === 'rating') {
          const rA = a.communityRating?.average || 0;
          const rB = b.communityRating?.average || 0;
          return rB - rA;
        }
        if (analyticsSort === 'likes') {
          return (b.likes || 0) - (a.likes || 0);
        }
        return (b.views || 0) - (a.views || 0);
      })
      .slice(0, 10);
  }, [catalog, analyticsSort]);

  if (mode === 'analytics') {
    return (
      <div className="space-y-6">
        <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-extrabold text-white flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-[#f9c400]" />
              <span>التحليلات المتقدمة وأداء المكتبة</span>
            </h2>
            <p className="text-xs text-[#b7c9ef] mt-1">
              تحليل حقيقي للمشاهدات والتقييمات وتوزيع التصنيفات والجودات عبر {catalog.length} عمل و{metrics.totalEpisodes} حلقة.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1 rounded-xl bg-[#1a242e] p-1 border border-white/10">
              {(
                [
                  { id: 'daily', label: 'يومي' },
                  { id: 'weekly', label: 'أسبوعي' },
                  { id: 'monthly', label: 'شهري' },
                ] as const
              ).map((tf) => (
                <button
                  key={tf.id}
                  type="button"
                  onClick={() => setAnalyticsTimeframe(tf.id)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-extrabold cursor-pointer transition-colors ${
                    analyticsTimeframe === tf.id
                      ? 'bg-[#f9c400] text-[#06131c]'
                      : 'text-[#b7c9ef] hover:text-white'
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-1.5 rounded-xl bg-[#1a242e] p-1 border border-white/10">
              {(
                [
                  { id: 'views', label: 'الأكثر مشاهدة' },
                  { id: 'rating', label: 'الأعلى تقييماً' },
                  { id: 'likes', label: 'الأكثر إعجاباً' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAnalyticsSort(opt.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-extrabold cursor-pointer transition-colors ${
                    analyticsSort === opt.id
                      ? 'bg-[#D92321] text-white'
                      : 'text-[#b7c9ef] hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Real Usage Events Summary (Non-fabricated) */}
        <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-sm font-extrabold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#4CAF50]" />
              <span>
                إحصاءات التشغيل الحقيقية (
                {analyticsTimeframe === 'daily'
                  ? 'اليوم'
                  : analyticsTimeframe === 'weekly'
                    ? 'آخر 7 أيام'
                    : 'آخر 30 يوماً'}
                )
              </span>
            </h3>
            <span className="text-[11px] font-bold text-[#9fb2d4]">
              {loadingAnalytics
                ? 'جاري التحديث...'
                : `تم احتساب ${analyticsSummary?.daysCount || 0} يوم مسجل`}
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl bg-[#12202b] border border-white/[0.06] p-3.5">
              <p className="text-[11px] font-bold text-[#b7c9ef]">مرات بدء التشغيل</p>
              <p className="font-latin text-2xl font-black text-white mt-1 tabular-nums">
                {(analyticsSummary?.playbackStarts || 0).toLocaleString('en-US')}
              </p>
            </div>
            <div className="rounded-2xl bg-[#12202b] border border-white/[0.06] p-3.5">
              <p className="text-[11px] font-bold text-[#b7c9ef]">إكمال المشاهدة (85%+)</p>
              <p className="font-latin text-2xl font-black text-[#8cf091] mt-1 tabular-nums">
                {(analyticsSummary?.playbackCompletes || 0).toLocaleString('en-US')}
              </p>
            </div>
            <div className="rounded-2xl bg-[#12202b] border border-white/[0.06] p-3.5">
              <p className="text-[11px] font-bold text-[#b7c9ef]">معدل الإكمال الحقيقي</p>
              <p className="font-latin text-2xl font-black text-[#f9c400] mt-1 tabular-nums">
                {analyticsSummary?.completionRatePct || 0}%
              </p>
            </div>
            <div className="rounded-2xl bg-[#12202b] border border-white/[0.06] p-3.5">
              <p className="text-[11px] font-bold text-[#b7c9ef]">إضافات قائمة المشاهدة</p>
              <p className="font-latin text-2xl font-black text-sky-300 mt-1 tabular-nums">
                {(analyticsSummary?.watchlistAdds || 0).toLocaleString('en-US')}
              </p>
            </div>
          </div>

          {analyticsSummary &&
            (analyticsSummary.topMedia.length > 0 ||
              analyticsSummary.topEpisodes.length > 0 ||
              analyticsSummary.topGenres.length > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                <div className="rounded-2xl bg-[#12202b]/80 border border-white/[0.06] p-3.5 space-y-2">
                  <p className="text-xs font-extrabold text-white">الأعمال الأكثر تشغيلاً</p>
                  {analyticsSummary.topMedia.length === 0 ? (
                    <p className="text-[11px] text-[#9fb2d4]">لا توجد بيانات بعد.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {analyticsSummary.topMedia.slice(0, 5).map((entry) => {
                        const found = catalog.find((m) => m.id === entry.mediaId);
                        return (
                          <div
                            key={entry.mediaId}
                            className="flex items-center justify-between gap-2 text-[11px]"
                          >
                            <span className="truncate text-white font-bold">
                              {found?.title || entry.mediaId}
                            </span>
                            <span className="font-latin font-black text-[#f9c400] shrink-0 tabular-nums">
                              {entry.count}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl bg-[#12202b]/80 border border-white/[0.06] p-3.5 space-y-2">
                  <p className="text-xs font-extrabold text-white">الحلقات الأكثر تشغيلاً</p>
                  {analyticsSummary.topEpisodes.length === 0 ? (
                    <p className="text-[11px] text-[#9fb2d4]">لا توجد بيانات حلقات بعد.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {analyticsSummary.topEpisodes.slice(0, 5).map((ep) => {
                        const [mId, epTag] = ep.episodeKey.split('__');
                        const found = catalog.find((m) => m.id === mId);
                        return (
                          <div
                            key={ep.episodeKey}
                            className="flex items-center justify-between gap-2 text-[11px]"
                          >
                            <span className="truncate text-white font-bold">
                              {found ? `${found.title} (${epTag || ''})` : ep.episodeKey}
                            </span>
                            <span className="font-latin font-black text-sky-300 shrink-0 tabular-nums">
                              {ep.count}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl bg-[#12202b]/80 border border-white/[0.06] p-3.5 space-y-2">
                  <p className="text-xs font-extrabold text-white">أكثر التصنيفات تفاعلاً</p>
                  {analyticsSummary.topGenres.length === 0 ? (
                    <p className="text-[11px] text-[#9fb2d4]">لا توجد بيانات تصنيفات بعد.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {analyticsSummary.topGenres.slice(0, 5).map((g) => (
                        <div
                          key={g.genre}
                          className="flex items-center justify-between gap-2 text-[11px]"
                        >
                          <span className="truncate text-white font-bold">{g.genre}</span>
                          <span className="font-latin font-black text-[#8cf091] shrink-0 tabular-nums">
                            {g.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
        </div>

        {/* Summary KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-4">
            <span className="text-[11px] font-bold text-[#b7c9ef] flex items-center justify-between">
              <span>متوسط تقييم المشاهدين</span>
              <Star className="w-4 h-4 text-[#f9c400]" />
            </span>
            <p className="text-2xl font-black text-white mt-2 tabular-nums">
              <span dir="ltr">{metrics.avgImdb} / 5</span>
            </p>
          </div>
          <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-4">
            <span className="text-[11px] font-bold text-[#b7c9ef] flex items-center justify-between">
              <span>إجمالي الإعجابات</span>
              <Heart className="w-4 h-4 text-[#D92321]" />
            </span>
            <p className="text-2xl font-black text-white mt-2 tabular-nums">
              {metrics.totalLikes.toLocaleString('en-US')}
            </p>
          </div>
          <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-4">
            <span className="text-[11px] font-bold text-[#b7c9ef] flex items-center justify-between">
              <span>إجمالي الحلقات</span>
              <Film className="w-4 h-4 text-sky-400" />
            </span>
            <p className="text-2xl font-black text-white mt-2 tabular-nums">
              {metrics.totalEpisodes.toLocaleString('en-US')}
            </p>
          </div>
          <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-4">
            <span className="text-[11px] font-bold text-[#b7c9ef] flex items-center justify-between">
              <span>إجمالي السيرفرات</span>
              <Server className="w-4 h-4 text-[#4CAF50]" />
            </span>
            <p className="text-2xl font-black text-white mt-2 tabular-nums">
              {metrics.totalServers.toLocaleString('en-US')}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Top Ranked Media */}
          <div className="lg:col-span-7 rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-3">
            <h3 className="font-display text-base font-extrabold text-white">
              أفضل 10 أعمال حسب المعيار المختار
            </h3>
            <div className="space-y-2">
              {rankedMedia.map((item, idx) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-[#1a242e]/65 border border-white/[0.06] px-3.5 py-2.5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`h-7 w-7 rounded-lg flex items-center justify-center text-xs font-black shrink-0 ${
                        idx < 3 ? 'bg-[#f9c400] text-[#06131c]' : 'bg-[#0c1821] text-[#b7c9ef]'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold text-white truncate">{item.title}</p>
                      <p className="text-[10px] text-[#b7c9ef]">
                        {KIND_LABELS[item.kind]} • {item.year} • {item.quality}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-latin text-xs font-black text-[#f9c400] tabular-nums">
                      {analyticsSort === 'views' && `${(item.views || 0).toLocaleString('en-US')} مشاهدة`}
                      {analyticsSort === 'rating' &&
                        (item.communityRating && item.communityRating.count > 0
                          ? `★ ${item.communityRating.average.toFixed(1)}/5`
                          : '—')}
                      {analyticsSort === 'likes' && `${(item.likes || 0).toLocaleString('en-US')} إعجاب`}
                    </span>
                    <button
                      type="button"
                      onClick={() => onEditMedia(item)}
                      className="rounded-lg bg-white/10 hover:bg-[#D92321] px-2.5 py-1 text-[11px] font-bold text-white cursor-pointer"
                    >
                      تعديل
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Genres & Qualities Breakdown */}
          <div className="lg:col-span-5 space-y-6">
            <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-3.5">
              <h3 className="font-display text-base font-extrabold text-white">
                توزيع التصنيفات الأعلى حضوراً
              </h3>
              {topGenres.length === 0 ? (
                <p className="text-xs text-[#b7c9ef]">لا توجد تصنيفات مسجلة بعد.</p>
              ) : (
                topGenres.map((g) => {
                  const pct = catalog.length ? Math.round((g.count / catalog.length) * 100) : 0;
                  return (
                    <div key={g.genre} className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span className="text-white">{g.genre}</span>
                        <span className="text-[#b7c9ef] tabular-nums">
                          {g.count} عمل ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-[#1a242e] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-l from-[#D92321] to-[#f9c400]"
                          style={{ width: `${Math.max(4, pct)}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-3">
              <h3 className="font-display text-base font-extrabold text-white">
                توزيع جودات البث
              </h3>
              <div className="flex flex-wrap gap-2">
                {qualityDistribution.map((q) => (
                  <div
                    key={q.quality}
                    className="rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 flex items-center gap-2"
                  >
                    <span className="font-latin text-xs font-black text-[#f9c400]">{q.quality}</span>
                    <span className="text-[11px] font-bold text-[#b7c9ef] tabular-nums">
                      {q.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Executive Dashboard Overview Mode
  return (
    <div className="space-y-6">
      {!isFirestoreSeeded && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-3xl bg-gradient-to-l from-[#D92321]/20 via-[#1a242e] to-[#0c1821] border border-[#D92321]/40 p-5">
          <div>
            <h2 className="font-display text-base font-extrabold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#f9c400]" />
              تهيئة قاعدة البيانات لأول مرة
            </h2>
            <p className="text-xs text-[#b7c9ef] mt-1">
              المكتبة المعروضة حاليًا هي البيانات المبدئية. اضغط لاستيراد الـ {CATALOG_ITEMS.length} عملًا إلى Firestore لتتمكن من تعديلها وحذفها وحفظها فعليًا.
            </p>
          </div>
          <button
            type="button"
            disabled={busyAction}
            onClick={onSeedDatabase}
            className="shrink-0 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-50 px-5 py-3 text-xs font-extrabold text-white shadow-lg cursor-pointer"
          >
            {busyAction ? 'جاري الاستيراد...' : 'استيراد المكتبة إلى Firestore الآن'}
          </button>
        </div>
      )}

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-5">
          <div className="flex items-center justify-between text-xs text-[#b7c9ef] mb-2">
            <span>إجمالي الأعمال</span>
            <Film className="w-4 h-4 text-[#D92321]" />
          </div>
          <p className="text-3xl font-black text-white tabular-nums">{catalog.length}</p>
          <p className="text-[11px] text-[#4CAF50] mt-1 font-bold">
            {isFirestoreSeeded ? 'محفوظة في Firestore' : 'بيانات مبدئية'} • {metrics.pinnedCount} مثبت
          </p>
        </div>

        <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-5">
          <div className="flex items-center justify-between text-xs text-[#b7c9ef] mb-2">
            <span>إجمالي المشاهدات</span>
            <Eye className="w-4 h-4 text-[#f9c400]" />
          </div>
          <p className="text-3xl font-black text-white tabular-nums">
            {metrics.totalViews.toLocaleString('en-US')}
          </p>
          <p className="text-[11px] text-[#b7c9ef] mt-1">
            متوسط التقييم: ★ {metrics.avgImdb}
          </p>
        </div>

        <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-5">
          <div className="flex items-center justify-between text-xs text-[#b7c9ef] mb-2">
            <span>صحة جودة المحتوى</span>
            <Activity className="w-4 h-4 text-[#4CAF50]" />
          </div>
          <p className="text-3xl font-black text-white tabular-nums">{metrics.healthScore}%</p>
          <p className="text-[11px] text-[#b7c9ef] mt-1">
            {auditReport.countsBySeverity.critical > 0
              ? `${auditReport.countsBySeverity.critical} مشكلة حرجة تتطلب مراجعة`
              : 'لا توجد أخطاء حرجة'}
          </p>
        </div>

        <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-5">
          <div className="flex items-center justify-between text-xs text-[#b7c9ef] mb-2">
            <span>الجمهور والطلبات</span>
            <Users className="w-4 h-4 text-sky-400" />
          </div>
          <p className="text-3xl font-black text-white tabular-nums">{usersList.length}</p>
          <p className="text-[11px] text-[#b7c9ef] mt-1">
            طلبات معلّقة: {metrics.pendingRequests} • مشرفون: {adminsList.length}
          </p>
        </div>
      </div>

      {/* Quick Operational Launchpad + Status Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-extrabold text-white">
              إجراءات إدارية سريعة
            </h2>
            <span className="text-[11px] font-bold text-[#b7c9ef]">وصول مباشر بدون تنقل مطوّل</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={onOpenNewMedia}
              className="rounded-2xl bg-[#D92321]/15 hover:bg-[#D92321] border border-[#D92321]/40 p-3.5 text-right transition-colors cursor-pointer group"
            >
              <Plus className="w-5 h-5 text-[#ff8a88] group-hover:text-white mb-2" />
              <p className="text-xs font-extrabold text-white">إضافة عمل جديد</p>
              <p className="text-[10px] text-[#b7c9ef] group-hover:text-white/80 mt-0.5">فيلم أو مسلسل</p>
            </button>

            <button
              type="button"
              onClick={() => onNavigateTab('scraper')}
              className="rounded-2xl bg-[#1a242e] hover:bg-[#4CAF50]/20 border border-white/10 hover:border-[#4CAF50]/40 p-3.5 text-right transition-colors cursor-pointer"
            >
              <Wand2 className="w-5 h-5 text-[#4CAF50] mb-2" />
              <p className="text-xs font-extrabold text-white">جلب عمل بالرابط</p>
              <p className="text-[10px] text-[#b7c9ef] mt-0.5">استخراج تلقائي</p>
            </button>

            <button
              type="button"
              onClick={() => onNavigateTab('bulk_editor')}
              className="rounded-2xl bg-[#1a242e] hover:bg-sky-500/15 border border-white/10 hover:border-sky-400/40 p-3.5 text-right transition-colors cursor-pointer"
            >
              <BarChart3 className="w-5 h-5 text-sky-400 mb-2" />
              <p className="text-xs font-extrabold text-white">التعديل الجماعي</p>
              <p className="text-[10px] text-[#b7c9ef] mt-0.5">تحديث عدة أعمال</p>
            </button>

            <button
              type="button"
              onClick={() => onNavigateTab('content_audit')}
              className="rounded-2xl bg-[#1a242e] hover:bg-[#f9c400]/15 border border-white/10 hover:border-[#f9c400]/40 p-3.5 text-right transition-colors cursor-pointer"
            >
              <AlertTriangle className="w-5 h-5 text-[#f9c400] mb-2" />
              <p className="text-xs font-extrabold text-white">فحص جودة الكتالوج</p>
              <p className="text-[10px] text-[#b7c9ef] mt-0.5">
                {auditReport.findings.length} ملاحظة مكتشفة
              </p>
            </button>

            <button
              type="button"
              onClick={() => onNavigateTab('images')}
              className="rounded-2xl bg-[#1a242e] hover:bg-white/10 border border-white/10 p-3.5 text-right transition-colors cursor-pointer"
            >
              <ImageIcon className="w-5 h-5 text-purple-400 mb-2" />
              <p className="text-xs font-extrabold text-white">إدارة الصور (HQ)</p>
              <p className="text-[10px] text-[#b7c9ef] mt-0.5">
                {metrics.hqImages} / {catalog.length} عالية الدقة
              </p>
            </button>

            <button
              type="button"
              onClick={() => onNavigateTab('system_health')}
              className="rounded-2xl bg-[#1a242e] hover:bg-white/10 border border-white/10 p-3.5 text-right transition-colors cursor-pointer"
            >
              <ShieldCheck className="w-5 h-5 text-[#4CAF50] mb-2" />
              <p className="text-xs font-extrabold text-white">فحص صحة النظام</p>
              <p className="text-[10px] text-[#b7c9ef] mt-0.5">Firebase و Worker</p>
            </button>
          </div>
        </div>

        {/* Distribution & Status */}
        <div className="lg:col-span-5 rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-4">
          <h2 className="font-display text-base font-extrabold text-white">
            توزيع المكتبة وحالة الربط
          </h2>

          <div className="space-y-2.5">
            {(['movie', 'series', 'tv', 'wrestling'] as MediaKind[]).map((kind) => {
              const count = catalog.filter((c) => c.kind === kind).length;
              const pct = catalog.length ? Math.round((count / catalog.length) * 100) : 0;
              return (
                <div key={kind} className="space-y-1">
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-white">{KIND_LABELS[kind]}</span>
                    <span className="text-[#b7c9ef] tabular-nums">
                      {count} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[#1a242e] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#D92321]"
                      style={{ width: `${Math.max(count > 0 ? 4 : 0, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-2 border-t border-white/10 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[#b7c9ef] flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-[#4CAF50]" />
                حالة وضع الصيانة
              </span>
              <span
                className={`rounded-md px-2 py-0.5 text-[10px] font-black ${
                  siteSettings.maintenanceMode
                    ? 'bg-[#D92321] text-white'
                    : 'bg-[#4CAF50]/20 text-[#4CAF50]'
                }`}
              >
                {siteSettings.maintenanceMode ? 'مُفعّل للزوار' : 'الموقع مفتوح للجميع'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[#b7c9ef] flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-sky-400" />
                Cloudflare Worker Proxy
              </span>
              <span className="text-[11px] font-bold text-white truncate max-w-[170px]" dir="ltr">
                {customApiUrl ? customApiUrl.replace(/^https?:\/\//, '') : 'غير مضاف (افتراضي)'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[#b7c9ef] flex items-center gap-1.5">
                <MessageSquarePlus className="w-3.5 h-3.5 text-[#f9c400]" />
                الطلبات المعلّقة
              </span>
              <button
                type="button"
                onClick={() => onNavigateTab('requests')}
                className="text-[11px] font-extrabold text-[#f9c400] hover:underline cursor-pointer"
              >
                {metrics.pendingRequests} طلب بانتظار المراجعة &larr;
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Live Crawl Tasks + Client Errors Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-sm font-extrabold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#4CAF50]" />
              <span>عمليات الجلب الأخيرة ({crawlTasks.length})</span>
              {runningCrawlCount > 0 && (
                <span className="rounded-md bg-[#4CAF50]/20 px-2 py-0.5 text-[10px] font-black text-[#4CAF50]">
                  {runningCrawlCount} جارية الآن
                </span>
              )}
            </h3>
            <button
              type="button"
              onClick={() => onNavigateTab('crawl_operations')}
              className="text-[11px] font-extrabold text-[#f9c400] hover:underline cursor-pointer"
            >
              مركز العمليات &larr;
            </button>
          </div>

          {crawlTasks.length === 0 ? (
            <p className="rounded-2xl bg-[#1a242e]/50 border border-white/[0.06] p-4 text-xs text-[#b7c9ef]">
              لم تُنفذ عمليات جلب مسجلة في هذه الجلسة بعد.
            </p>
          ) : (
            <div className="space-y-2">
              {crawlTasks.slice(0, 4).map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-[#1a242e]/65 border border-white/[0.06] px-3.5 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-extrabold text-white truncate">{task.title}</p>
                    <p className="font-latin text-[10px] text-[#b7c9ef] truncate mt-0.5" dir="ltr">
                      {task.targetUrl || '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-latin text-[10px] text-[#b7c9ef] tabular-nums">
                      {task.completedItems}/{task.totalItems}
                    </span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-black ${
                        task.status === 'running'
                          ? 'bg-sky-500/20 text-sky-300'
                          : task.status === 'completed'
                            ? 'bg-[#4CAF50]/20 text-[#4CAF50]'
                            : task.status === 'cancelled'
                              ? 'bg-[#f9c400]/20 text-[#f9c400]'
                              : 'bg-[#D92321]/20 text-[#ff8a88]'
                      }`}
                    >
                      {task.status === 'running'
                        ? 'جارية'
                        : task.status === 'completed'
                          ? 'مكتملة'
                          : task.status === 'cancelled'
                            ? 'متوقفة'
                            : 'فشلت'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-6 rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-sm font-extrabold text-white flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-[#f9c400]" />
              <span>أحدث تنبيهات المتصفح ({clientErrors.length})</span>
            </h3>
            <button
              type="button"
              onClick={() => onNavigateTab('audit_logs')}
              className="text-[11px] font-extrabold text-[#f9c400] hover:underline cursor-pointer"
            >
              فتح السجل الكامل &larr;
            </button>
          </div>

          {clientErrors.length === 0 ? (
            <p className="rounded-2xl bg-[#4CAF50]/10 border border-[#4CAF50]/25 p-4 text-xs font-bold text-[#4CAF50]">
              لا توجد أخطاء متصفح مسجلة — التطبيق يعمل باستقرار.
            </p>
          ) : (
            <div className="space-y-2">
              {clientErrors.slice(0, 4).map((err) => (
                <div
                  key={err.id}
                  className="rounded-2xl bg-[#1a242e]/65 border border-white/[0.06] px-3.5 py-2.5 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-latin text-[10px] font-black text-[#f9c400] truncate">
                      {err.scope}
                    </span>
                    <span className="font-latin text-[10px] text-[#b7c9ef] tabular-nums shrink-0">
                      {new Date(err.createdAt).toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="text-[11px] text-white/90 line-clamp-1">{err.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recently Added Works + Servers Summary */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-display text-sm font-extrabold text-white">
              أحدث الأعمال في المكتبة
            </h3>
            <span className="text-[11px] font-bold text-[#b7c9ef] tabular-nums">
              {metrics.totalSeasons} موسم • {metrics.totalEpisodes} حلقة • {metrics.healthyServers} سيرفر سليم
              {metrics.suspiciousServers > 0 ? ` • ${metrics.suspiciousServers} رابط يحتاج مراجعة` : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('catalog')}
            className="text-[11px] font-extrabold text-[#f9c400] hover:underline cursor-pointer"
          >
            إدارة الكتالوج بالكامل &larr;
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {recentMedia.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onEditMedia(item)}
              className="group flex items-center gap-3 rounded-2xl bg-[#1a242e]/70 hover:bg-[#1a242e] border border-white/[0.06] hover:border-[#D92321]/50 p-2.5 text-right transition-all cursor-pointer"
            >
              <img
                src={getPosterUrl(item)}
                alt={item.title}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                className="h-14 w-10 rounded-lg object-cover shrink-0 bg-[#06131c]"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-extrabold text-white group-hover:text-[#f9c400] truncate">
                  {item.title}
                </p>
                <p className="text-[10px] text-[#b7c9ef] mt-0.5 truncate">
                  {KIND_LABELS[item.kind]} • {item.year}
                  {item.communityRating && item.communityRating.count > 0
                    ? ` • ★ ${item.communityRating.average.toFixed(1)}/5`
                    : ''}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Audit Attention Strip */}
      {auditReport.findings.length > 0 && (
        <div className="rounded-3xl bg-[#0c1821] border border-[#f9c400]/30 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-[#f9c400] shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-extrabold text-white">
                ملخص فحص جودة المكتبة التلقائي
              </h3>
              <p className="text-xs text-[#b7c9ef] mt-1">
                تم رصد {auditReport.countsByCategory.duplicate} تكرار محتمل •{' '}
                {auditReport.countsByCategory.zero_servers} عمل بدون سيرفرات •{' '}
                {auditReport.countsByCategory.incomplete_episodes} فجوات حلقات •{' '}
                {auditReport.countsByCategory.missing_media_assets} صور ناقصة.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('content_audit')}
            className="shrink-0 rounded-xl bg-[#f9c400] hover:bg-[#dfb20b] px-4 py-2.5 text-xs font-black text-[#06131c] cursor-pointer"
          >
            عرض تقرير الفحص الكامل
          </button>
        </div>
      )}
    </div>
  );
}
