import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Film,
  Image as ImageIcon,
  Layers,
  RefreshCw,
  ServerCrash,
  ShieldAlert,
} from 'lucide-react';
import {
  AuditIssueCategory,
  AuditSeverity,
  runCatalogContentAudit,
} from '../../lib/contentAudit';
import { MediaItem } from '../../types/media';

interface AdminContentAuditPanelProps {
  catalog: MediaItem[];
  onEditMedia: (item: MediaItem) => void;
  onNavigateImages: () => void;
}

const CATEGORY_LABELS: Record<AuditIssueCategory, string> = {
  duplicate: 'تكرارات محتملة',
  zero_servers: 'بدون سيرفرات تشغيل',
  suspicious_server_url: 'روابط سيرفرات مشبوهة',
  incomplete_episodes: 'حلقات ومواسم ناقصة',
  missing_media_assets: 'صور / خلفيات مفقودة',
  missing_metadata: 'بيانات وصفية ناقصة',
};

const SEVERITY_BADGE: Record<AuditSeverity, { label: string; cls: string }> = {
  critical: {
    label: 'حرج',
    cls: 'bg-[#D92321]/20 border-[#D92321]/50 text-[#ff9f9d]',
  },
  warning: {
    label: 'تحذير',
    cls: 'bg-[#f9c400]/15 border-[#f9c400]/45 text-[#f9c400]',
  },
  info: {
    label: 'ملاحظة',
    cls: 'bg-sky-500/15 border-sky-400/40 text-sky-300',
  },
};

export function AdminContentAuditPanel({
  catalog,
  onEditMedia,
  onNavigateImages,
}: AdminContentAuditPanelProps) {
  const [categoryFilter, setCategoryFilter] = useState<'all' | AuditIssueCategory>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | AuditSeverity>('all');
  const [scanNonce, setScanNonce] = useState(0);

  const report = useMemo(() => {
    void scanNonce;
    return runCatalogContentAudit(catalog);
  }, [catalog, scanNonce]);

  const filteredFindings = useMemo(() => {
    return report.findings.filter((f) => {
      if (categoryFilter !== 'all' && f.category !== categoryFilter) return false;
      if (severityFilter !== 'all' && f.severity !== severityFilter) return false;
      return true;
    });
  }, [report.findings, categoryFilter, severityFilter]);

  const mediaMap = useMemo(() => new Map(catalog.map((m) => [m.id, m])), [catalog]);

  return (
    <div className="space-y-6">
      {/* Header & Rescan */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-extrabold text-white flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-[#f9c400]" />
            <span>مركز فحص جودة المحتوى والتكرارات</span>
          </h2>
          <p className="text-xs text-[#b7c9ef] mt-1">
            تحليل شامل لـ {report.scannedCount} عمل لاكتشاف التكرارات، الحلقات المفقودة في التسلسل، السيرفرات الفارغة أو المشبوهة، والصور الناقصة.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onNavigateImages}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3.5 py-2 text-xs font-bold text-white cursor-pointer"
          >
            <ImageIcon className="w-4 h-4 text-purple-400" />
            <span>معالج الصور HQ</span>
          </button>

          <button
            type="button"
            onClick={() => setScanNonce((n) => n + 1)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#D92321] hover:bg-[#dc0e30] px-4 py-2 text-xs font-extrabold text-white cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>إعادة الفحص الآن</span>
          </button>
        </div>
      </div>

      {/* Category Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {(Object.keys(CATEGORY_LABELS) as AuditIssueCategory[]).map((cat) => {
          const count = report.countsByCategory[cat];
          const active = categoryFilter === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(active ? 'all' : cat)}
              className={`rounded-2xl border p-3.5 text-right transition-all cursor-pointer ${
                active
                  ? 'bg-[#D92321]/20 border-[#D92321]'
                  : 'bg-[#0c1821] border-white/[0.08] hover:border-white/25'
              }`}
            >
              <p className="text-[11px] font-bold text-[#b7c9ef]">{CATEGORY_LABELS[cat]}</p>
              <p className="text-2xl font-black text-white mt-1 tabular-nums">{count}</p>
            </button>
          );
        })}
      </div>

      {/* Severity Filter + Healthy Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#0c1821] border border-white/[0.08] px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-bold text-[#4CAF50]">
          <CheckCircle2 className="w-4 h-4" />
          <span>
            الأعمال السليمة تماماً: {report.healthyCount} من أصل {report.scannedCount}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: 'all', label: `الكل (${report.findings.length})` },
              { id: 'critical', label: `حرجة (${report.countsBySeverity.critical})` },
              { id: 'warning', label: `تحذيرات (${report.countsBySeverity.warning})` },
              { id: 'info', label: `ملاحظات (${report.countsBySeverity.info})` },
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSeverityFilter(s.id)}
              className={`rounded-lg px-3 py-1 text-xs font-bold cursor-pointer ${
                severityFilter === s.id
                  ? 'bg-[#f9c400] text-[#06131c]'
                  : 'bg-[#1a242e] text-[#b7c9ef] hover:text-white'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Findings List */}
      {filteredFindings.length === 0 ? (
        <div className="rounded-3xl bg-[#0c1821] border border-[#4CAF50]/30 p-10 text-center space-y-2">
          <CheckCircle2 className="w-8 h-8 text-[#4CAF50] mx-auto" />
          <p className="text-sm font-extrabold text-white">لا توجد مشاكل مطابقة للفلتر الحالي</p>
          <p className="text-xs text-[#b7c9ef]">الكتالوج يبدو منظماً ومتكاملاً في هذا النطاق.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredFindings.map((finding) => {
            const mediaItem = mediaMap.get(finding.mediaId);
            const badge = SEVERITY_BADGE[finding.severity];
            return (
              <div
                key={finding.id}
                className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-black ${badge.cls}`}>
                      {badge.label}
                    </span>
                    <span className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-bold text-[#b7c9ef]">
                      {CATEGORY_LABELS[finding.category]}
                    </span>
                    <h4 className="text-xs sm:text-sm font-extrabold text-white truncate">
                      {finding.title}
                    </h4>
                  </div>
                  <p className="text-xs font-bold text-[#f9c400] flex items-center gap-1.5">
                    {finding.category === 'zero_servers' ? (
                      <ServerCrash className="w-3.5 h-3.5 text-[#D92321]" />
                    ) : finding.category === 'duplicate' ? (
                      <Layers className="w-3.5 h-3.5 text-[#f9c400]" />
                    ) : finding.category === 'incomplete_episodes' ? (
                      <Film className="w-3.5 h-3.5 text-sky-400" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-[#f9c400]" />
                    )}
                    <span>{finding.summary}</span>
                  </p>
                  <p className="text-[11px] text-[#b7c9ef]">{finding.details}</p>
                </div>

                {mediaItem && (
                  <button
                    type="button"
                    onClick={() => onEditMedia(mediaItem)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-[#D92321] border border-white/10 px-4 py-2 text-xs font-extrabold text-white shrink-0 cursor-pointer transition-colors"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>تعديل وإصلاح</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
