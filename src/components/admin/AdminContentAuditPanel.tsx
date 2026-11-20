import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CheckSquare,
  Edit3,
  Film,
  Image as ImageIcon,
  Layers,
  RefreshCw,
  ServerCrash,
  ShieldAlert,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import {
  AuditIssueCategory,
  AuditSeverity,
  findDuplicateGroups,
  runCatalogContentAudit,
  scoreMediaCompleteness,
} from '../../lib/contentAudit';
import { getPosterUrl } from '../../lib/mediaImages';
import { MediaItem, MediaKind } from '../../types/media';
import { ConfirmDialog } from './AdminSharedUi';

interface AdminContentAuditPanelProps {
  catalog: MediaItem[];
  busyAction?: boolean;
  onEditMedia: (item: MediaItem) => void;
  onDeleteMediaIds?: (ids: string[]) => Promise<void> | void;
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

const KIND_LABELS: Record<MediaKind, string> = {
  movie: 'فيلم',
  series: 'مسلسل',
  tv: 'برنامج / مسرحية',
  wrestling: 'مصارعة حرة',
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
  busyAction = false,
  onEditMedia,
  onDeleteMediaIds,
  onNavigateImages,
}: AdminContentAuditPanelProps) {
  const [categoryFilter, setCategoryFilter] = useState<'all' | AuditIssueCategory>('duplicate');
  const [severityFilter, setSeverityFilter] = useState<'all' | AuditSeverity>('all');
  const [ignoreYearForDuplicates, setIgnoreYearForDuplicates] = useState(false);
  const [selectedDuplicateIds, setSelectedDuplicateIds] = useState<string[]>([]);
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | null>(null);
  const [scanNonce, setScanNonce] = useState(0);

  const report = useMemo(() => {
    void scanNonce;
    return runCatalogContentAudit(catalog);
  }, [catalog, scanNonce]);

  const duplicateGroups = useMemo(() => {
    void scanNonce;
    return findDuplicateGroups(catalog, { ignoreYear: ignoreYearForDuplicates });
  }, [catalog, ignoreYearForDuplicates, scanNonce]);

  const allExtraDuplicateIds = useMemo(
    () => duplicateGroups.flatMap((g) => g.extraIds),
    [duplicateGroups]
  );

  const validSelectedDuplicateIds = useMemo(() => {
    const existingIds = new Set(catalog.map((m) => m.id));
    return selectedDuplicateIds.filter((id) => existingIds.has(id));
  }, [catalog, selectedDuplicateIds]);

  const filteredFindings = useMemo(() => {
    return report.findings.filter((f) => {
      if (categoryFilter !== 'all' && f.category !== categoryFilter) return false;
      if (severityFilter !== 'all' && f.severity !== severityFilter) return false;
      return true;
    });
  }, [report.findings, categoryFilter, severityFilter]);

  const mediaMap = useMemo(() => new Map(catalog.map((m) => [m.id, m])), [catalog]);

  const toggleDuplicateSelection = (id: string) => {
    setSelectedDuplicateIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectAllExtraDuplicates = () => {
    setSelectedDuplicateIds(Array.from(new Set(allExtraDuplicateIds)));
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteIds || confirmDeleteIds.length === 0 || !onDeleteMediaIds) {
      setConfirmDeleteIds(null);
      return;
    }
    const targetIds = [...confirmDeleteIds];
    await onDeleteMediaIds(targetIds);
    const deletedSet = new Set(targetIds);
    setSelectedDuplicateIds((prev) => prev.filter((id) => !deletedSet.has(id)));
    setConfirmDeleteIds(null);
  };

  return (
    <div className="space-y-6">
      {/* Header & Rescan */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-extrabold text-white flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-[#f9c400]" />
            <span>مركز فحص جودة المحتوى وإدارة التكرارات</span>
          </h2>
          <p className="text-xs text-[#b7c9ef] mt-1">
            تحليل شامل لـ {report.scannedCount} عمل لاكتشاف المحتوى المكرر وتحديده وحذفه بأمان، بالإضافة إلى الحلقات المفقودة والسيرفرات المعطلة.
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
          const count =
            cat === 'duplicate' ? duplicateGroups.length : report.countsByCategory[cat];
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
              {cat === 'duplicate' && allExtraDuplicateIds.length > 0 && (
                <p className="text-[10px] font-bold text-[#f9c400] mt-0.5 tabular-nums">
                  {allExtraDuplicateIds.length} نسخة زائدة
                </p>
              )}
            </button>
          );
        })}
      </div>

      {/* Interactive Duplicate Content Manager */}
      {(categoryFilter === 'duplicate' || categoryFilter === 'all') && (
        <div className="rounded-3xl bg-[#0c1821] border border-[#f9c400]/25 p-5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div>
              <h3 className="font-display text-base font-extrabold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#f9c400]" />
                <span>تحديد وحذف المحتوى المكرر ({duplicateGroups.length} مجموعة)</span>
              </h3>
              <p className="text-xs text-[#b7c9ef] mt-1">
                يُميّز النظام تلقائياً النسخة الأكمل من حيث السيرفرات والحلقات والصور، ويمكنك تحديد النسخ المكررة تلقائياً أو يدوياً وحذفها دفعة واحدة.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2 text-xs font-bold text-[#b7c9ef] cursor-pointer">
                <input
                  type="checkbox"
                  checked={ignoreYearForDuplicates}
                  onChange={(e) => setIgnoreYearForDuplicates(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[#f9c400]"
                />
                <span>تجاهل اختلاف السنة</span>
              </label>

              {duplicateGroups.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={selectAllExtraDuplicates}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#f9c400] hover:bg-[#dfb20b] px-3.5 py-2 text-xs font-black text-[#06131c] cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>تحديد النسخ الزائدة تلقائياً ({allExtraDuplicateIds.length})</span>
                  </button>

                  {validSelectedDuplicateIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedDuplicateIds([])}
                      className="rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3 py-2 text-xs font-bold text-[#b7c9ef] cursor-pointer"
                    >
                      إلغاء التحديد
                    </button>
                  )}

                  {onDeleteMediaIds && (
                    <button
                      type="button"
                      disabled={busyAction || validSelectedDuplicateIds.length === 0}
                      onClick={() => setConfirmDeleteIds(validSelectedDuplicateIds)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#D92321] hover:bg-[#dc0e30] disabled:opacity-40 px-4 py-2 text-xs font-extrabold text-white cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف المحدد ({validSelectedDuplicateIds.length})</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {duplicateGroups.length === 0 ? (
            <div className="rounded-2xl bg-[#1a242e]/45 border border-[#4CAF50]/25 p-6 text-center space-y-1.5">
              <CheckCircle2 className="w-7 h-7 text-[#4CAF50] mx-auto" />
              <p className="text-sm font-extrabold text-white">لا يوجد محتوى مكرر حالياً</p>
              <p className="text-xs text-[#b7c9ef]">
                لم يتم العثور على أعمال متطابقة في الاسم والنوع{ignoreYearForDuplicates ? '' : ' والسنة'}. جرّب تفعيل "تجاهل اختلاف السنة" للفحص الأوسع.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {duplicateGroups.map((group) => {
                const groupExtraSelected = group.extraIds.every((id) =>
                  validSelectedDuplicateIds.includes(id)
                );
                return (
                  <div
                    key={group.key}
                    className="rounded-2xl bg-[#121f2b] border border-white/10 p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-lg bg-[#f9c400]/15 border border-[#f9c400]/40 px-2.5 py-0.5 text-[11px] font-black text-[#f9c400]">
                          {group.items.length} نسخ متطابقة
                        </span>
                        <span className="rounded-lg bg-white/5 px-2.5 py-0.5 text-[11px] font-bold text-[#b7c9ef]">
                          {KIND_LABELS[group.kind]}
                        </span>
                        <h4 className="text-sm font-extrabold text-white">{group.title}</h4>
                        <span className="text-[11px] text-[#b7c9ef]">
                          (
                          {group.matchReason === 'tmdb_id_match'
                            ? 'تطابق معرف TMDB'
                            : group.matchReason === 'title_cross_year'
                              ? 'تشابه اسم مع اختلاف السنة'
                              : group.matchReason === 'english_title_match'
                                ? 'تطابق بالاسم الإنجليزي/العربي'
                                : `سنة ${group.year}`}
                          )
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (groupExtraSelected) {
                            const extraSet = new Set(group.extraIds);
                            setSelectedDuplicateIds((prev) =>
                              prev.filter((id) => !extraSet.has(id))
                            );
                          } else {
                            setSelectedDuplicateIds((prev) =>
                              Array.from(new Set([...prev, ...group.extraIds]))
                            );
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3 py-1.5 text-[11px] font-bold text-[#f9c400] cursor-pointer"
                      >
                        {groupExtraSelected ? (
                          <CheckSquare className="w-3.5 h-3.5" />
                        ) : (
                          <Square className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {groupExtraSelected
                            ? 'إلغاء تحديد الزائد بهذه المجموعة'
                            : `تحديد الزائد (${group.extraIds.length})`}
                        </span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {group.items.map((item) => {
                        const isKeep = item.id === group.keepId;
                        const isChecked = validSelectedDuplicateIds.includes(item.id);
                        const serversCount = item.servers?.length || 0;
                        const episodesCount = (item.seasons || []).reduce(
                          (sum, s) => sum + (s.episodes?.length || 0),
                          0
                        );
                        const completeness = scoreMediaCompleteness(item);

                        return (
                          <div
                            key={item.id}
                            className={`rounded-xl border p-3 flex items-start justify-between gap-3 transition-colors ${
                              isChecked
                                ? 'bg-[#D92321]/12 border-[#D92321]/60'
                                : isKeep
                                  ? 'bg-[#4CAF50]/[0.07] border-[#4CAF50]/35'
                                  : 'bg-[#0c1821] border-white/10'
                            }`}
                          >
                            <div className="flex items-start gap-3 min-w-0">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleDuplicateSelection(item.id)}
                                aria-label={`تحديد النسخة ${item.title} (${item.id})`}
                                className="mt-1 h-4 w-4 accent-[#D92321] cursor-pointer shrink-0"
                              />
                              <img
                                src={getPosterUrl(item)}
                                alt={item.title}
                                loading="lazy"
                                className="h-16 w-11 rounded-lg object-cover object-top shrink-0 border border-white/10"
                              />
                              <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {isKeep ? (
                                    <span className="rounded bg-[#4CAF50]/20 border border-[#4CAF50]/45 px-1.5 py-0.5 text-[10px] font-black text-[#4CAF50]">
                                      الأفضل (يُوصى بالإبقاء)
                                    </span>
                                  ) : (
                                    <span className="rounded bg-[#f9c400]/15 border border-[#f9c400]/40 px-1.5 py-0.5 text-[10px] font-black text-[#f9c400]">
                                      نسخة مكررة
                                    </span>
                                  )}
                                  <span className="font-latin text-[10px] text-[#b7c9ef]/70 truncate max-w-[140px]">
                                    ID: {item.id}
                                  </span>
                                </div>
                                <p className="text-xs font-extrabold text-white truncate">
                                  {item.title}
                                </p>
                                <p className="text-[11px] text-[#b7c9ef] truncate">
                                  {item.year || '—'} • {serversCount} سيرفر
                                  {episodesCount > 0 ? ` • ${episodesCount} حلقة` : ''} •{' '}
                                  {(item.views || 0).toLocaleString('en-US')} مشاهدة • نقاط الاكتمال:{' '}
                                  {completeness}
                                </p>
                              </div>
                            </div>

                            <div className="flex flex-col gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => onEditMedia(item)}
                                className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#1a242e] hover:bg-sky-500/20 border border-white/10 px-2.5 py-1.5 text-[11px] font-bold text-white cursor-pointer"
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>تعديل</span>
                              </button>
                              {onDeleteMediaIds && (
                                <button
                                  type="button"
                                  disabled={busyAction}
                                  onClick={() => setConfirmDeleteIds([item.id])}
                                  className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#D92321]/15 hover:bg-[#D92321] border border-[#D92321]/40 px-2.5 py-1.5 text-[11px] font-bold text-[#ff9f9d] hover:text-white cursor-pointer transition-colors"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  <span>حذف</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

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

      {/* Findings List (for non-duplicate audit items or combined view) */}
      {categoryFilter !== 'duplicate' &&
        (filteredFindings.length === 0 ? (
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
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[10px] font-black ${badge.cls}`}
                      >
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
        ))}

      <ConfirmDialog
        isOpen={Boolean(confirmDeleteIds && confirmDeleteIds.length > 0)}
        title={`تأكيد حذف ${confirmDeleteIds?.length || 0} نسخة مكررة نهائياً؟`}
        description="سيتم حذف النسخ المحددة نهائياً من قاعدة البيانات ولن تظهر في الموقع بعد الآن."
        confirmLabel={busyAction ? 'جاري الحذف...' : 'نعم، احذف المحدد'}
        busy={busyAction}
        danger
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setConfirmDeleteIds(null)}
      />
    </div>
  );
}
