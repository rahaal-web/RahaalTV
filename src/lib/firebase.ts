import { deleteApp, initializeApp } from 'firebase/app';
import {
  Auth,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  Firestore,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  getActiveAuthInstance,
  getActiveDb,
  getActiveFirebaseConfig,
  subscribeActiveDatabaseChange,
} from './dbConnectionManager';
import fallbackBackdropImg from '../assets/images/hero_scifi_backdrop_1794813333496.jpg';
import fallbackPosterImg from '../assets/images/poster_running_man_1794813333683.jpg';
import {
  AdminPrivilegeRole,
  AnalyticsDailyRecord,
  CustomFontRecord,
  CustomFontSlot,
  MediaItem,
  MediaReviewRecord,
  NotificationCategory,
  RequestStatus,
  ReviewReportRecord,
  ServerHealthRecord,
  SiteSettings,
  SkipSegmentsConfig,
  StreamServer,
  UserNotificationRecord,
  UserSubProfile,
  VisitorRequest,
  WatchProgressRecord,
} from '../types/media';
import { reportClientError } from './clientLogger';
import { isLikelyNonVideoWebsiteUrl } from './clientScraper';
import {
  buildDedicatedMediaUrl,
  generateCleanSlug,
  isDedicatedAppShortUrl,
} from './permalink';
import { DEFAULT_PLAYER_THEME, saveStoredPlayerTheme } from './playerTheme';
import {
  DEFAULT_HOME_CONFIG,
  HOME_CONFIG_SLIDER_STYLE_KEYS,
  normalizeHomeConfig,
  pickLegacyAutoplayHomeConfig,
  pickLegacyCoreHomeConfig,
  pickSliderStyleHomeConfig,
  saveStoredHomeConfig,
} from './homeConfig';
import {
  DEFAULT_TYPOGRAPHY_CONFIG,
  saveStoredTypographyConfig,
} from './typographyConfig';
import {
  DEFAULT_POPUP_SHIELD_CONFIG,
  saveStoredPopupShieldConfig,
} from './popupShield';
import {
  DEFAULT_WEBSITE_BRANDING,
  sanitizeBrandingForFirestore,
  saveStoredWebsiteBranding,
} from './websiteBranding';
import { evaluateImageQuality } from './mediaImages';

export let db: Firestore = getActiveDb();
export let auth: Auth = getActiveAuthInstance();
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export function getActiveDatabase(): Firestore {
  db = getActiveDb();
  return db;
}

export function getActiveAuth(): Auth {
  auth = getActiveAuthInstance();
  return auth;
}

export { getActiveFirebaseConfig };

subscribeActiveDatabaseChange(() => {
  db = getActiveDb();
  auth = getActiveAuthInstance();
});

export const PRIMARY_ADMIN_EMAILS = [
  'rahalahmed348@gmail.com',
  'mfeshmeny2@gmail.com',
  'ccicada6@gmail.com',
  'bebraheem439@gmail.com',
];

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const currentAuth = getActiveAuth();
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentAuth.currentUser?.uid,
      email: currentAuth.currentUser?.email,
      emailVerified: currentAuth.currentUser?.emailVerified,
      isAnonymous: currentAuth.currentUser?.isAnonymous,
      tenantId: currentAuth.currentUser?.tenantId,
      providerInfo:
        currentAuth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  reportClientError({
    source: 'firestore.error',
    level: 'error',
    message: `${operationType} on ${path || 'unknown'}: ${errInfo.error}`,
    context: {
      operationType,
      path: path || '',
      hasUser: Boolean(currentAuth.currentUser?.uid),
    },
  });
  throw new Error(JSON.stringify(errInfo));
}

function getFirebaseErrorCodeAndMessage(err: unknown): { code: string; message: string } {
  if (typeof err === 'object' && err !== null) {
    const rec = err as { code?: unknown; message?: unknown };
    const rawMsg = String(rec.message || '');
    // Try parsing wrapped FirestoreErrorInfo JSON thrown by handleFirestoreError
    if (rawMsg.startsWith('{')) {
      try {
        const parsed = JSON.parse(rawMsg) as { error?: unknown };
        if (parsed && typeof parsed.error === 'string') {
          return { code: String(rec.code || ''), message: parsed.error };
        }
      } catch {
        // Ignore JSON parse errors
      }
    }
    return { code: String(rec.code || ''), message: rawMsg };
  }
  const msg = String(err || '');
  if (msg.startsWith('{')) {
    try {
      const parsed = JSON.parse(msg) as { error?: unknown };
      if (parsed && typeof parsed.error === 'string') {
        return { code: '', message: parsed.error };
      }
    } catch {
      // Ignore JSON parse errors
    }
  }
  return { code: '', message: msg };
}

function isPermissionDeniedError(err: unknown): boolean {
  const { code, message } = getFirebaseErrorCodeAndMessage(err);
  return (
    code === 'permission-denied' ||
    /permission[-_ ]denied|missing or insufficient permissions/i.test(message)
  );
}

function isNotFoundError(err: unknown): boolean {
  const { code, message } = getFirebaseErrorCodeAndMessage(err);
  return code === 'not-found' || /no document to update|not[-_ ]found/i.test(message);
}

const EXTENDED_MEDIA_IMAGE_KEYS = [
  'poster_url',
  'backdrop_url',
  'poster_width',
  'poster_height',
  'backdrop_width',
  'backdrop_height',
  'image_source',
  'image_quality_status',
  'director',
  'writer',
  'ageRating',
  'tmdbId',
  'skipSegments',
] as const;

function stripExtendedImageFields(payload: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...payload };
  for (const key of EXTENDED_MEDIA_IMAGE_KEYS) {
    delete clone[key];
  }
  return clone;
}

export function formatFirestoreWriteError(error: unknown, fallbackMessage: string): string {
  const { code, message } = getFirebaseErrorCodeAndMessage(error);
  const combined = `${code} ${message}`.toLowerCase();

  if (combined.includes('quota exceeded')) {
    return `${fallbackMessage}: تم تجاوز الحصة اليومية المجانية لقاعدة Firestore (Quota exceeded) — تتجدد الحصة تلقائياً في اليوم التالي.`;
  }
  if (combined.includes('permission-denied') || combined.includes('insufficient permissions')) {
    const activeDbId = getActiveFirebaseConfig().firestoreDatabaseId;
    return `${fallbackMessage}: مرفوض من قواعد الأمان (permission-denied) — تأكد من تحديث firestore.rules في قاعدة ${activeDbId} ومن وجود صلاحية المسؤول/المشرف لحسابك.`;
  }
  if (combined.includes('resource-exhausted') || combined.includes('maximum allowed size')) {
    return `${fallbackMessage}: حجم المستند يتجاوز الحد المسموح في Firestore (1MB) — قلل عدد الحلقات أو السيرفرات في العنصر الواحد.`;
  }
  if (combined.includes('invalid-argument')) {
    return `${fallbackMessage}: قيمة أحد الحقول غير صالحة (${message.slice(0, 120)}).`;
  }
  if (combined.includes('unauthenticated')) {
    return `${fallbackMessage}: انتهت جلسة تسجيل الدخول — أعد تسجيل الدخول إلى لوحة التحكم.`;
  }
  if (message) {
    return `${fallbackMessage} (${message.slice(0, 110)})`;
  }
  return fallbackMessage;
}

export type FirestoreConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'quota_exceeded'
  | 'permission_denied'
  | 'offline'
  | 'error';

export function classifyFirestoreConnectionError(err: unknown): {
  status: FirestoreConnectionStatus;
  message: string;
} {
  const { code, message } = getFirebaseErrorCodeAndMessage(err);
  const combined = `${code} ${message}`.toLowerCase();

  if (combined.includes('quota exceeded') || combined.includes('resource-exhausted')) {
    return {
      status: 'quota_exceeded',
      message:
        'تم تجاوز الحصة اليومية المجانية لقراءة قاعدة بيانات Firestore (Quota exceeded) — تتجدد الحصة تلقائياً غداً أو بعد ترقية الخطة.',
    };
  }
  if (combined.includes('permission-denied') || combined.includes('missing or insufficient permissions')) {
    return {
      status: 'permission_denied',
      message:
        'قاعدة البيانات متصلة ولكن قواعد الأمان (firestore.rules) الحالية ترفض القراءة — يرجى نشر ملف firestore.rules في Firebase Console.',
    };
  }
  if (combined.includes('the client is offline') || combined.includes('unavailable')) {
    return {
      status: 'offline',
      message: 'تعذر الوصول إلى خادم Firestore (تحقق من الاتصال بالإنترنت أو إعدادات المشروع).',
    };
  }
  return {
    status: 'error',
    message: message || 'حدث خطأ غير متوقع أثناء الاتصال بقاعدة بيانات Firestore.',
  };
}

// Mandatory boot connection check
export async function testConnection(): Promise<{
  ok: boolean;
  status: FirestoreConnectionStatus;
  message?: string;
}> {
  try {
    await getDocFromServer(doc(getActiveDatabase(), 'test', 'connection'));
    return { ok: true, status: 'connected' };
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
    const classified = classifyFirestoreConnectionError(error);
    return { ok: false, status: classified.status, message: classified.message };
  }
}
void testConnection();

export async function probeDatabaseConnection(): Promise<{
  ok: boolean;
  status: FirestoreConnectionStatus;
  message?: string;
}> {
  try {
    await getDocFromServer(doc(getActiveDatabase(), 'settings', 'general'));
    return { ok: true, status: 'connected' };
  } catch (error) {
    const classified = classifyFirestoreConnectionError(error);
    return { ok: false, status: classified.status, message: classified.message };
  }
}

export function normalizeAuthIdentifier(identifier: string): string {
  const clean = identifier.trim();
  if (!clean) return '';
  if (clean.includes('@')) return clean.toLowerCase();
  return `${clean.toLowerCase()}@rahaltv.com`;
}

export function getFirebaseAuthErrorMessage(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';
  const host = typeof window !== 'undefined' ? window.location.hostname : '';

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'البريد الإلكتروني / اسم المستخدم أو كلمة المرور غير صحيحة.';
    case 'auth/invalid-email':
      return 'صيغة البريد الإلكتروني غير صالحة.';
    case 'auth/email-already-in-use':
      return 'هذا البريد الإلكتروني أو اسم المستخدم مسجل بالفعل.';
    case 'auth/weak-password':
      return 'كلمة المرور ضعيفة — يجب أن تكون 6 أحرف على الأقل.';
    case 'auth/operation-not-allowed':
      return 'ميزة تسجيل الدخول بالبريد وكلمة المرور غير مفعّلة بعد في Firebase Console → Authentication → Sign-in method → Email/Password.';
    case 'auth/too-many-requests':
      return 'محاولات دخول متكررة، يرجى الانتظار قليلاً ثم المحاولة مرة أخرى.';
    case 'auth/unauthorized-domain':
      return `الدومين (${host}) غير مضاف في Firebase Authorized Domains.`;
    case 'auth/popup-blocked':
      return 'المتصفح منع النافذة المنبثقة لتسجيل الدخول.';
    case 'auth/popup-closed-by-user':
      return 'تم إغلاق نافذة تسجيل الدخول.';
    default:
      return `تعذر إتمام تسجيل الدخول (${code || 'خطأ غير معروف'}).`;
  }
}

export async function signInWithEmailPassword(identifier: string, password: string) {
  const email = normalizeAuthIdentifier(identifier);
  return signInWithEmailAndPassword(getActiveAuth(), email, password);
}

export async function registerMemberWithEmailPassword(
  identifier: string,
  password: string,
  displayName: string
) {
  const email = normalizeAuthIdentifier(identifier);
  const cred = await createUserWithEmailAndPassword(getActiveAuth(), email, password);
  if (displayName.trim()) {
    await updateProfile(cred.user, { displayName: displayName.trim().slice(0, 120) });
  }
  return cred;
}

export async function resendVerificationEmail(user: User) {
  return sendEmailVerification(user);
}

export async function signInWithGoogle() {
  return signInWithPopup(getActiveAuth(), googleProvider);
}

export async function signOutFirebase() {
  return signOut(getActiveAuth());
}

export async function getUserAdminRole(user: User | null): Promise<AdminPrivilegeRole | null> {
  if (!user) return null;
  const email = user.email?.toLowerCase() || '';
  if (user.emailVerified && PRIMARY_ADMIN_EMAILS.some((e) => e.toLowerCase() === email)) {
    return 'owner';
  }
  try {
    const adminDoc = await getDoc(doc(getActiveDatabase(), 'admins', user.uid));
    if (!adminDoc.exists()) return null;
    const data = adminDoc.data() as { role?: unknown };
    return data?.role === 'moderator' ? 'moderator' : 'owner';
  } catch {
    return null;
  }
}

export async function checkIsAdminUser(user: User | null): Promise<boolean> {
  const role = await getUserAdminRole(user);
  return role !== null;
}

const FALLBACK_POSTER_URL = fallbackPosterImg;
const FALLBACK_BACKDROP_URL = fallbackBackdropImg;

function extractServerTargetUrl(srv?: { url?: string; embedCode?: string }): string {
  if (!srv) return '';
  const embed = String(srv.embedCode || '').trim();
  if (embed) {
    const m = embed.match(/src\s*=\s*["']([^"']+)["']/i);
    if (m?.[1]) return m[1].trim();
    if (/^https?:\/\//i.test(embed)) return embed;
  }
  return String(srv.url || '').trim();
}

function sanitizeServerList(
  rawList: StreamServer[] | undefined,
  fallbackQuality: string,
  maxItems = 15,
  idPrefix = 'srv'
) {
  return (rawList || [])
    .filter((srv) => {
      if (!srv) return false;
      const targetUrl = extractServerTargetUrl(srv);
      if (!targetUrl) return false;
      return !isLikelyNonVideoWebsiteUrl(targetUrl);
    })
    .slice(0, maxItems)
    .map((srv, idx) => {
      const cleanUrl = String(srv.url || '').trim().slice(0, 600);
      const rawEmbed = String(srv.embedCode || '').trim().slice(0, 1200);
      const mode: 'url' | 'embed' =
        srv.mode === 'url' || (!rawEmbed && cleanUrl && !/embed/i.test(cleanUrl)) ? 'url' : 'embed';
      const embedCode =
        rawEmbed || (mode === 'embed' && cleanUrl ? `<iframe src="${cleanUrl}" frameborder="0" allowfullscreen></iframe>` : '');
      const rawSpeed = String(srv.speed || '').trim();
      const rawTag = String(srv.tag || '').trim();
      const rawName = String(srv.name || '').trim();
      const safeName =
        rawName && !/^(مستورد|embed|server)$/i.test(rawName)
          ? rawName.slice(0, 60)
          : `سيرفر ${idx + 1}`;
      const cleanQuality = String(srv.quality || fallbackQuality || '1080p').trim().slice(0, 40) || '1080p';
      return {
        id: String(srv.id || `${idPrefix}-${Date.now()}-${idx + 1}`).slice(0, 80),
        name: safeName,
        mode,
        url: cleanUrl,
        embedCode,
        quality: cleanQuality,
        speed: !rawSpeed || /مستورد/i.test(rawSpeed) ? 'سريع' : rawSpeed.slice(0, 40),
        tag: !rawTag || /^embed$/i.test(rawTag) ? cleanQuality : rawTag.slice(0, 30),
      };
    });
}

function sanitizeMediaPayload(item: MediaItem, uid: string, isCreate: boolean) {
  const cleanId =
    String(item.id || '')
      .replace(/[^a-zA-Z0-9_\-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 128) || `media-${Date.now()}`;
  const safeTitle = String(item.title || 'عمل مستورد').trim().slice(0, 200) || 'عمل مستورد';
  const safeEnglishTitle = String(item.englishTitle || safeTitle).trim().slice(0, 200) || safeTitle;
  const rawSlugCandidate = String(item.slug || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128);
  const safeSlug =
    rawSlugCandidate && rawSlugCandidate.length >= 2
      ? rawSlugCandidate
      : generateCleanSlug(safeEnglishTitle, safeTitle, cleanId);
  const dedicatedShortUrl = isDedicatedAppShortUrl(item.shortUrl)
    ? String(item.shortUrl).trim().slice(0, 300)
    : buildDedicatedMediaUrl({ id: cleanId, slug: safeSlug }).slice(0, 300);

  const rawPosterInput = String(item.poster_url || item.poster || '').trim().slice(0, 500);
  const safePoster = rawPosterInput || FALLBACK_POSTER_URL;
  const rawBackdropUrl = String(
    item.backdrop_url !== undefined ? item.backdrop_url : item.backdrop || ''
  )
    .trim()
    .slice(0, 500);
  const hasDistinctBackdropInput = Boolean(rawBackdropUrl && rawBackdropUrl !== safePoster);
  const safeBackdropUrl = hasDistinctBackdropInput ? rawBackdropUrl : '';
  // Legacy required `backdrop` field stays non-empty in Firestore rules and avoids portrait stretching
  const safeBackdrop = safeBackdropUrl || FALLBACK_BACKDROP_URL;

  const posterWidth = Math.max(0, Math.min(20000, Math.round(Number(item.poster_width) || 0)));
  const posterHeight = Math.max(0, Math.min(20000, Math.round(Number(item.poster_height) || 0)));
  const backdropWidth = Math.max(0, Math.min(20000, Math.round(Number(item.backdrop_width) || 0)));
  const backdropHeight = Math.max(0, Math.min(20000, Math.round(Number(item.backdrop_height) || 0)));
  const computedQuality = evaluateImageQuality({
    posterUrl: safePoster,
    backdropUrl: safeBackdropUrl,
    posterWidth,
    posterHeight,
    backdropWidth,
    backdropHeight,
  });
  const imageQualityStatus =
    computedQuality !== 'unknown'
      ? computedQuality
      : item.image_quality_status || (hasDistinctBackdropInput ? 'unknown' : 'missing_backdrop');
  const imageSource =
    String(item.image_source || (safePoster === FALLBACK_POSTER_URL ? 'fallback' : 'manual'))
      .trim()
      .slice(0, 60) || 'manual';

  const safeYear = String(item.year || '2026').trim().slice(0, 10);
  const normalizedYear = safeYear.length >= 4 ? safeYear : '2026';
  const safeKind = (['movie', 'series', 'tv', 'wrestling'] as const).includes(item.kind)
    ? item.kind
    : 'movie';

  const normalizedCategories = (item.categories || [])
    .map((c) => String(c || '').trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 10);
  const normalizedGenres = (item.genres || [])
    .map((g) => String(g || '').trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 10);

  let normalizedServers = sanitizeServerList(item.servers, String(item.quality || '1080p'), 15, 'srv');

  const normalizedDownloads = (item.downloads || [])
    .filter((dl) => dl && String(dl.url || '').trim())
    .slice(0, 15)
    .map((dl, idx) => ({
      id: String(dl.id || `dl-${Date.now()}-${idx}`).slice(0, 80),
      host: String(dl.host || `رابط تحميل ${idx + 1}`).trim().slice(0, 80) || `رابط تحميل ${idx + 1}`,
      quality: String(dl.quality || item.quality || '1080p').trim().slice(0, 40) || '1080p',
      size: String(dl.size || 'حسب السيرفر').trim().slice(0, 40) || 'حسب السيرفر',
      format: String(dl.format || 'MP4').trim().slice(0, 20) || 'MP4',
      url: String(dl.url || '').trim().slice(0, 600),
    }));

  const normalizedCast = (item.cast || [])
    .filter((c) => c && String(c.name || '').trim())
    .slice(0, 25)
    .map((c) => {
      const nm = String(c.name).trim().slice(0, 80);
      return {
        name: nm,
        role: String(c.role || 'ممثل').trim().slice(0, 60) || 'ممثل',
        initials: String(c.initials || nm.slice(0, 2).toUpperCase() || 'RT').slice(0, 6),
      };
    });

  const normalizedSeasons = (item.seasons || []).slice(0, 20).map((season, sIdx) => ({
    seasonNumber: Number(season.seasonNumber) || sIdx + 1,
    label: String(season.label || `الموسم ${String(sIdx + 1).padStart(2, '0')}`).trim().slice(0, 80),
    year: String(season.year || normalizedYear).trim().slice(0, 10) || normalizedYear,
    episodes: (season.episodes || []).slice(0, 120).map((ep, eIdx) => {
      const epNum = Number(ep.number) || eIdx + 1;
      const epQual = String(ep.quality || item.quality || 'WEB-DL').trim().slice(0, 40) || 'WEB-DL';
      const epServers = sanitizeServerList(ep.servers, epQual, 12, `ep-${epNum}-srv`);
      let cleanWatchUrl = String(ep.watchUrl || '').trim().slice(0, 600);
      if (cleanWatchUrl && isLikelyNonVideoWebsiteUrl(cleanWatchUrl)) {
        cleanWatchUrl = epServers[0]?.url || '';
      }
      let cleanEmbedCode = String(ep.embedCode || '').trim().slice(0, 1200);
      if (cleanEmbedCode) {
        const emSrc = extractServerTargetUrl({ embedCode: cleanEmbedCode });
        if (!emSrc || isLikelyNonVideoWebsiteUrl(emSrc)) {
          cleanEmbedCode = '';
        }
      }
      return {
        number: epNum,
        title: String(ep.title || `الحلقة ${epNum}`).trim().slice(0, 120) || `الحلقة ${epNum}`,
        duration: String(ep.duration || '45 دقيقة').trim().slice(0, 40) || '45 دقيقة',
        quality: epQual,
        watchUrl: cleanWatchUrl || epServers[0]?.url || '',
        embedCode: cleanEmbedCode,
        servers: epServers,
        ...(sanitizeSkipSegments(ep.skipSegments) ? { skipSegments: sanitizeSkipSegments(ep.skipSegments) } : {}),
      };
    }),
  }));

  if (normalizedServers.length === 0 && normalizedSeasons.length > 0) {
    const ep1Servers = normalizedSeasons[0].episodes.find((ep) => ep.servers && ep.servers.length > 0)?.servers;
    if (ep1Servers && ep1Servers.length > 0) {
      normalizedServers = ep1Servers.map((s, idx) => ({
        ...s,
        id: `srv-${Date.now()}-${idx + 1}`,
        name: s.name || `سيرفر ${idx + 1}`,
      }));
    }
  }

  const parsedImdb = Number(item.imdb);
  const safeImdb = Number.isFinite(parsedImdb) ? Math.min(10, Math.max(0, parsedImdb)) : 0;

  const base: Record<string, unknown> = {
    id: cleanId,
    slug: safeSlug,
    title: safeTitle,
    englishTitle: safeEnglishTitle,
    kind: safeKind,
    categories: normalizedCategories.length ? normalizedCategories : ['افلام'],
    genres: normalizedGenres.length ? normalizedGenres : ['دراما'],
    year: normalizedYear,
    country: String(item.country || 'الولايات المتحدة').trim().slice(0, 80) || 'الولايات المتحدة',
    language: String(item.language || 'الانجليزية').trim().slice(0, 80) || 'الانجليزية',
    quality: String(item.quality || 'WEB-DL').trim().slice(0, 40) || 'WEB-DL',
    duration: String(item.duration || '120 دقيقة').trim().slice(0, 40) || '120 دقيقة',
    imdb: safeImdb,
    votes: String(item.votes || '0').trim().slice(0, 40) || '0',
    views: Math.max(0, Math.round(Number(item.views) || 0)),
    likes: Math.max(0, Math.round(Number(item.likes) || 0)),
    pinned: Boolean(item.pinned),
    isNew: Boolean(item.isNew),
    comingSoon: Boolean(item.comingSoon),
    poster: safePoster,
    backdrop: safeBackdrop,
    poster_url: safePoster,
    backdrop_url: safeBackdropUrl,
    poster_width: posterWidth,
    poster_height: posterHeight,
    backdrop_width: backdropWidth,
    backdrop_height: backdropHeight,
    image_source: imageSource,
    image_quality_status: imageQualityStatus,
    tagline: String(item.tagline || '').slice(0, 400),
    story: String(item.story || safeTitle).trim().slice(0, 3000) || safeTitle,
    shortUrl: dedicatedShortUrl,
    trailerUrl: String(item.trailerUrl || '').slice(0, 500),
    trailerLabel: String(item.trailerLabel || safeTitle).slice(0, 200),
    trailerDuration: String(item.trailerDuration || '02:00').slice(0, 30),
    cast: normalizedCast,
    seasons: normalizedSeasons,
    franchiseIds: (item.franchiseIds || []).map((f) => String(f)).slice(0, 15),
    servers: normalizedServers,
    downloads: normalizedDownloads,
    updatedBy: String(uid || '').slice(0, 128),
    updatedAt: serverTimestamp(),
  };

  const cleanDirector = String(item.director || '').trim().slice(0, 160);
  if (cleanDirector) base.director = cleanDirector;
  const cleanWriter = String(item.writer || '').trim().slice(0, 160);
  if (cleanWriter) base.writer = cleanWriter;
  const cleanAgeRating = String(item.ageRating || '').trim().slice(0, 24);
  if (cleanAgeRating) base.ageRating = cleanAgeRating;
  const parsedTmdbId = Number(item.tmdbId);
  if (Number.isFinite(parsedTmdbId) && parsedTmdbId > 0) {
    base.tmdbId = Math.round(parsedTmdbId);
  }
  const cleanSkip = sanitizeSkipSegments(item.skipSegments);
  if (cleanSkip) {
    base.skipSegments = cleanSkip;
  }

  if (isCreate) {
    base.createdAt = serverTimestamp();
  }
  return { cleanId, payload: base };
}

function sanitizeSkipSegments(raw?: SkipSegmentsConfig | null): SkipSegmentsConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: SkipSegmentsConfig = {};
  const assign = (key: keyof SkipSegmentsConfig) => {
    const val = Number(raw[key]);
    if (Number.isFinite(val) && val >= 0 && val <= 36000) {
      out[key] = Math.round(val);
    }
  };
  assign('introStartSec');
  assign('introEndSec');
  assign('recapStartSec');
  assign('recapEndSec');
  assign('nextSceneSec');
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function seedCatalogToFirestore(items: MediaItem[], uid: string) {
  const activeDb = getActiveDatabase();
  const path = 'media';
  const prepared = items.map((item) => sanitizeMediaPayload(item, uid, true));
  try {
    const batch = writeBatch(activeDb);
    for (const { cleanId, payload } of prepared) {
      batch.set(doc(activeDb, 'media', cleanId), payload);
    }
    await batch.commit();
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      try {
        const legacyBatch = writeBatch(activeDb);
        for (const { cleanId, payload } of prepared) {
          legacyBatch.set(doc(activeDb, 'media', cleanId), stripExtendedImageFields(payload));
        }
        await legacyBatch.commit();
        return;
      } catch (legacyErr) {
        handleFirestoreError(legacyErr, OperationType.WRITE, path);
      }
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function bulkSaveMediaToFirestore(items: MediaItem[], uid: string): Promise<number> {
  const activeDb = getActiveDatabase();
  const path = 'media';
  const CHUNK_SIZE = 35;
  let savedCount = 0;
  try {
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);
      const prepared = chunk.map((item) => sanitizeMediaPayload(item, uid, true));
      try {
        const batch = writeBatch(activeDb);
        for (const { cleanId, payload } of prepared) {
          batch.set(doc(activeDb, 'media', cleanId), payload);
        }
        await batch.commit();
      } catch (chunkErr) {
        if (isPermissionDeniedError(chunkErr)) {
          const legacyBatch = writeBatch(activeDb);
          for (const { cleanId, payload } of prepared) {
            legacyBatch.set(doc(activeDb, 'media', cleanId), stripExtendedImageFields(payload));
          }
          await legacyBatch.commit();
        } else {
          throw chunkErr;
        }
      }
      savedCount += chunk.length;
    }
    return savedCount;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function bulkUpdateMediaInFirestore(items: MediaItem[], uid: string): Promise<number> {
  const activeDb = getActiveDatabase();
  const path = 'media';
  const CHUNK_SIZE = 35;
  let updatedCount = 0;
  try {
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);
      const prepared = chunk.map((item) => sanitizeMediaPayload(item, uid, false));
      try {
        const batch = writeBatch(activeDb);
        for (const { cleanId, payload } of prepared) {
          batch.update(doc(activeDb, 'media', cleanId), payload);
        }
        await batch.commit();
      } catch (chunkErr) {
        if (isPermissionDeniedError(chunkErr)) {
          const legacyBatch = writeBatch(activeDb);
          for (const { cleanId, payload } of prepared) {
            legacyBatch.update(doc(activeDb, 'media', cleanId), stripExtendedImageFields(payload));
          }
          await legacyBatch.commit();
        } else {
          throw chunkErr;
        }
      }
      updatedCount += chunk.length;
    }
    return updatedCount;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function saveMediaToFirestore(
  item: MediaItem,
  uid: string,
  isCreate: boolean
): Promise<{ usedLegacySchemaFallback: boolean }> {
  const activeDb = getActiveDatabase();
  const { cleanId, payload } = sanitizeMediaPayload(item, uid, isCreate);
  const path = `media/${cleanId}`;
  const docRef = doc(activeDb, 'media', cleanId);

  const writeDoc = async (docPayload: Record<string, unknown>, createMode: boolean) => {
    if (createMode) {
      await setDoc(docRef, {
        ...docPayload,
        createdAt: docPayload.createdAt || serverTimestamp(),
      });
    } else {
      try {
        await updateDoc(docRef, docPayload);
      } catch (updateErr) {
        if (isNotFoundError(updateErr)) {
          await setDoc(docRef, {
            ...docPayload,
            createdAt: serverTimestamp(),
          });
        } else {
          throw updateErr;
        }
      }
    }
  };

  try {
    await writeDoc(payload, isCreate);
    return { usedLegacySchemaFallback: false };
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      try {
        await writeDoc(stripExtendedImageFields(payload), isCreate);
        return { usedLegacySchemaFallback: true };
      } catch (legacyErr) {
        handleFirestoreError(legacyErr, isCreate ? OperationType.CREATE : OperationType.UPDATE, path);
      }
    }
    handleFirestoreError(error, isCreate ? OperationType.CREATE : OperationType.UPDATE, path);
  }
}

export async function deleteMediaFromFirestore(mediaId: string) {
  const activeDb = getActiveDatabase();
  const path = `media/${mediaId}`;
  try {
    await deleteDoc(doc(activeDb, 'media', mediaId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function bulkDeleteMediaFromFirestore(mediaIds: string[]): Promise<number> {
  const activeDb = getActiveDatabase();
  const path = 'media';
  const CHUNK_SIZE = 400;
  let deletedCount = 0;
  try {
    const validIds = mediaIds
      .map((id) => String(id || '').trim())
      .filter((id) => /^[a-zA-Z0-9_\-]+$/.test(id));
    for (let i = 0; i < validIds.length; i += CHUNK_SIZE) {
      const chunk = validIds.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(activeDb);
      for (const id of chunk) {
        batch.delete(doc(activeDb, 'media', id));
      }
      await batch.commit();
      deletedCount += chunk.length;
    }
    return deletedCount;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function submitVisitorRequestToFirestore(
  user: User,
  req: { title: string; type: VisitorRequest['type']; notes: string }
) {
  const activeDb = getActiveDatabase();
  const id = `req_${Date.now()}`;
  const path = `requests/${id}`;
  try {
    await setDoc(doc(activeDb, 'requests', id), {
      id,
      userId: user.uid,
      requesterName: (user.displayName || 'مستخدم RahaL TV').slice(0, 120),
      title: req.title.trim().slice(0, 200),
      type: req.type,
      notes: req.notes.trim().slice(0, 500),
      status: 'pending',
      adminNote: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateVisitorRequestInFirestore(
  requestId: string,
  status: RequestStatus,
  adminNote: string
) {
  const activeDb = getActiveDatabase();
  const path = `requests/${requestId}`;
  try {
    await updateDoc(doc(activeDb, 'requests', requestId), {
      status,
      adminNote: adminNote.trim().slice(0, 500),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteVisitorRequestFromFirestore(requestId: string) {
  const activeDb = getActiveDatabase();
  const path = `requests/${requestId}`;
  try {
    await deleteDoc(doc(activeDb, 'requests', requestId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function syncUserProfileToFirestore(
  user: User,
  localWatchlist: string[],
  isAdminUser: boolean
): Promise<string[]> {
  const activeDb = getActiveDatabase();
  const userPath = `users/${user.uid}`;
  const privatePath = `users/${user.uid}/private/info`;
  try {
    const userRef = doc(activeDb, 'users', user.uid);
    const snap = await getDoc(userRef);

    if (user.email) {
      await setDoc(
        doc(activeDb, 'users', user.uid, 'private', 'info'),
        {
          email: user.email.slice(0, 200),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    if (!snap.exists()) {
      const mergedWatchlist = localWatchlist.slice(0, 100);
      await setDoc(userRef, {
        uid: user.uid,
        displayName: (user.displayName || 'عضو RahaL TV').slice(0, 120),
        photoURL: (user.photoURL || '').slice(0, 500),
        watchlistIds: mergedWatchlist,
        role: isAdminUser ? 'admin' : 'member',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return mergedWatchlist;
    } else {
      const existingList = Array.isArray(snap.data().watchlistIds)
        ? (snap.data().watchlistIds as string[])
        : [];
      await updateDoc(userRef, {
        displayName: (user.displayName || snap.data().displayName || 'عضو RahaL TV').slice(0, 120),
        photoURL: (user.photoURL || '').slice(0, 500),
        updatedAt: serverTimestamp(),
      });
      return existingList;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${userPath} / ${privatePath}`);
  }
}

export async function saveWatchlistToFirestore(uid: string, watchlistIds: string[]) {
  const activeDb = getActiveDatabase();
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(activeDb, 'users', uid), {
      watchlistIds: watchlistIds.slice(0, 100),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export type SettingsOptionalSection = 'homeConfig' | 'typography' | 'popupShield' | 'branding';

export interface SaveSiteSettingsResult {
  syncedHomeToCloud: boolean;
  syncedTypographyToCloud: boolean;
  syncedPopupShieldToCloud: boolean;
  syncedBrandingToCloud: boolean;
  rejectedSections: SettingsOptionalSection[];
  projectId: string;
  databaseId: string;
}

async function writeSplitHomeDocs(
  activeDb: Firestore,
  normalizedHome: ReturnType<typeof normalizeHomeConfig>,
  uid: string
): Promise<{ homeLayoutOk: boolean; sliderStyleOk: boolean }> {
  let homeLayoutOk = false;
  let sliderStyleOk = false;

  try {
    await setDoc(doc(activeDb, 'settings', 'home_layout'), {
      ...pickLegacyAutoplayHomeConfig(normalizedHome),
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    homeLayoutOk = true;
  } catch (err) {
    if (!isPermissionDeniedError(err)) {
      throw err;
    }
  }

  try {
    await setDoc(doc(activeDb, 'settings', 'slider_style'), {
      ...pickSliderStyleHomeConfig(normalizedHome),
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    sliderStyleOk = true;
  } catch (err) {
    if (!isPermissionDeniedError(err)) {
      throw err;
    }
  }

  return { homeLayoutOk, sliderStyleOk };
}

async function writeSplitBrandingDoc(
  activeDb: Firestore,
  firestoreBranding: ReturnType<typeof sanitizeBrandingForFirestore>,
  uid: string
): Promise<boolean> {
  try {
    await setDoc(doc(activeDb, 'settings', 'site_branding'), {
      ...firestoreBranding,
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      return false;
    }
    throw err;
  }
}

export async function saveSiteSettingsToFirestore(
  settings: SiteSettings,
  uid: string
): Promise<SaveSiteSettingsResult> {
  const activeDb = getActiveDatabase();
  const activeCfg = getActiveFirebaseConfig();
  const projectId = activeCfg.projectId;
  const databaseId = activeCfg.firestoreDatabaseId || '(default)';
  const path = 'settings/general';
  const normalizedTheme = saveStoredPlayerTheme(settings.playerTheme || DEFAULT_PLAYER_THEME);
  const normalizedHome = saveStoredHomeConfig(settings.homeConfig || DEFAULT_HOME_CONFIG);
  const normalizedTypography = saveStoredTypographyConfig(
    settings.typography || DEFAULT_TYPOGRAPHY_CONFIG
  );
  const normalizedShield = saveStoredPopupShieldConfig(
    settings.popupShield || DEFAULT_POPUP_SHIELD_CONFIG
  );
  const normalizedBrandingLocal = saveStoredWebsiteBranding(
    settings.branding || { ...DEFAULT_WEBSITE_BRANDING, siteName: settings.siteName },
    settings.siteName
  );
  const firestoreBranding = sanitizeBrandingForFirestore(
    normalizedBrandingLocal,
    settings.siteName
  );

  const corePayload: Record<string, unknown> = {
    siteName: settings.siteName.trim().slice(0, 80) || 'RahaL TV',
    tagline: settings.tagline.trim().slice(0, 300) || 'منصة RahaL TV الترفيهية',
    announcementText: settings.announcementText.trim().slice(0, 300),
    tickerEnabled: Boolean(settings.tickerEnabled),
    featuredLimit: Math.min(20, Math.max(1, Math.round(Number(settings.featuredLimit) || 5))),
    maintenanceMode: Boolean(settings.maintenanceMode),
    maintenanceMessage: (settings.maintenanceMessage || '').trim().slice(0, 500),
    playerTheme: normalizedTheme,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  };

  const extendedPayloadWithoutBranding: Record<string, unknown> = {
    ...corePayload,
    homeConfig: normalizedHome,
    typography: normalizedTypography,
    popupShield: normalizedShield,
  };

  try {
    await setDoc(doc(activeDb, 'settings', 'general'), {
      ...extendedPayloadWithoutBranding,
      branding: firestoreBranding,
    });
    return {
      syncedHomeToCloud: true,
      syncedTypographyToCloud: true,
      syncedPopupShieldToCloud: true,
      syncedBrandingToCloud: true,
      rejectedSections: [],
      projectId,
      databaseId,
    };
  } catch (error) {
    if (!isPermissionDeniedError(error)) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }

    // Tier 2: try without branding on settings/general (and mirror branding to settings/site_branding if enabled)
    try {
      await setDoc(doc(activeDb, 'settings', 'general'), extendedPayloadWithoutBranding);
      const splitBrandingOk = await writeSplitBrandingDoc(activeDb, firestoreBranding, uid);
      if (!splitBrandingOk) {
        reportClientError({
          source: 'firestore.settings.partial_sync',
          level: 'warn',
          message: `Settings write rejected branding on ${projectId}/${databaseId} (permission-denied); homeConfig/typography/popupShield synced.`,
        });
      }
      return {
        syncedHomeToCloud: true,
        syncedTypographyToCloud: true,
        syncedPopupShieldToCloud: true,
        syncedBrandingToCloud: splitBrandingOk,
        rejectedSections: splitBrandingOk ? [] : ['branding'],
        projectId,
        databaseId,
      };
    } catch (midErr) {
      if (!isPermissionDeniedError(midErr)) {
        handleFirestoreError(midErr, OperationType.WRITE, path);
      }
    }

    // Tier 3: First sync Home Layout + Slider Style via dedicated lightweight documents
    // so Firestore's map-complexity ceiling on settings/general never drops the 19 slider styling keys.
    let splitHomeSynced = false;
    try {
      const splitRes = await writeSplitHomeDocs(activeDb, normalizedHome, uid);
      splitHomeSynced = splitRes.homeLayoutOk && splitRes.sliderStyleOk;
    } catch (splitErr) {
      handleFirestoreError(splitErr, OperationType.WRITE, 'settings/home_layout');
    }

    // Also persist each optional section on settings/general independently/cumulatively.
    const docRef = doc(activeDb, 'settings', 'general');
    const acceptedPayload: Record<string, unknown> = { ...corePayload };
    const statusMap: Record<SettingsOptionalSection, boolean> = {
      typography: false,
      popupShield: false,
      homeConfig: splitHomeSynced,
      branding: false,
    };
    const optionalEntries: Array<{
      key: SettingsOptionalSection;
      value: unknown;
    }> = [
      { key: 'typography', value: normalizedTypography },
      { key: 'popupShield', value: normalizedShield },
      { key: 'branding', value: firestoreBranding },
      ...(!splitHomeSynced ? [{ key: 'homeConfig' as const, value: normalizedHome }] : []),
    ];

    let anyOptionalWritten = false;
    for (const entry of optionalEntries) {
      const candidate: Record<string, unknown> = {
        ...acceptedPayload,
        [entry.key]: entry.value,
      };
      try {
        await setDoc(docRef, candidate);
        acceptedPayload[entry.key] = entry.value;
        statusMap[entry.key] = true;
        anyOptionalWritten = true;
      } catch (secErr) {
        if (!isPermissionDeniedError(secErr)) {
          handleFirestoreError(secErr, OperationType.WRITE, path);
        }
      }
    }

    if (!statusMap.branding) {
      try {
        statusMap.branding = await writeSplitBrandingDoc(activeDb, firestoreBranding, uid);
      } catch (brandErr) {
        handleFirestoreError(brandErr, OperationType.WRITE, 'settings/site_branding');
      }
    }

    if (!anyOptionalWritten) {
      try {
        await setDoc(docRef, corePayload, { merge: true });
      } catch (mergeErr) {
        if (isPermissionDeniedError(mergeErr)) {
          try {
            await setDoc(docRef, corePayload);
          } catch (innerErr) {
            handleFirestoreError(innerErr, OperationType.WRITE, path);
          }
        } else {
          handleFirestoreError(mergeErr, OperationType.WRITE, path);
        }
      }
    }

    const rejectedSections = (
      ['homeConfig', 'typography', 'popupShield', 'branding'] as SettingsOptionalSection[]
    ).filter((k) => !statusMap[k]);

    if (rejectedSections.length > 0) {
      reportClientError({
        source: 'firestore.settings.partial_sync',
        level: 'warn',
        message: `Firestore rules on ${projectId}/${databaseId} rejected sections: [${rejectedSections.join(', ')}].`,
      });
    }

    return {
      syncedHomeToCloud: statusMap.homeConfig,
      syncedTypographyToCloud: statusMap.typography,
      syncedPopupShieldToCloud: statusMap.popupShield,
      syncedBrandingToCloud: statusMap.branding,
      rejectedSections,
      projectId,
      databaseId,
    };
  }
}

export type HomeConfigRulesMode = 'full' | 'split_sync' | 'autoplay_only' | 'core_only' | 'rejected';

export type RulesDiagnosticReport =
  | {
      ok: true;
      result: SaveSiteSettingsResult;
      homeConfigMode: HomeConfigRulesMode;
      outdatedRulesDetected: boolean;
      payloadIssueDetected: boolean;
      rejectedHomeKeys: string[];
      homeComplexityLimitDetected: boolean;
      splitDocsReady: {
        homeLayout: boolean;
        sliderStyle: boolean;
        siteBranding: boolean;
      };
      userEmail: string | null;
      emailVerified: boolean;
    }
  | {
      ok: false;
      errorMessage: string;
      projectId: string;
      databaseId: string;
      userEmail: string | null;
      emailVerified: boolean;
    };

export async function diagnoseFirestoreSettingsRules(
  settings: SiteSettings,
  uid: string
): Promise<RulesDiagnosticReport> {
  const activeDb = getActiveDatabase();
  const activeCfg = getActiveFirebaseConfig();
  const projectId = activeCfg.projectId;
  const databaseId = activeCfg.firestoreDatabaseId || '(default)';
  const currentUser = getActiveAuth().currentUser;
  const userEmail = currentUser?.email ?? null;
  const emailVerified = Boolean(currentUser?.emailVerified);

  const normalizedTheme = saveStoredPlayerTheme(settings.playerTheme || DEFAULT_PLAYER_THEME);
  const normalizedHome = saveStoredHomeConfig(settings.homeConfig || DEFAULT_HOME_CONFIG);
  const normalizedTypography = saveStoredTypographyConfig(
    settings.typography || DEFAULT_TYPOGRAPHY_CONFIG
  );
  const normalizedShield = saveStoredPopupShieldConfig(
    settings.popupShield || DEFAULT_POPUP_SHIELD_CONFIG
  );
  const normalizedBrandingLocal = saveStoredWebsiteBranding(
    settings.branding || { ...DEFAULT_WEBSITE_BRANDING, siteName: settings.siteName },
    settings.siteName
  );
  const firestoreBranding = sanitizeBrandingForFirestore(
    normalizedBrandingLocal,
    settings.siteName
  );

  const corePayload: Record<string, unknown> = {
    siteName: settings.siteName.trim().slice(0, 80) || 'RahaL TV',
    tagline: settings.tagline.trim().slice(0, 300) || 'منصة RahaL TV الترفيهية',
    announcementText: settings.announcementText.trim().slice(0, 300),
    tickerEnabled: Boolean(settings.tickerEnabled),
    featuredLimit: Math.min(20, Math.max(1, Math.round(Number(settings.featuredLimit) || 5))),
    maintenanceMode: Boolean(settings.maintenanceMode),
    maintenanceMessage: (settings.maintenanceMessage || '').trim().slice(0, 500),
    playerTheme: normalizedTheme,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  };

  // Probe non-destructively on settings/rules_diagnostic first.
  const probeRef = doc(activeDb, 'settings', 'rules_diagnostic');
  const tryProbe = async (payload: Record<string, unknown>): Promise<boolean> => {
    try {
      await setDoc(probeRef, payload);
      return true;
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        return false;
      }
      throw err;
    }
  };

  try {
    await setDoc(probeRef, corePayload);

    const syncedTypographyToCloud = await tryProbe({
      ...corePayload,
      typography: normalizedTypography,
    });

    const syncedPopupShieldToCloud = await tryProbe({
      ...corePayload,
      popupShield: normalizedShield,
    });

    const brandingStandaloneOk = await tryProbe({
      ...corePayload,
      branding: firestoreBranding,
    });

    let brandingDefaultOk = brandingStandaloneOk;
    if (!brandingStandaloneOk) {
      brandingDefaultOk = await tryProbe({
        ...corePayload,
        branding: sanitizeBrandingForFirestore(DEFAULT_WEBSITE_BRANDING, 'RahaL TV'),
      });
    }

    const combinedGeneralWithBrandingOk =
      syncedTypographyToCloud && syncedPopupShieldToCloud && brandingStandaloneOk
        ? await tryProbe({
            ...corePayload,
            typography: normalizedTypography,
            popupShield: normalizedShield,
            branding: firestoreBranding,
          })
        : brandingStandaloneOk;

    const splitBrandingDocOk = await writeSplitBrandingDoc(activeDb, firestoreBranding, uid);
    const syncedBrandingToCloud = combinedGeneralWithBrandingOk || splitBrandingDocOk;

    const fullHomeOnGeneralOk = await tryProbe({
      ...corePayload,
      homeConfig: normalizedHome,
    });

    let syncedHomeToCloud = fullHomeOnGeneralOk;
    let homeConfigMode: HomeConfigRulesMode = fullHomeOnGeneralOk ? 'full' : 'rejected';
    let homeDefaultFullOk = fullHomeOnGeneralOk;
    const rejectedHomeKeys: string[] = [];
    let homeComplexityLimitDetected = false;
    let splitHomeResult = { homeLayoutOk: false, sliderStyleOk: false };

    if (!fullHomeOnGeneralOk) {
      splitHomeResult = await writeSplitHomeDocs(activeDb, normalizedHome, uid);
      if (splitHomeResult.homeLayoutOk && splitHomeResult.sliderStyleOk) {
        syncedHomeToCloud = true;
        homeConfigMode = 'split_sync';
      } else {
        const defaultHome = normalizeHomeConfig(DEFAULT_HOME_CONFIG);
        homeDefaultFullOk = await tryProbe({
          ...corePayload,
          homeConfig: defaultHome,
        });

        const autoplayBase = pickLegacyAutoplayHomeConfig(defaultHome);
        const autoplayOk = await tryProbe({
          ...corePayload,
          homeConfig: autoplayBase,
        });
        if (autoplayOk) {
          homeConfigMode = 'autoplay_only';
          const halfSplit = Math.ceil(HOME_CONFIG_SLIDER_STYLE_KEYS.length / 2);
          const firstHalfKeys = HOME_CONFIG_SLIDER_STYLE_KEYS.slice(0, halfSplit);
          const secondHalfKeys = HOME_CONFIG_SLIDER_STYLE_KEYS.slice(halfSplit);

          const buildWithKeys = (keys: readonly (typeof HOME_CONFIG_SLIDER_STYLE_KEYS)[number][]) => {
            const obj: Record<string, unknown> = { ...autoplayBase };
            for (const k of keys) {
              obj[k] = defaultHome[k];
            }
            return obj;
          };

          const halfAOk = await tryProbe({
            ...corePayload,
            homeConfig: buildWithKeys(firstHalfKeys),
          });
          const halfBOk = await tryProbe({
            ...corePayload,
            homeConfig: buildWithKeys(secondHalfKeys),
          });

          if (halfAOk && halfBOk) {
            homeComplexityLimitDetected = true;
          } else {
            if (!halfAOk) {
              for (const key of firstHalfKeys) {
                const ok = await tryProbe({
                  ...corePayload,
                  homeConfig: buildWithKeys([key]),
                });
                if (!ok) rejectedHomeKeys.push(key);
              }
            }
            if (!halfBOk) {
              for (const key of secondHalfKeys) {
                const ok = await tryProbe({
                  ...corePayload,
                  homeConfig: buildWithKeys([key]),
                });
                if (!ok) rejectedHomeKeys.push(key);
              }
            }
            if (rejectedHomeKeys.length === 0) {
              homeComplexityLimitDetected = true;
            }
          }
        } else {
          const coreOnlyOk = await tryProbe({
            ...corePayload,
            homeConfig: pickLegacyCoreHomeConfig(defaultHome),
          });
          if (coreOnlyOk) {
            homeConfigMode = 'core_only';
          }
        }
      }
    }

    const rejectedSections = (
      ['homeConfig', 'typography', 'popupShield', 'branding'] as SettingsOptionalSection[]
    ).filter((k) => {
      if (k === 'homeConfig') return !syncedHomeToCloud;
      if (k === 'typography') return !syncedTypographyToCloud;
      if (k === 'popupShield') return !syncedPopupShieldToCloud;
      return !syncedBrandingToCloud;
    });

    const payloadIssueDetected =
      (!syncedHomeToCloud && homeDefaultFullOk) || (!syncedBrandingToCloud && brandingDefaultOk);

    const outdatedRulesDetected =
      !payloadIssueDetected &&
      !homeComplexityLimitDetected &&
      (!syncedHomeToCloud || !syncedBrandingToCloud) &&
      (syncedTypographyToCloud ||
        syncedPopupShieldToCloud ||
        homeConfigMode === 'autoplay_only' ||
        homeConfigMode === 'core_only');

    if (rejectedSections.length === 0) {
      // Immediately synchronize live settings across settings/general and split docs
      await saveSiteSettingsToFirestore(settings, uid);
    }

    return {
      ok: true,
      result: {
        syncedHomeToCloud,
        syncedTypographyToCloud,
        syncedPopupShieldToCloud,
        syncedBrandingToCloud,
        rejectedSections,
        projectId,
        databaseId,
      },
      homeConfigMode,
      outdatedRulesDetected,
      payloadIssueDetected,
      rejectedHomeKeys,
      homeComplexityLimitDetected,
      splitDocsReady: {
        homeLayout: splitHomeResult.homeLayoutOk,
        sliderStyle: splitHomeResult.sliderStyleOk,
        siteBranding: splitBrandingDocOk,
      },
      userEmail,
      emailVerified,
    };
  } catch (err) {
    return {
      ok: false,
      errorMessage: formatFirestoreWriteError(err, 'تعذر الكتابة إلى إعدادات Firestore'),
      projectId,
      databaseId,
      userEmail,
      emailVerified,
    };
  }
}

export async function saveCustomFontToFirestore(
  font: CustomFontRecord,
  uid: string
): Promise<void> {
  const activeDb = getActiveDatabase();
  const slot: CustomFontSlot = font.id === 'english' ? 'english' : 'arabic';
  const path = `fonts/${slot}`;
  try {
    await setDoc(doc(activeDb, 'fonts', slot), {
      id: slot,
      family: String(font.family || `RahaLCustom_${slot}`).trim().slice(0, 80),
      fileName: String(font.fileName || 'custom-font').trim().slice(0, 160),
      format: font.format,
      sourceUrl: String(font.sourceUrl || '').trim().slice(0, 950000),
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteCustomFontFromFirestore(slot: CustomFontSlot): Promise<void> {
  const activeDb = getActiveDatabase();
  const cleanSlot: CustomFontSlot = slot === 'english' ? 'english' : 'arabic';
  const path = `fonts/${cleanSlot}`;
  try {
    await deleteDoc(doc(activeDb, 'fonts', cleanSlot));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function grantAdminRoleInFirestore(
  targetUid: string,
  displayName: string,
  addedByUid: string,
  role: AdminPrivilegeRole = 'moderator'
) {
  const activeDb = getActiveDatabase();
  const cleanUid = targetUid.trim().replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 128);
  const path = `admins/${cleanUid}`;
  try {
    await setDoc(doc(activeDb, 'admins', cleanUid), {
      uid: cleanUid,
      displayName: displayName.trim().slice(0, 120) || (role === 'owner' ? 'مسؤول RahaL TV' : 'مشرف RahaL TV'),
      addedBy: addedByUid,
      role,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function createAdminAccountInFirebase(
  identifier: string,
  password: string,
  displayName: string,
  addedByUid: string,
  role: AdminPrivilegeRole = 'moderator'
): Promise<{ uid: string; email: string; role: AdminPrivilegeRole }> {
  const email = normalizeAuthIdentifier(identifier);
  const cleanName =
    displayName.trim().slice(0, 120) ||
    email.split('@')[0] ||
    (role === 'owner' ? 'مسؤول RahaL TV' : 'مشرف RahaL TV');
  const activeCfg = getActiveFirebaseConfig();
  const secondaryApp = initializeApp(
    {
      apiKey: activeCfg.apiKey,
      authDomain: activeCfg.authDomain,
      projectId: activeCfg.projectId,
      appId: activeCfg.appId,
      ...(activeCfg.storageBucket ? { storageBucket: activeCfg.storageBucket } : {}),
      ...(activeCfg.messagingSenderId ? { messagingSenderId: activeCfg.messagingSenderId } : {}),
    },
    `admin-creator-${Date.now()}`
  );
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await updateProfile(cred.user, { displayName: cleanName });
    await grantAdminRoleInFirestore(cred.user.uid, cleanName, addedByUid, role);
    await signOut(secondaryAuth);
    return { uid: cred.user.uid, email, role };
  } finally {
    await deleteApp(secondaryApp).catch(() => undefined);
  }
}

export async function updateAdminRoleInFirestore(
  targetUid: string,
  role: AdminPrivilegeRole
) {
  const activeDb = getActiveDatabase();
  const cleanUid = targetUid.trim().replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 128);
  const path = `admins/${cleanUid}`;
  try {
    await updateDoc(doc(activeDb, 'admins', cleanUid), { role });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function revokeAdminRoleFromFirestore(targetUid: string) {
  const activeDb = getActiveDatabase();
  const path = `admins/${targetUid}`;
  try {
    await deleteDoc(doc(activeDb, 'admins', targetUid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function sanitizeRatingMediaId(mediaId: string): string {
  return (
    String(mediaId || '')
      .trim()
      .replace(/[^a-zA-Z0-9_\-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 128) || 'media-item'
  );
}

export async function submitMediaRatingToFirestore(
  mediaId: string,
  uid: string,
  stars: number
): Promise<number> {
  const activeDb = getActiveDatabase();
  const cleanMediaId = sanitizeRatingMediaId(mediaId);
  const cleanUid = String(uid || '').trim().replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 128);
  const ratingId = `${cleanMediaId}__${cleanUid}`;
  const path = `ratings/${ratingId}`;
  const safeStars = Math.min(5, Math.max(1, Math.round(Number(stars) || 5)));

  try {
    const ratingRef = doc(activeDb, 'ratings', ratingId);
    const snap = await getDoc(ratingRef);
    if (snap.exists()) {
      await updateDoc(ratingRef, {
        stars: safeStars,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ratingRef, {
        id: ratingId,
        mediaId: cleanMediaId,
        userId: cleanUid,
        stars: safeStars,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return safeStars;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteMediaRatingFromFirestore(mediaId: string, uid: string) {
  const activeDb = getActiveDatabase();
  const cleanMediaId = sanitizeRatingMediaId(mediaId);
  const cleanUid = String(uid || '').trim().replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 128);
  const ratingId = `${cleanMediaId}__${cleanUid}`;
  const path = `ratings/${ratingId}`;

  try {
    await deleteDoc(doc(activeDb, 'ratings', ratingId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// =========================================================================
// 1. Streaming Server Health Persistence (/server_health)
// =========================================================================

export function buildServerHealthId(url: string): string {
  const clean = String(url || '').trim();
  let hash = 2166136261;
  for (let i = 0; i < clean.length; i++) {
    hash ^= clean.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  let hostSlug = 'srv';
  try {
    hostSlug = new URL(clean).hostname
      .replace(/^www\./, '')
      .replace(/[^a-zA-Z0-9_\-]/g, '-')
      .slice(0, 48) || 'srv';
  } catch {
    hostSlug = 'srv';
  }
  return `sh_${hostSlug}_${hex}`.slice(0, 128);
}

function serializeServerHealthForFirestore(record: ServerHealthRecord, uid?: string) {
  const id = buildServerHealthId(record.url);
  let fallbackHost = record.host || 'unknown';
  try {
    if (!fallbackHost || fallbackHost === 'unknown') {
      fallbackHost = new URL(record.url).hostname.replace(/^www\./, '') || 'unknown';
    }
  } catch {
    // keep fallback
  }
  const payload: Record<string, unknown> = {
    id,
    url: String(record.url || '').slice(0, 700),
    host: String(fallbackHost).slice(0, 200),
    status: record.status,
    connectivityStatus: String(record.connectivityStatus || 'not_checked').slice(0, 80),
    httpStatus: Math.max(0, Math.min(999, Math.round(Number(record.httpStatus) || 0))),
    canEmbedInIframe: Boolean(record.canEmbedInIframe),
    pageLoadStatus: String(record.pageLoadStatus || 'not_checked').slice(0, 120),
    playerInitResult: String(record.playerInitResult || 'not_checked').slice(0, 120),
    triedModes: Array.isArray(record.triedModes) ? record.triedModes.slice(0, 8) : [],
    videoPlaybackConfirmed: Boolean(record.videoPlaybackConfirmed),
    latencyMs: Math.max(0, Math.round(Number(record.latencyMs) || 0)),
    lastFailureReason: String(record.lastFailureReason || '').slice(0, 400),
    lastCheckedAtMs: Math.max(0, Math.round(Number(record.lastCheckedAtMs) || Date.now())),
    ttlMs: Math.max(60_000, Math.round(Number(record.ttlMs) || 12 * 3600_000)),
    updatedAt: serverTimestamp(),
  };
  if (record.lastSuccessfulMode) {
    payload.lastSuccessfulMode = record.lastSuccessfulMode;
  }
  if (record.mediaId) payload.mediaId = String(record.mediaId).slice(0, 128);
  if (record.mediaTitle) payload.mediaTitle = String(record.mediaTitle).slice(0, 200);
  if (typeof record.seasonNumber === 'number') payload.seasonNumber = record.seasonNumber;
  if (typeof record.episodeNumber === 'number') payload.episodeNumber = record.episodeNumber;
  if (record.serverName) payload.serverName = String(record.serverName).slice(0, 80);
  if (uid || record.checkedBy) payload.checkedBy = String(uid || record.checkedBy).slice(0, 128);
  return { id, payload };
}

export async function saveServerHealthRecordToFirestore(
  record: ServerHealthRecord,
  uid?: string
): Promise<boolean> {
  const activeDb = getActiveDatabase();
  const { id, payload } = serializeServerHealthForFirestore(record, uid);
  try {
    await setDoc(doc(activeDb, 'server_health', id), payload, { merge: true });
    return true;
  } catch (err) {
    if (isPermissionDeniedError(err)) return false;
    reportClientError({
      source: 'firestore.server_health.save',
      level: 'warn',
      message: formatFirestoreWriteError(err, 'تعذر حفظ نتيجة فحص السيرفر'),
    });
    return false;
  }
}

export async function bulkSaveServerHealthRecordsToFirestore(
  records: ServerHealthRecord[],
  uid?: string
): Promise<number> {
  if (!records.length) return 0;
  const activeDb = getActiveDatabase();
  const CHUNK = 40;
  let saved = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK);
    try {
      const batch = writeBatch(activeDb);
      for (const rec of slice) {
        const { id, payload } = serializeServerHealthForFirestore(rec, uid);
        batch.set(doc(activeDb, 'server_health', id), payload, { merge: true });
      }
      await batch.commit();
      saved += slice.length;
    } catch (err) {
      if (isPermissionDeniedError(err)) return saved;
      break;
    }
  }
  return saved;
}

export function subscribeServerHealthRecords(
  callback: (byUrl: Record<string, ServerHealthRecord>) => void
): () => void {
  const activeDb = getActiveDatabase();
  try {
    const q = query(collection(activeDb, 'server_health'), limit(600));
    return onSnapshot(
      q,
      (snap) => {
        const map: Record<string, ServerHealthRecord> = {};
        snap.docs.forEach((d) => {
          const data = d.data() as ServerHealthRecord;
          if (data?.url) {
            map[data.url] = { ...data, id: d.id };
          }
        });
        callback(map);
      },
      () => {
        // Ignore unauthenticated/rules fallback gracefully
      }
    );
  } catch {
    return () => undefined;
  }
}

// =========================================================================
// 2. Household Sub-Profiles (/users/{uid}/profiles/{profileId})
// =========================================================================

export function subscribeUserSubProfiles(
  uid: string,
  callback: (profiles: UserSubProfile[]) => void
): () => void {
  const activeDb = getActiveDatabase();
  const cleanUid = String(uid || '').trim();
  if (!cleanUid) return () => undefined;
  try {
    const q = query(collection(activeDb, 'users', cleanUid, 'profiles'), limit(20));
    return onSnapshot(
      q,
      (snap) => {
        const items = snap.docs
          .map((d) => ({ ...(d.data() as UserSubProfile), id: d.id }))
          .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
        callback(items);
      },
      () => {
        // Ignore permission fallback gracefully
      }
    );
  } catch {
    return () => undefined;
  }
}

export async function saveUserSubProfileToFirestore(
  uid: string,
  profile: UserSubProfile
): Promise<boolean> {
  const activeDb = getActiveDatabase();
  const cleanUid = String(uid || '').trim();
  const cleanId = String(profile.id || '')
    .replace(/[^a-zA-Z0-9_\-]/g, '-')
    .slice(0, 128);
  if (!cleanUid || !cleanId) return false;

  const payload: Record<string, unknown> = {
    id: cleanId,
    userId: cleanUid,
    name: String(profile.name || 'ملف جديد').trim().slice(0, 60) || 'ملف جديد',
    avatarEmoji: String(profile.avatarEmoji || '🎬').slice(0, 16),
    avatarColor: String(profile.avatarColor || '#dc2626').slice(0, 20),
    isKids: Boolean(profile.isKids),
    maxAgeRating: profile.maxAgeRating || (profile.isKids ? 'kids' : 'all'),
    hasPin: Boolean(profile.hasPin),
    watchlistIds: Array.isArray(profile.watchlistIds) ? profile.watchlistIds.slice(0, 150) : [],
    createdAtMs: Number(profile.createdAtMs) || Date.now(),
    updatedAtMs: Number(profile.updatedAtMs) || Date.now(),
    updatedAt: serverTimestamp(),
  };
  if (profile.pinHash) payload.pinHash = String(profile.pinHash).slice(0, 128);
  if (profile.pinSalt) payload.pinSalt = String(profile.pinSalt).slice(0, 64);

  try {
    await setDoc(doc(activeDb, 'users', cleanUid, 'profiles', cleanId), payload);
    return true;
  } catch (err) {
    if (isPermissionDeniedError(err)) return false;
    reportClientError({
      source: 'firestore.profiles.save',
      level: 'warn',
      message: formatFirestoreWriteError(err, 'تعذر حفظ الملف الشخصي'),
    });
    return false;
  }
}

export async function deleteUserSubProfileFromFirestore(
  uid: string,
  profileId: string
): Promise<boolean> {
  const activeDb = getActiveDatabase();
  try {
    await deleteDoc(doc(activeDb, 'users', uid, 'profiles', profileId));
    return true;
  } catch {
    return false;
  }
}

// =========================================================================
// 3. Synchronized Watch Progress (/watch_progress/{progressId})
// =========================================================================

export function subscribeWatchProgress(
  uid: string,
  callback: (records: WatchProgressRecord[]) => void
): () => void {
  const activeDb = getActiveDatabase();
  if (!uid) return () => undefined;
  try {
    const q = query(
      collection(activeDb, 'watch_progress'),
      where('userId', '==', uid),
      limit(120)
    );
    return onSnapshot(
      q,
      (snap) => {
        const items = snap.docs
          .map((d) => ({ ...(d.data() as WatchProgressRecord), id: d.id }))
          .sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
        callback(items);
      },
      () => {
        // Ignore rules fallback
      }
    );
  } catch {
    return () => undefined;
  }
}

export async function saveWatchProgressToFirestore(
  record: WatchProgressRecord
): Promise<boolean> {
  const activeDb = getActiveDatabase();
  if (!record.userId || !record.mediaId || !record.id) return false;
  const payload: Record<string, unknown> = {
    id: record.id.slice(0, 380),
    userId: record.userId.slice(0, 128),
    profileId: (record.profileId || 'main').slice(0, 128),
    mediaId: sanitizeRatingMediaId(record.mediaId),
    mediaTitle: String(record.mediaTitle || '').trim().slice(0, 200) || 'عمل',
    kind: record.kind,
    positionSec: Math.max(0, Math.round(Number(record.positionSec) || 0)),
    durationSec: Math.max(0, Math.round(Number(record.durationSec) || 0)),
    progressPct: Math.max(0, Math.min(100, Math.round(Number(record.progressPct) || 0))),
    completed: Boolean(record.completed),
    updatedAtMs: Number(record.updatedAtMs) || Date.now(),
    updatedAt: serverTimestamp(),
  };
  if (typeof record.seasonNumber === 'number' && record.seasonNumber >= 1) {
    payload.seasonNumber = Math.round(record.seasonNumber);
  }
  if (typeof record.episodeNumber === 'number' && record.episodeNumber >= 1) {
    payload.episodeNumber = Math.round(record.episodeNumber);
  }
  if (typeof record.hiddenFromContinueWatching === 'boolean') {
    payload.hiddenFromContinueWatching = record.hiddenFromContinueWatching;
  }
  if (record.lastServerUrl) {
    payload.lastServerUrl = String(record.lastServerUrl).slice(0, 700);
  }
  try {
    await setDoc(doc(activeDb, 'watch_progress', record.id), payload);
    return true;
  } catch {
    return false;
  }
}

export async function deleteWatchProgressFromFirestore(progressId: string): Promise<boolean> {
  const activeDb = getActiveDatabase();
  try {
    await deleteDoc(doc(activeDb, 'watch_progress', progressId));
    return true;
  } catch {
    return false;
  }
}

// =========================================================================
// 4. Community Reviews (1-10) & Moderation (/reviews & /review_reports)
// =========================================================================

export function subscribeMediaReviews(
  mediaId: string | null,
  callback: (reviews: MediaReviewRecord[]) => void
): () => void {
  const activeDb = getActiveDatabase();
  try {
    const colRef = collection(activeDb, 'reviews');
    const q = mediaId
      ? query(colRef, where('mediaId', '==', sanitizeRatingMediaId(mediaId)), limit(200))
      : query(colRef, limit(500));
    return onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({
          ...(d.data() as MediaReviewRecord),
          id: d.id,
        }));
        callback(items);
      },
      () => {
        // Ignore rules fallback
      }
    );
  } catch {
    return () => undefined;
  }
}

export async function saveMediaReviewToFirestore(
  review: Omit<MediaReviewRecord, 'id' | 'helpfulUids' | 'helpfulCount' | 'reportedCount' | 'createdAtMs' | 'updatedAtMs'>
): Promise<MediaReviewRecord> {
  const activeDb = getActiveDatabase();
  const cleanMediaId = sanitizeRatingMediaId(review.mediaId);
  const cleanUid = String(review.userId || '').trim().replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 128);
  const reviewId = `${cleanMediaId}__${cleanUid}`;
  const path = `reviews/${reviewId}`;
  const safeRating10 = Math.min(10, Math.max(1, Math.round(Number(review.rating10) || 8)));
  const cleanComment = String(review.comment || '').trim().slice(0, 1500);
  const cleanAuthor = String(review.authorName || 'عضو RahaL TV').trim().slice(0, 120) || 'عضو RahaL TV';
  const nowMs = Date.now();

  try {
    const ref = doc(activeDb, 'reviews', reviewId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const existing = snap.data() as MediaReviewRecord;
      await updateDoc(ref, {
        rating10: safeRating10,
        comment: cleanComment,
        authorName: cleanAuthor,
        ...(review.authorPhoto ? { authorPhoto: String(review.authorPhoto).slice(0, 500) } : {}),
        updatedAtMs: nowMs,
        updatedAt: serverTimestamp(),
      });
      return {
        ...existing,
        id: reviewId,
        rating10: safeRating10,
        comment: cleanComment,
        authorName: cleanAuthor,
        updatedAtMs: nowMs,
      };
    }

    const created: MediaReviewRecord = {
      id: reviewId,
      mediaId: cleanMediaId,
      userId: cleanUid,
      ...(review.profileId ? { profileId: review.profileId } : {}),
      authorName: cleanAuthor,
      ...(review.authorPhoto ? { authorPhoto: String(review.authorPhoto).slice(0, 500) } : {}),
      rating10: safeRating10,
      comment: cleanComment,
      helpfulUids: [],
      helpfulCount: 0,
      reportedCount: 0,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    };

    await setDoc(ref, {
      ...created,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return created;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function toggleReviewHelpfulInFirestore(
  review: MediaReviewRecord,
  uid: string
): Promise<boolean> {
  const activeDb = getActiveDatabase();
  const cleanUid = String(uid || '').trim();
  if (!cleanUid || !review.id) return false;
  const alreadyHelpful = (review.helpfulUids || []).includes(cleanUid);
  const nextCount = Math.max(0, (review.helpfulUids?.length || review.helpfulCount || 0) + (alreadyHelpful ? -1 : 1));
  try {
    await updateDoc(doc(activeDb, 'reviews', review.id), {
      helpfulUids: alreadyHelpful ? arrayRemove(cleanUid) : arrayUnion(cleanUid),
      helpfulCount: nextCount,
      updatedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch {
    return false;
  }
}

export async function deleteMediaReviewFromFirestore(reviewId: string): Promise<void> {
  const activeDb = getActiveDatabase();
  try {
    await deleteDoc(doc(activeDb, 'reviews', reviewId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `reviews/${reviewId}`);
  }
}

export async function reportMediaReviewInFirestore(
  review: MediaReviewRecord,
  reporterUid: string,
  reason: string
): Promise<boolean> {
  const activeDb = getActiveDatabase();
  const cleanUid = String(reporterUid || '').trim().replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 128);
  const reportId = `${review.id}__${cleanUid}`;
  const cleanReason = String(reason || 'محتوى غير مناسب').trim().slice(0, 300) || 'محتوى غير مناسب';
  try {
    await setDoc(doc(activeDb, 'review_reports', reportId), {
      id: reportId,
      reviewId: review.id,
      mediaId: review.mediaId,
      reporterUid: cleanUid,
      reason: cleanReason,
      status: 'pending',
      createdAtMs: Date.now(),
      createdAt: serverTimestamp(),
    } as Record<string, unknown>);
    await updateDoc(doc(activeDb, 'reviews', review.id), {
      reportedCount: (review.reportedCount || 0) + 1,
      updatedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export function subscribeReviewReports(
  callback: (reports: ReviewReportRecord[]) => void
): () => void {
  const activeDb = getActiveDatabase();
  try {
    const q = query(collection(activeDb, 'review_reports'), limit(150));
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ ...(d.data() as ReviewReportRecord), id: d.id }))
          .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
        callback(list);
      },
      () => undefined
    );
  } catch {
    return () => undefined;
  }
}

// =========================================================================
// 5. Notification Center (/notifications)
// =========================================================================

export function subscribeNotifications(
  uid: string | null,
  isStaff: boolean,
  callback: (list: UserNotificationRecord[]) => void
): () => void {
  const activeDb = getActiveDatabase();
  try {
    const colRef = collection(activeDb, 'notifications');
    const q = isStaff
      ? query(colRef, orderBy('createdAt', 'desc'), limit(60))
      : uid
        ? query(colRef, where('targetUid', 'in', ['all', uid]), limit(60))
        : query(colRef, where('targetUid', '==', 'all'), limit(40));

    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ ...(d.data() as UserNotificationRecord), id: d.id }))
          .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
        callback(list);
      },
      () => {
        // Ignore rules fallback
      }
    );
  } catch {
    return () => undefined;
  }
}

export async function createNotificationInFirestore(
  input: {
    targetUid?: string;
    category: NotificationCategory;
    title: string;
    body: string;
    mediaId?: string;
    seasonNumber?: number;
    episodeNumber?: number;
  },
  createdByUid: string
): Promise<UserNotificationRecord | null> {
  const activeDb = getActiveDatabase();
  const id = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const createdAtMs = Date.now();
  const record: UserNotificationRecord = {
    id,
    targetUid: (input.targetUid || 'all').slice(0, 128),
    category: input.category,
    title: String(input.title || '').trim().slice(0, 160),
    body: String(input.body || '').trim().slice(0, 500),
    ...(input.mediaId ? { mediaId: sanitizeRatingMediaId(input.mediaId) } : {}),
    ...(typeof input.seasonNumber === 'number' ? { seasonNumber: input.seasonNumber } : {}),
    ...(typeof input.episodeNumber === 'number' ? { episodeNumber: input.episodeNumber } : {}),
    readByUids: [],
    createdBy: createdByUid.slice(0, 128),
    createdAtMs,
  };
  try {
    await setDoc(doc(activeDb, 'notifications', id), {
      ...record,
      createdAt: serverTimestamp(),
    });
    return record;
  } catch {
    return null;
  }
}

export async function markNotificationReadInFirestore(
  notifId: string,
  uid: string
): Promise<boolean> {
  const activeDb = getActiveDatabase();
  try {
    await updateDoc(doc(activeDb, 'notifications', notifId), {
      readByUids: arrayUnion(uid),
    });
    return true;
  } catch {
    return false;
  }
}

export async function deleteNotificationFromFirestore(notifId: string): Promise<boolean> {
  const activeDb = getActiveDatabase();
  try {
    await deleteDoc(doc(activeDb, 'notifications', notifId));
    return true;
  } catch {
    return false;
  }
}

// =========================================================================
// 6. Real Analytics Daily Aggregation (/analytics_daily/{dayKey})
// =========================================================================

export async function recordAnalyticsEventInFirestore(
  dayKey: string,
  event: {
    kind: 'playback_start' | 'playback_complete' | 'watchlist_add';
    mediaId: string;
    episodeKey?: string;
    genres?: string[];
  }
): Promise<boolean> {
  const activeDb = getActiveDatabase();
  const cleanDay = /^\d{4}-\d{2}-\d{2}$/.test(dayKey)
    ? dayKey
    : new Date().toISOString().slice(0, 10);
  const ref = doc(activeDb, 'analytics_daily', cleanDay);
  try {
    const snap = await getDoc(ref);
    const prev: AnalyticsDailyRecord = snap.exists()
      ? (snap.data() as AnalyticsDailyRecord)
      : {
          id: cleanDay,
          playbackStarts: 0,
          playbackCompletes: 0,
          watchlistAdds: 0,
          mediaCounts: {},
          episodeCounts: {},
          genreCounts: {},
          updatedAtMs: Date.now(),
        };

    const mediaCounts = { ...(prev.mediaCounts || {}) };
    const episodeCounts = { ...(prev.episodeCounts || {}) };
    const genreCounts = { ...(prev.genreCounts || {}) };
    const cleanMedia = sanitizeRatingMediaId(event.mediaId);

    if (event.kind === 'playback_start') {
      mediaCounts[cleanMedia] = (mediaCounts[cleanMedia] || 0) + 1;
      if (event.episodeKey) {
        episodeCounts[event.episodeKey] = (episodeCounts[event.episodeKey] || 0) + 1;
      }
      for (const g of (event.genres || []).slice(0, 4)) {
        const cleanGenre = String(g || '').trim().slice(0, 60);
        if (cleanGenre) genreCounts[cleanGenre] = (genreCounts[cleanGenre] || 0) + 1;
      }
    }

    await setDoc(ref, {
      id: cleanDay,
      playbackStarts: prev.playbackStarts + (event.kind === 'playback_start' ? 1 : 0),
      playbackCompletes: prev.playbackCompletes + (event.kind === 'playback_complete' ? 1 : 0),
      watchlistAdds: prev.watchlistAdds + (event.kind === 'watchlist_add' ? 1 : 0),
      mediaCounts,
      episodeCounts,
      genreCounts,
      updatedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch {
    return false;
  }
}

export async function fetchAnalyticsDailyRange(
  daysBack = 30
): Promise<AnalyticsDailyRecord[]> {
  const activeDb = getActiveDatabase();
  try {
    const snap = await getDocs(query(collection(activeDb, 'analytics_daily'), limit(daysBack)));
    return snap.docs
      .map((d) => ({ ...(d.data() as AnalyticsDailyRecord), id: d.id }))
      .sort((a, b) => b.id.localeCompare(a.id));
  } catch {
    return [];
  }
}

export type { Timestamp };

