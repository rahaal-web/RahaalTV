// Real-time Crawl Operations & Task Registry with AbortController support.
// Tracks single-page, bulk-site, and adapter test crawls with live progress and cancellation.

import { safeRandomId } from './browserCompat';

export type CrawlTaskKind = 'single_page' | 'bulk_site' | 'adapter_test' | 'batch_fix';
export type CrawlTaskStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export interface CrawlTaskRecord {
  id: string;
  kind: CrawlTaskKind;
  title: string;
  targetUrl: string;
  status: CrawlTaskStatus;
  totalItems: number;
  completedItems: number;
  importedCount: number;
  failedCount: number;
  startedAt: number;
  finishedAt?: number;
  errorMessage?: string;
}

const TASKS_STORAGE_KEY = 'rahal_crawl_tasks_history_v1';
const activeControllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // Ignore subscriber errors
    }
  });
}

export function subscribeCrawlTasks(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function loadCrawlTasks(): CrawlTaskRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(TASKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // If a previous tab closed while a task was "running", mark it interrupted/failed cleanly
    return parsed.map((item: CrawlTaskRecord) => {
      if (item.status === 'running' && !activeControllers.has(item.id)) {
        return {
          ...item,
          status: 'failed' as const,
          finishedAt: item.finishedAt || item.startedAt,
          errorMessage: item.errorMessage || 'توقفت الجلسة قبل اكتمال المهمة.',
        };
      }
      return item;
    });
  } catch {
    return [];
  }
}

function saveCrawlTasks(tasks: CrawlTaskRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks.slice(0, 60)));
  } catch {
    // Ignore storage quota errors
  }
  notifyListeners();
}

export function startTrackedCrawlTask(input: {
  kind: CrawlTaskKind;
  title: string;
  targetUrl: string;
  totalItems?: number;
}): { taskId: string; controller: AbortController } {
  const taskId = safeRandomId('crawl');
  const controller = new AbortController();
  activeControllers.set(taskId, controller);

  const record: CrawlTaskRecord = {
    id: taskId,
    kind: input.kind,
    title: input.title,
    targetUrl: input.targetUrl,
    status: 'running',
    totalItems: Math.max(1, input.totalItems ?? 1),
    completedItems: 0,
    importedCount: 0,
    failedCount: 0,
    startedAt: Date.now(),
  };

  const prev = loadCrawlTasks();
  saveCrawlTasks([record, ...prev]);
  return { taskId, controller };
}

export function updateTrackedCrawlTask(
  taskId: string,
  patch: Partial<Omit<CrawlTaskRecord, 'id' | 'startedAt'>>
): void {
  const prev = loadCrawlTasks();
  const next = prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t));
  saveCrawlTasks(next);
}

export function finishTrackedCrawlTask(
  taskId: string,
  status: Exclude<CrawlTaskStatus, 'running'>,
  extra: Partial<Omit<CrawlTaskRecord, 'id' | 'startedAt'>> = {}
): void {
  activeControllers.delete(taskId);
  const prev = loadCrawlTasks();
  const next = prev.map((t) =>
    t.id === taskId
      ? {
          ...t,
          ...extra,
          status,
          finishedAt: Date.now(),
        }
      : t
  );
  saveCrawlTasks(next);
}

export function cancelTrackedCrawlTask(taskId: string): boolean {
  const ctrl = activeControllers.get(taskId);
  if (ctrl) {
    try {
      ctrl.abort(new Error('تم إلغاء المهمة من لوحة العمليات'));
    } catch {
      ctrl.abort();
    }
    activeControllers.delete(taskId);
  }
  finishTrackedCrawlTask(taskId, 'cancelled', {
    errorMessage: 'تم إيقاف المهمة يدوياً بواسطة الإدارة.',
  });
  return true;
}

export function clearCompletedCrawlTasks(): void {
  const activeOnly = loadCrawlTasks().filter((t) => t.status === 'running');
  saveCrawlTasks(activeOnly);
}

export function isTaskCancelled(controller?: AbortController): boolean {
  return Boolean(controller?.signal?.aborted);
}
