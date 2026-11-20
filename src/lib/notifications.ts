import type {
  NotificationCategory,
  NotificationPreferences,
  UserNotificationRecord,
} from '../types/media';

const NOTIF_PREFS_STORAGE_KEY = 'rahaltv_notif_prefs_v1';
const LOCAL_READ_NOTIF_IDS_KEY = 'rahaltv_read_notifs_v1';

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  new_season: true,
  new_episode: true,
  watchlist_update: true,
  favorite_genre: true,
  site_update: true,
  admin_notice: true,
  browserPushEnabled: false,
};

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  new_season: 'مواسم جديدة',
  new_episode: 'حلقات جديدة',
  watchlist_update: 'تحديثات قائمتي',
  favorite_genre: 'تصنيفاتي المفضلة',
  site_update: 'تحديثات الموقع',
  admin_notice: 'إشعارات الإدارة',
};

export function loadNotificationPreferences(): NotificationPreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  try {
    const raw = window.localStorage.getItem(NOTIF_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
    return {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }
}

export function saveNotificationPreferences(prefs: NotificationPreferences): NotificationPreferences {
  const next = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...prefs };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(NOTIF_PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota errors
    }
  }
  return next;
}

export function loadLocalReadNotificationIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(LOCAL_READ_NOTIF_IDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

export function markNotificationReadLocally(notifId: string): Set<string> {
  const set = loadLocalReadNotificationIds();
  set.add(notifId);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LOCAL_READ_NOTIF_IDS_KEY, JSON.stringify(Array.from(set).slice(-200)));
    } catch {
      // Ignore quota errors
    }
  }
  return set;
}

export function isNotificationRead(
  notif: UserNotificationRecord,
  uid: string | null,
  localReadSet: Set<string>
): boolean {
  if (localReadSet.has(notif.id)) return true;
  if (uid && Array.isArray(notif.readByUids) && notif.readByUids.includes(uid)) return true;
  return false;
}

export function filterNotificationsByPrefs(
  list: UserNotificationRecord[],
  prefs: NotificationPreferences
): UserNotificationRecord[] {
  return list.filter((item) => prefs[item.category] !== false);
}

export async function requestBrowserNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    const res = await Notification.requestPermission();
    return res === 'granted';
  } catch {
    return false;
  }
}

export function showOptionalBrowserNotification(notif: UserNotificationRecord): void {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(notif.title, {
      body: notif.body,
      icon: '/pwa-192x192.png',
    });
  } catch {
    // Ignore unsupported platform contexts
  }
}
