import { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  Globe,
  Loader2,
  StopCircle,
  Trash2,
  Wand2,
  Wrench,
  XCircle,
} from 'lucide-react';
import {
  cancelTrackedCrawlTask,
  clearCompletedCrawlTasks,
  CrawlTaskRecord,
  loadCrawlTasks,
  subscribeCrawlTasks,
} from '../../lib/crawlTasksDb';
import type { AdminTab } from './adminNavigation';

interface AdminCrawlOperationsPanelProps {
  onNavigateTab: (tab: AdminTab) => void;
  onNotify: (msg: string) => void;
}

const KIND_TEXT: Record<CrawlTaskRecord['kind'], string> = {
  single_page: 'جلب عمل واحد',
  bulk_site: 'جلب موقع بالكامل',
  adapter_test: 'اختبار محوّل مصدر',
  batch_fix: 'معالجة دفعة',
};

export function AdminCrawlOperationsPanel({
  onNavigateTab,
  onNotify,
}: AdminCrawlOperationsPanelProps) {
  const [tasks, setTasks] = useState<CrawlTaskRecord[]>(() => loadCrawlTasks());

  useEffect(() => {
    setTasks(loadCrawlTasks());
    return subscribeCrawlTasks(() => {
      setTasks(loadCrawlTasks());
    });
  }, []);

  const runningTasks = tasks.filter((t) => t.status === 'running');
  const finishedTasks = tasks.filter((t) => t.status !== 'running');

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-extrabold text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-[#4CAF50]" />
            <span>مركز عمليات ومهام الجلب الحية</span>
          </h2>
          <p className="text-xs text-[#b7c9ef] mt-1">
            تتبع مهام الجلب الفردي وجلب المواقع الكاملة في الوقت الحقيقي مع إمكانية إيقاف أي مهمة جارية فوراً.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigateTab('scraper')}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3.5 py-2 text-xs font-bold text-[#4CAF50] cursor-pointer"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>جلب عمل واحد</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigateTab('site_scraper')}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3.5 py-2 text-xs font-bold text-[#f9c400] cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5" />
            <span>جلب موقع بالكامل</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigateTab('scraper_adapters')}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3.5 py-2 text-xs font-bold text-sky-300 cursor-pointer"
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>محولات المصادر</span>
          </button>
          {finishedTasks.length > 0 && (
            <button
              type="button"
              onClick={() => {
                clearCompletedCrawlTasks();
                onNotify('تم تنظيف سجل مهام الجلب المنتهية.');
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#D92321]/15 hover:bg-[#D92321] border border-[#D92321]/40 px-3.5 py-2 text-xs font-bold text-[#ff9f9d] hover:text-white cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>مسح السجل المنتهي</span>
            </button>
          )}
        </div>
      </div>

      {/* Running Tasks */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-3">
        <h3 className="font-display text-sm font-extrabold text-white flex items-center gap-2">
          <Loader2
            className={`w-4 h-4 text-[#f9c400] ${runningTasks.length > 0 ? 'animate-spin' : ''}`}
          />
          <span>المهام الجارية حالياً ({runningTasks.length})</span>
        </h3>

        {runningTasks.length === 0 ? (
          <p className="text-xs text-[#b7c9ef]">لا توجد مهام جلب نشطة حالياً.</p>
        ) : (
          <div className="space-y-3">
            {runningTasks.map((task) => {
              const pct = task.totalItems
                ? Math.min(100, Math.round((task.completedItems / task.totalItems) * 100))
                : 0;
              return (
                <div
                  key={task.id}
                  className="rounded-2xl bg-[#1a242e] border border-[#f9c400]/35 p-4 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="rounded bg-[#f9c400]/15 px-2 py-0.5 text-[10px] font-black text-[#f9c400] ml-2">
                        {KIND_TEXT[task.kind]}
                      </span>
                      <span className="text-xs font-extrabold text-white">{task.title}</span>
                      <p className="font-latin text-[10px] text-[#b7c9ef] mt-0.5 truncate max-w-xl" dir="ltr">
                        {task.targetUrl}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        cancelTrackedCrawlTask(task.id);
                        onNotify('تم إرسال إشارة إيقاف مهمة الجلب.');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#D92321] hover:bg-[#dc0e30] px-3.5 py-2 text-xs font-extrabold text-white cursor-pointer"
                    >
                      <StopCircle className="w-3.5 h-3.5" />
                      <span>إيقاف المهمة</span>
                    </button>
                  </div>
                  <div className="h-2 rounded-full bg-[#0c1821] overflow-hidden">
                    <div
                      className="h-full bg-[#4CAF50] transition-all"
                      style={{ width: `${Math.max(5, pct)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] font-bold text-[#b7c9ef]">
                    <span>
                      التقدم: {task.completedItems} / {task.totalItems}
                    </span>
                    <span>مستورد: {task.importedCount} • أخطاء: {task.failedCount}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* History */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-3">
        <h3 className="font-display text-sm font-extrabold text-white flex items-center gap-2">
          <Clock className="w-4 h-4 text-sky-400" />
          <span>سجل عمليات الجلب السابقة ({finishedTasks.length})</span>
        </h3>

        {finishedTasks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 py-10 text-center text-xs text-[#b7c9ef]">
            سيتم تسجيل كل عملية جلب تبدأها من أداة الجلب الفردي أو جلب المواقع هنا تلقائياً.
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {finishedTasks.map((task) => {
              const durationSec = task.finishedAt
                ? Math.max(1, Math.round((task.finishedAt - task.startedAt) / 1000))
                : 0;
              return (
                <div
                  key={task.id}
                  className="rounded-2xl bg-[#1a242e]/65 border border-white/[0.06] px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {task.status === 'completed' ? (
                        <CheckCircle2 className="w-4 h-4 text-[#4CAF50] shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-[#D92321] shrink-0" />
                      )}
                      <span className="text-xs font-extrabold text-white truncate">
                        {task.title}
                      </span>
                      <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] font-bold text-[#b7c9ef]">
                        {KIND_TEXT[task.kind]}
                      </span>
                    </div>
                    <p className="font-latin text-[10px] text-[#b7c9ef] truncate" dir="ltr">
                      {task.targetUrl}
                    </p>
                    {task.errorMessage && (
                      <p className="text-[11px] text-[#ff9f9d]">{task.errorMessage}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-[11px] font-bold text-[#b7c9ef] shrink-0">
                    <span>النتائج: {task.importedCount}</span>
                    {durationSec > 0 && <span className="font-latin">{durationSec}s</span>}
                    <span>{new Date(task.startedAt).toLocaleTimeString('ar-EG')}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
