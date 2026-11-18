import {
  collection,
  DocumentData,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  QueryConstraint,
  QueryDocumentSnapshot,
  startAfter,
  where,
} from 'firebase/firestore';
import {
  bulkDeleteMediaFromFirestore,
  bulkSaveMediaToFirestore,
  bulkUpdateMediaInFirestore,
  db,
  handleFirestoreError,
  OperationType,
} from './firebase';
import { ExecutionPreviewPlan, ParsedAdminCommand } from './localAdminNlp';
import { MediaItem, MediaKind } from '../types/media';

const STORAGE_ACTIVITY_LOG = 'rahaltv_admin_activity_log';
const STORAGE_LAST_UNDO = 'rahaltv_assistant_last_undo';
const MAX_LOG_ENTRIES = 80;

export interface AdminActivityLogEntry {
  id: string;
  timestamp: number;
  adminUid: string;
  adminName: string;
  rawCommand: string;
  understoodCommand: string;
  operationType: string;
  operationLabel: string;
  affectedCount: number;
  sampleTitles: string[];
  status: 'executed' | 'queried' | 'undone' | 'blocked' | 'failed';
  note?: string;
}

export interface UndoBatchSnapshot {
  id: string;
  timestamp: number;
  action: 'update' | 'delete';
  commandText: string;
  operationLabel: string;
  beforeItems: MediaItem[];
}

export function loadActivityLog(): AdminActivityLogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_ACTIVITY_LOG);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AdminActivityLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendActivityLog(
  entry: Omit<AdminActivityLogEntry, 'id' | 'timestamp'>
): AdminActivityLogEntry[] {
  const fullEntry: AdminActivityLogEntry = {
    ...entry,
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
  };
  const current = loadActivityLog();
  const next = [fullEntry, ...current].slice(0, MAX_LOG_ENTRIES);
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_ACTIVITY_LOG, JSON.stringify(next));
    } catch {
      // Ignore quota errors
    }
  }
  return next;
}

export function clearActivityLog(): AdminActivityLogEntry[] {
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_ACTIVITY_LOG);
    } catch {
      // Ignore
    }
  }
  return [];
}

export function loadLastUndoSnapshot(): UndoBatchSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_LAST_UNDO);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UndoBatchSnapshot;
    if (!parsed || !Array.isArray(parsed.beforeItems) || parsed.beforeItems.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveLastUndoSnapshot(snapshot: UndoBatchSnapshot | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!snapshot) {
      localStorage.removeItem(STORAGE_LAST_UNDO);
    } else {
      localStorage.setItem(STORAGE_LAST_UNDO, JSON.stringify(snapshot));
    }
  } catch {
    // If snapshot exceeds localStorage quota on massive batches, keep memory state only
  }
}

function mapFirestoreDocToMediaItem(d: QueryDocumentSnapshot<DocumentData>): MediaItem {
  const raw = d.data() as MediaItem & {
    createdAt?: { toMillis?: () => number };
    updatedAt?: { toMillis?: () => number };
  };
  const createdAtMs =
    raw.createdAt && typeof raw.createdAt.toMillis === 'function' ? raw.createdAt.toMillis() : 0;
  const updatedAtMs =
    raw.updatedAt && typeof raw.updatedAt.toMillis === 'function'
      ? raw.updatedAt.toMillis()
      : createdAtMs;
  return {
    ...raw,
    id: raw.id || d.id,
    createdAtMs,
    updatedAtMs,
  };
}

/**
 * Counts media items directly in Firestore using server-side aggregation (`getCountFromServer`)
 * so counting thousands of documents incurs minimal bandwidth and latency.
 */
export async function countMediaInFirestore(
  filterYear?: string
): Promise<NonNullable<ExecutionPreviewPlan['countSummary']>> {
  const mediaCol = collection(db, 'media');
  try {
    const baseConstraints: QueryConstraint[] = filterYear
      ? [where('year', '==', filterYear)]
      : [];

    const [totalSnap, moviesSnap, seriesSnap, tvSnap, wrestlingSnap] = await Promise.all([
      getCountFromServer(query(mediaCol, ...baseConstraints)),
      getCountFromServer(query(mediaCol, where('kind', '==', 'movie'), ...baseConstraints)),
      getCountFromServer(query(mediaCol, where('kind', '==', 'series'), ...baseConstraints)),
      getCountFromServer(query(mediaCol, where('kind', '==', 'tv'), ...baseConstraints)),
      getCountFromServer(query(mediaCol, where('kind', '==', 'wrestling'), ...baseConstraints)),
    ]);

    return {
      total: totalSnap.data().count,
      movies: moviesSnap.data().count,
      series: seriesSnap.data().count,
      tv: tvSnap.data().count,
      wrestling: wrestlingSnap.data().count,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'media');
  }
}

/**
 * Fetches latest/top N items directly from Firestore using indexed `orderBy` + `limit` queries.
 */
export async function fetchTopMediaFromFirestore(
  kind: 'all' | MediaKind,
  limitCount: number,
  sortBy: ParsedAdminCommand['sortBy'] = 'latest'
): Promise<MediaItem[]> {
  const mediaCol = collection(db, 'media');
  const orderField =
    sortBy === 'imdb' ? 'imdb' : sortBy === 'views' ? 'views' : 'updatedAt';
  const safeLimit = Math.min(50, Math.max(1, limitCount));

  try {
    const constraints: QueryConstraint[] = [];
    if (kind !== 'all') {
      constraints.push(where('kind', '==', kind));
    }
    constraints.push(orderBy(orderField, 'desc'));
    constraints.push(limit(safeLimit));

    const snap = await getDocs(query(mediaCol, ...constraints));
    return snap.docs.map(mapFirestoreDocToMediaItem);
  } catch {
    // Fallback if composite index (kind + orderField) is not yet created in Firestore:
    try {
      const fallbackConstraints: QueryConstraint[] =
        kind !== 'all' ? [where('kind', '==', kind), limit(250)] : [limit(250)];
      const snap = await getDocs(query(mediaCol, ...fallbackConstraints));
      const docs = snap.docs.map(mapFirestoreDocToMediaItem);
      docs.sort((a, b) => {
        if (sortBy === 'imdb') return (b.imdb || 0) - (a.imdb || 0);
        if (sortBy === 'views') return (b.views || 0) - (a.views || 0);
        return (b.updatedAtMs || b.createdAtMs || 0) - (a.updatedAtMs || a.createdAtMs || 0);
      });
      return docs.slice(0, safeLimit);
    } catch (innerErr) {
      handleFirestoreError(innerErr, OperationType.LIST, 'media');
    }
  }
}

/**
 * Paginated Firestore query that restricts downloaded documents via server-side `where` clauses
 * whenever scopeKind, category, or year are specified.
 */
export async function fetchScopedMediaFromFirestore(params: {
  scopeKind: 'all' | MediaKind;
  scopeCategory?: string;
  filterYear?: string;
  maxScan?: number;
}): Promise<MediaItem[]> {
  const mediaCol = collection(db, 'media');
  const maxScan = params.maxScan ?? 1500;
  const pageSize = 250;

  const baseConstraints: QueryConstraint[] = [];
  if (params.scopeKind !== 'all') {
    baseConstraints.push(where('kind', '==', params.scopeKind));
  }
  if (params.filterYear) {
    baseConstraints.push(where('year', '==', params.filterYear));
  } else if (params.scopeCategory && params.scopeCategory !== 'all') {
    baseConstraints.push(where('categories', 'array-contains', params.scopeCategory));
  }

  const results: MediaItem[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;

  try {
    while (results.length < maxScan) {
      const pageConstraints: QueryConstraint[] = [
        ...baseConstraints,
        limit(Math.min(pageSize, maxScan - results.length)),
      ];
      if (cursor) {
        pageConstraints.push(startAfter(cursor));
      }
      const snap = await getDocs(query(mediaCol, ...pageConstraints));
      if (snap.empty) break;

      for (const docSnap of snap.docs) {
        results.push(mapFirestoreDocToMediaItem(docSnap));
      }

      if (snap.docs.length < pageSize) break;
      cursor = snap.docs[snap.docs.length - 1];
    }
    return results;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'media');
  }
}

const executedPlanIds = new Set<string>();

export function hasPlanAlreadyExecuted(planId: string): boolean {
  return executedPlanIds.has(planId);
}

export interface ExecutionResult {
  affectedCount: number;
  operation: 'update' | 'delete';
  undoSnapshot: UndoBatchSnapshot;
}

export async function executeApprovedPlanInDatabase(params: {
  planId: string;
  command: ParsedAdminCommand;
  approvedProposals: { original: MediaItem; updated: MediaItem }[];
  fullCatalogFallback: MediaItem[];
  isFirestoreSeeded: boolean;
  uid: string;
}): Promise<ExecutionResult> {
  const { planId, command, approvedProposals, fullCatalogFallback, isFirestoreSeeded, uid } = params;

  if (executedPlanIds.has(planId)) {
    throw new Error('تم تنفيذ هذه العملية مسبقاً — تم منع التنفيذ المكرر لحماية البيانات.');
  }
  if (approvedProposals.length === 0) {
    throw new Error('لا توجد عناصر محددة للتنفيذ.');
  }

  // Lock planId immediately before async DB writes to stop double-click race conditions
  executedPlanIds.add(planId);

  try {
    const beforeItems = approvedProposals.map((p) => p.original);
    const isDelete = command.operationType === 'delete_items';

    if (isDelete) {
      const targetIds = approvedProposals.map((p) => p.original.id);
      let deletedCount = 0;

      if (isFirestoreSeeded) {
        deletedCount = await bulkDeleteMediaFromFirestore(targetIds);
      } else {
        // Persist remaining starter items to Firestore excluding deleted ones
        const deleteSet = new Set(targetIds);
        const remaining = fullCatalogFallback.filter((it) => !deleteSet.has(it.id));
        if (remaining.length > 0) {
          await bulkSaveMediaToFirestore(remaining, uid);
        }
        deletedCount = targetIds.length;
      }

      const undoSnapshot: UndoBatchSnapshot = {
        id: `undo_${Date.now()}`,
        timestamp: Date.now(),
        action: 'delete',
        commandText: command.rawInput,
        operationLabel: command.operationLabel,
        beforeItems,
      };
      saveLastUndoSnapshot(undoSnapshot);
      return { affectedCount: deletedCount, operation: 'delete', undoSnapshot };
    }

    // Update operation
    const updatedItems = approvedProposals.map((p) => p.updated);
    let updatedCount = 0;

    if (isFirestoreSeeded) {
      updatedCount = await bulkUpdateMediaInFirestore(updatedItems, uid);
    } else {
      const updatedMap = new Map(updatedItems.map((it) => [it.id, it]));
      const mergedCatalog = fullCatalogFallback.map((it) => updatedMap.get(it.id) || it);
      await bulkSaveMediaToFirestore(mergedCatalog, uid);
      updatedCount = updatedItems.length;
    }

    const undoSnapshot: UndoBatchSnapshot = {
      id: `undo_${Date.now()}`,
      timestamp: Date.now(),
      action: 'update',
      commandText: command.rawInput,
      operationLabel: command.operationLabel,
      beforeItems,
    };
    saveLastUndoSnapshot(undoSnapshot);
    return { affectedCount: updatedCount, operation: 'update', undoSnapshot };
  } catch (err) {
    // Allow retry only if DB write actually failed
    executedPlanIds.delete(planId);
    throw err;
  }
}

export async function undoAssistantBatchInDatabase(
  snapshot: UndoBatchSnapshot,
  uid: string
): Promise<number> {
  if (!snapshot || snapshot.beforeItems.length === 0) {
    throw new Error('لا توجد عملية سابقة صالحة للتراجع عنها.');
  }

  let restoredCount = 0;
  if (snapshot.action === 'delete') {
    restoredCount = await bulkSaveMediaToFirestore(snapshot.beforeItems, uid);
  } else {
    restoredCount = await bulkUpdateMediaInFirestore(snapshot.beforeItems, uid);
  }

  saveLastUndoSnapshot(null);
  return restoredCount;
}
