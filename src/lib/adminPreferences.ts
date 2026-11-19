// Persistent Admin Workspace Preferences, Notifications, Client Error Log, and
// Local Granular Sub-Permissions (stored in localStorage to avoid breaking strict
// Firestore security rules schemas).

import { safeRandomId } from './browserCompat';

export type CatalogSortField = 'createdAt' | 'title' | 'rating' | 'views' | 'year';
export type CatalogSortDirection = 'asc' | 'desc';

export type CatalogColumnKey =
  | 'poster'
  | 'title'
  | 'type'
  | 'category'
  | 'year'
  | 'rating'
  | 'views'
  | 'servers'
  | 'flags';

export interface CatalogTablePrefs {
  visibleColumns: Record<CatalogColumnKey, boolean>;
  sortBy: CatalogSortField;
  sortDir: CatalogSortDirection;
  pageSize: 15 | 30 | 50 | 100;
}

export interface ModeratorSubPermissions {
  allowBulkEditor: boolean;
  allowContentAudit: boolean;
  allowWatchServers: boolean;
  allowAnalyticsRead: boolean;
  allowCrawlOperations: boolean;
  allowSiteScraper: boolean;
  allowAdapters: boolean;
}

export interface AdminNotificationItem {
  id: string;
  level: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  tabTarget?: string;
  createdAt: number;
  read: boolean;
}

export interface ClientErrorRecord {
  id: string;
  scope: string;
  message: string;
  stack?: string;
  url?: string;
  userAgent?: string;
  createdAt: number;
}

export interface AdminWorkspacePrefs {
  lastTab: string;
  sidebarCollapsed: boolean;
  collapsedGroups: Record<string, boolean>;
  openGroupIds: string[];
  accordionMultiOpen: boolean;
  catalogTable: CatalogTablePrefs;
  moderatorSubPermissions: ModeratorSubPermissions;
}

const PREFS_KEY = 'rahal_admin_workspace_prefs_v2';
const NOTIFICATIONS_KEY = 'rahal_admin_notifications_v1';
const CLIENT_ERRORS_KEY = 'rahal_client_error_logs_v1';

export const DEFAULT_CATALOG_TABLE_PREFS: CatalogTablePrefs = {
  visibleColumns: {
    poster: true,
    title: true,
    type: true,
    category: true,
    year: true,
    rating: true,
    views: true,
    servers: true,
    flags: true,
  },
  sortBy: 'createdAt',
  sortDir: 'desc',
  pageSize: 30,
};

export const DEFAULT_MODERATOR_SUB_PERMS: ModeratorSubPermissions = {
  allowBulkEditor: true,
  allowContentAudit: true,
  allowWatchServers: true,
  allowAnalyticsRead: true,
  allowCrawlOperations: true,
  allowSiteScraper: true,
  allowAdapters: true,
};

export const DEFAULT_ADMIN_WORKSPACE_PREFS: AdminWorkspacePrefs = {
  lastTab: 'overview',
  sidebarCollapsed: false,
  collapsedGroups: {},
  openGroupIds: [],
  accordionMultiOpen: true,
  catalogTable: DEFAULT_CATALOG_TABLE_PREFS,
  moderatorSubPermissions: DEFAULT_MODERATOR_SUB_PERMS,
};

export function loadAdminWorkspacePrefs(): AdminWorkspacePrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_ADMIN_WORKSPACE_PREFS };
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_ADMIN_WORKSPACE_PREFS };
    const parsed = JSON.parse(raw) as Partial<AdminWorkspacePrefs>;
    return {
      lastTab: typeof parsed.lastTab === 'string' && parsed.lastTab ? parsed.lastTab : 'overview',
      sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
      collapsedGroups:
        parsed.collapsedGroups && typeof parsed.collapsedGroups === 'object'
          ? parsed.collapsedGroups
          : {},
      openGroupIds: Array.isArray(parsed.openGroupIds)
        ? parsed.openGroupIds.filter((g): g is string => typeof g === 'string' && Boolean(g))
        : [],
      accordionMultiOpen: parsed.accordionMultiOpen ?? true,
      catalogTable: {
        visibleColumns: {
          ...DEFAULT_CATALOG_TABLE_PREFS.visibleColumns,
          ...(parsed.catalogTable?.visibleColumns || {}),
        },
        sortBy: parsed.catalogTable?.sortBy || 'createdAt',
        sortDir: parsed.catalogTable?.sortDir === 'asc' ? 'asc' : 'desc',
        pageSize:
          parsed.catalogTable?.pageSize === 15 ||
          parsed.catalogTable?.pageSize === 30 ||
          parsed.catalogTable?.pageSize === 50 ||
          parsed.catalogTable?.pageSize === 100
            ? parsed.catalogTable.pageSize
            : 30,
      },
      moderatorSubPermissions: {
        ...DEFAULT_MODERATOR_SUB_PERMS,
        ...(parsed.moderatorSubPermissions || {}),
      },
    };
  } catch {
    return { ...DEFAULT_ADMIN_WORKSPACE_PREFS };
  }
}

export function saveAdminWorkspacePrefs(prefs: AdminWorkspacePrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadAdminNotifications(): AdminNotificationItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(NOTIFICATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAdminNotifications(items: AdminNotificationItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(items.slice(0, 60)));
  } catch {
    // Ignore
  }
}

export function pushAdminNotification(
  input: Omit<AdminNotificationItem, 'id' | 'createdAt' | 'read'>
): AdminNotificationItem[] {
  const existing = loadAdminNotifications();
  const next: AdminNotificationItem = {
    id: safeRandomId('notif'),
    createdAt: Date.now(),
    read: false,
    ...input,
  };
  const merged = [next, ...existing].slice(0, 60);
  saveAdminNotifications(merged);
  return merged;
}

export function loadClientErrorLogs(): ClientErrorRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CLIENT_ERRORS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendLocalClientErrorLog(
  scope: string,
  error: unknown
): ClientErrorRecord[] {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown client error';
  const stack = error instanceof Error ? error.stack : undefined;
  const entry: ClientErrorRecord = {
    id: safeRandomId('err'),
    scope,
    message: message.slice(0, 400),
    stack: stack ? stack.slice(0, 900) : undefined,
    url: typeof window !== 'undefined' ? window.location.href : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : undefined,
    createdAt: Date.now(),
  };

  if (typeof window === 'undefined') return [entry];
  try {
    const prev = loadClientErrorLogs();
    const next = [entry, ...prev].slice(0, 80);
    window.localStorage.setItem(CLIENT_ERRORS_KEY, JSON.stringify(next));
    return next;
  } catch {
    return [entry];
  }
}

export function clearClientErrorLogs(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CLIENT_ERRORS_KEY);
  } catch {
    // Ignore
  }
}
