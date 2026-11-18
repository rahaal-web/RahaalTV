import { useMemo, useState } from 'react';
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
  MessageSquarePlus,
  Plus,
  Server,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  Users,
  Wand2,
} from 'lucide-react';
import { CATALOG_ITEMS } from '../../data/catalog';
import { runCatalogContentAudit } from '../../lib/contentAudit';
import { getMediaImageQualityStatus } from '../../lib/mediaImages';
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

  const auditReport = useMemo(() => runCatalogContentAudit(catalog), [catalog]);

  const metrics = useMemo(() => {
    const totalViews = catalog.reduce((sum, item) => sum + (item.views || 0), 0);
    const totalLikes = catalog.reduce((sum, item) => sum + (item.likes || 0), 0);
    const pendingRequests = requests.filter((r) => r.status === 'pending').length;
    const pinnedCount = catalog.filter((c) => c.pinned).length;
    const avgImdb =
      catalog.length > 0
        ? (catalog.reduce((s, c) => s + (Number(c.imdb) || 0), 0) / catalog.length).toFixed(1)
        : '0.0';

    let totalServers = 0;
    let totalEpisodes = 0;
    let hqImages = 0;
    for (const item of catalog) {
      totalServers += item.servers?.length || 0;
      if (item.seasons) {
        for (const s of item.seasons) {
          totalEpisodes += s.episodes?.length || 0;
          for (const ep of s.episodes || []) {
            totalServers += ep.servers?.length || 0;
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
      totalEpisodes,
      hqImages,
      healthScore,
    };
  }, [catalog, requests, auditReport.healthyCount]);

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
          const rA = a.communityRating?.average || a.imdb || 0;
          const rB = b.communityRating?.average || b.imdb || 0;
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

        {/* Summary KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-4">
            <span className="text-[11px] font-bold text-[#b7c9ef] flex items-center justify-between">
              <span>متوسط تقييم IMDb</span>
              <Star className="w-4 h-4 text-[#f9c400]" />
            </span>
            <p className="text-2xl font-black text-white mt-2 tabular-nums">{metrics.avgImdb} / 10</p>
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
                        `★ ${(item.communityRating?.average || item.imdb || 0).toFixed(1)}`}
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
