import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Cloud,
  Database,
  HardDrive,
  History,
  RotateCcw,
  Search,
  ShieldAlert,
  Trash2,
  Undo2,
} from 'lucide-react';
import { AdminActivityLogEntry } from '../lib/adminAssistantDb';

interface AdminActivityLogProps {
  logs: AdminActivityLogEntry[];
  syncMode: 'firestore+local' | 'local';
  onClearLogs: () => Promise<void> | void;
  onRerunCommand?: (commandText: string) => void;
}

type StatusFilter = 'all' | 'executed' | 'queried' | 'undone' | 'issues';

function formatLogTimestamp(ts: number): string {
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(ts));
  } catch {
    return '';
  }
}

const STATUS_META: Record<
  AdminActivityLogEntry['status'],
  { badge: string; label: string }
> = {
  executed: {
    badge: 'bg-[#4CAF50]/20 text-[#4CAF50] border border-[#4CAF50]/35',
    label: 'تم التنفيذ',
  },
  queried: {
    badge: 'bg-sky-500/15 text-sky-300 border border-sky-500/30',
    label: 'استعلام',
  },
  undone: {
    badge: 'bg-[#f9c400]/20 text-[#f9c400] border border-[#f9c400]/35',
    label: 'تم التراجع',
  },
  blocked: {
    badge: 'bg-[#D92321]/20 text-[#ff8684] border border-[#D92321]/35',
    label: 'محظور للأمان',
  },
  failed: {
    badge: 'bg-[#D92321]/20 text-[#ff8684] border border-[#D92321]/35',
    label: 'فشل',
  },
};

export function AdminActivityLog({
  logs,
  syncMode,
  onClearLogs,
  onRerunCommand,
}: AdminActivityLogProps) {
  const [expanded, setExpanded] = useState<boolean>(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [confirmClear, setConfirmClear] = useState<boolean>(false);
  const [clearing, setClearing] = useState<boolean>(false);

  const stats = useMemo(() => {
    let executed = 0;
    let queried = 0;
    let undone = 0;
    let issues = 0;
    for (const item of logs) {
      if (item.status === 'executed') executed++;
      else if (item.status === 'queried') queried++;
      else if (item.status === 'undone') undone++;
      else issues++;
    }
    return { executed, queried, undone, issues };
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return logs.filter((entry) => {
      if (statusFilter === 'executed' && entry.status !== 'executed') return false;
      if (statusFilter === 'queried' && entry.status !== 'queried') return false;
      if (statusFilter === 'undone' && entry.status !== 'undone') return false;
      if (
        statusFilter === 'issues' &&
        entry.status !== 'blocked' &&
        entry.status !== 'failed'
      ) {
        return false;
      }

      if (q) {
        const haystack = [
          entry.rawCommand,
          entry.understoodCommand,
          entry.operationLabel,
          entry.adminName,
          entry.note || '',
          ...(entry.sampleTitles || []),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [logs, statusFilter, searchQuery]);

  const handleConfirmClear = async () => {
    setClearing(true);
    try {
      await onClearLogs();
      setConfirmClear(false);
    } finally {
      setClearing(false);
    }
  };

  return (
    <section
      aria-label="سجل نشاطات المساعد الإداري"
      className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 sm:p-6 space-y-4 shadow-xl"
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-2 text-sm sm:text-base font-extrabold text-white cursor-pointer"
          >
            <History className="w-4 h-4 text-[#f9c400]" />
            <span>سجل نشاطات المساعد الإداري ({logs.length})</span>
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-[#b7c9ef]" />
            ) : (
              <ChevronDown className="w-4 h-4 text-[#b7c9ef]" />
            )}
          </button>

          <span
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-black border ${
              syncMode === 'firestore+local'
                ? 'bg-[#4CAF50]/15 border-[#4CAF50]/35 text-[#4CAF50]'
                : 'bg-[#15222d] border-white/10 text-[#b7c9ef]'
            }`}
            title={
              syncMode === 'firestore+local'
                ? 'يُحفظ السجل تلقائياً في Firestore و localStorage معاً'
                : 'محفوظ محلياً في المتصفح (localStorage)'
            }
          >
            {syncMode === 'firestore+local' ? (
              <>
                <Cloud className="w-3 h-3" />
                <span>Firestore + localStorage</span>
              </>
            ) : (
              <>
                <HardDrive className="w-3 h-3 text-[#f9c400]" />
                <span>حفظ محلي (localStorage)</span>
              </>
            )}
          </span>
        </div>

        {logs.length > 0 && (
          <div className="flex items-center gap-2">
            {!confirmClear ? (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-[#D92321]/20 border border-white/10 px-3 py-1.5 text-[11px] font-bold text-[#b7c9ef] hover:text-white cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>مسح السجل</span>
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={clearing}
                  onClick={() => setConfirmClear(false)}
                  className="rounded-xl bg-[#1a242e] border border-white/10 px-2.5 py-1.5 text-[11px] font-bold text-[#b7c9ef] hover:text-white cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={clearing}
                  onClick={() => void handleConfirmClear()}
                  className="rounded-xl bg-[#D92321] hover:bg-[#b5141a] px-3 py-1.5 text-[11px] font-black text-white cursor-pointer"
                >
                  {clearing ? 'جارٍ المسح...' : 'تأكيد مسح السجل'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <>
          {/* Filter & Search Bar */}
          {logs.length > 0 && (
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { id: 'all', label: `الكل (${logs.length})` },
                    { id: 'executed', label: `منفذة (${stats.executed})` },
                    { id: 'queried', label: `استعلامات (${stats.queried})` },
                    { id: 'undone', label: `تراجع (${stats.undone})` },
                    { id: 'issues', label: `محظورة/فاشلة (${stats.issues})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStatusFilter(tab.id)}
                    className={`rounded-lg px-2.5 py-1.5 text-[11px] font-extrabold border transition-colors cursor-pointer ${
                      statusFilter === tab.id
                        ? 'bg-[#f9c400] border-[#f9c400] text-[#06131c]'
                        : 'bg-[#15222d] border-white/10 text-[#b7c9ef] hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="relative w-full lg:w-64">
                <Search className="w-3.5 h-3.5 text-[#b7c9ef] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="بحث في السجل..."
                  className="w-full rounded-xl bg-[#15222d] border border-white/10 pr-8 pl-3 py-1.5 text-xs text-white placeholder:text-white/40 focus:border-[#f9c400] focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Entries List */}
          {logs.length === 0 ? (
            <div className="rounded-2xl bg-[#15222d]/60 border border-white/[0.06] p-4 text-xs text-[#b7c9ef]">
              لم يتم تسجيل أي عمليات بعد. كل أمر يتم تنفيذه أو استعلامه أو التراجع عنه سيظهر هنا مع
              اسم المشرف والتاريخ وعدد العناصر المتأثرة لضمان الشفافية الكاملة.
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="rounded-2xl bg-[#15222d]/60 border border-white/[0.06] p-4 text-xs text-[#b7c9ef]">
              لا توجد عمليات مطابقة لمرشح البحث الحالي.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[420px] overflow-y-auto pl-1">
              {filteredLogs.map((log) => {
                const meta = STATUS_META[log.status] || STATUS_META.executed;
                return (
                  <div
                    key={log.id}
                    className="rounded-2xl bg-[#15222d]/85 border border-white/[0.07] p-3.5 space-y-2 text-xs"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-black ${meta.badge}`}
                        >
                          {log.status === 'executed' ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : log.status === 'undone' ? (
                            <Undo2 className="w-3 h-3" />
                          ) : log.status === 'queried' ? (
                            <Database className="w-3 h-3" />
                          ) : (
                            <ShieldAlert className="w-3 h-3" />
                          )}
                          <span>{meta.label}</span>
                        </span>

                        <span className="rounded-md bg-[#0c1821] border border-white/10 px-2 py-0.5 text-[10px] font-bold text-[#f9c400]">
                          {log.operationLabel}
                        </span>

                        <span className="font-extrabold text-white break-words">
                          {log.rawCommand}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {onRerunCommand && log.operationType !== 'undo' && (
                          <button
                            type="button"
                            onClick={() => onRerunCommand(log.rawCommand)}
                            className="inline-flex items-center gap-1 rounded-lg bg-[#0c1821] hover:bg-[#f9c400]/15 border border-white/10 hover:border-[#f9c400]/40 px-2 py-1 text-[10px] font-bold text-[#b7c9ef] hover:text-white cursor-pointer"
                            title="تعبئة هذا الأمر في حقل المساعد"
                          >
                            <RotateCcw className="w-3 h-3 text-[#f9c400]" />
                            <span>إعادة تعبئة</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#b7c9ef]">
                      <div className="space-y-0.5 min-w-0">
                        <p className="leading-relaxed">
                          <span className="text-white/75">التفسير:</span> {log.understoodCommand} •{' '}
                          <span className="text-white/75">المتأثر:</span>{' '}
                          <strong className="font-latin text-white">{log.affectedCount}</strong>
                          {log.sampleTitles.length > 0
                            ? ` • أمثلة: ${log.sampleTitles.join('، ')}`
                            : ''}
                        </p>
                        {log.note && (
                          <p className="text-[11px] text-[#ff9f9d]">ملاحظة: {log.note}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[10px] text-[#b7c9ef]/90 shrink-0">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatLogTimestamp(log.timestamp)}
                        </span>
                        <span>• {log.adminName}</span>
                        <span
                          className="rounded bg-[#0c1821] px-1.5 py-0.5 text-[9px] font-bold text-white/70"
                          title="مصدر الحفظ"
                        >
                          {log.storageSource === 'firestore' ? 'سحابي+محلي' : 'محلي'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
