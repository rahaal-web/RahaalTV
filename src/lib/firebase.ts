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
  collection,
  deleteDoc,
  doc,
  Firestore,
  getDoc,
  getDocFromServer,
  serverTimestamp,
  setDoc,
  updateDoc,
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
  CustomFontRecord,
  CustomFontSlot,
  MediaItem,
  RequestStatus,
  SiteSettings,
  StreamServer,
  VisitorRequest,
} from '../types/media';
import { reportClientError } from './clientLogger';
import { isLikelyNonVideoWebsiteUrl } from './clientScraper';
import {
  buildDedicatedMediaUrl,
  generateCleanSlug,
  isDedicatedAppShortUrl,
} from './permalink';
import { DEFAULT_PLAYER_THEME, saveStoredPlayerTheme } from './playerTheme';
import { DEFAULT_HOME_CONFIG, saveStoredHomeConfig } from './homeConfig';
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
  const safeImdb = Number.isFinite(parsedImdb) ? Math.min(10, Math.max(0, parsedImdb || 7.5)) : 7.5;

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
    votes: String(item.votes || '1,000').trim().slice(0, 40) || '1,000',
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

  if (isCreate) {
    base.createdAt = serverTimestamp();
  }
  return { cleanId, payload: base };
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

    // Tier 2: try without branding
    try {
      await setDoc(doc(activeDb, 'settings', 'general'), extendedPayloadWithoutBranding);
      reportClientError({
        source: 'firestore.settings.partial_sync',
        level: 'warn',
        message: `Settings write rejected branding on ${projectId}/${databaseId} (permission-denied); homeConfig/typography/popupShield synced.`,
      });
      return {
        syncedHomeToCloud: true,
        syncedTypographyToCloud: true,
        syncedPopupShieldToCloud: true,
        syncedBrandingToCloud: false,
        rejectedSections: ['branding'],
        projectId,
        databaseId,
      };
    } catch (midErr) {
      if (!isPermissionDeniedError(midErr)) {
        handleFirestoreError(midErr, OperationType.WRITE, path);
      }
    }

    // Tier 3: probe each optional section independently so one rejected block (e.g. homeConfig)
    // does not prevent other allowed sections (e.g. typography or popupShield) from syncing.
    const docRef = doc(activeDb, 'settings', 'general');
    const acceptedPayload: Record<string, unknown> = { ...corePayload };
    const statusMap: Record<SettingsOptionalSection, boolean> = {
      typography: false,
      popupShield: false,
      homeConfig: false,
      branding: false,
    };
    const optionalEntries: Array<{
      key: SettingsOptionalSection;
      value: unknown;
    }> = [
      { key: 'typography', value: normalizedTypography },
      { key: 'popupShield', value: normalizedShield },
      { key: 'homeConfig', value: normalizedHome },
      { key: 'branding', value: firestoreBranding },
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

    reportClientError({
      source: 'firestore.settings.partial_sync',
      level: 'warn',
      message: `Firestore rules on ${projectId}/${databaseId} rejected sections: [${rejectedSections.join(', ')}].`,
    });

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

export async function diagnoseFirestoreSettingsRules(
  settings: SiteSettings,
  uid: string
): Promise<
  | {
      ok: true;
      result: SaveSiteSettingsResult;
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
    }
> {
  const activeCfg = getActiveFirebaseConfig();
  const currentUser = getActiveAuth().currentUser;
  const userEmail = currentUser?.email ?? null;
  const emailVerified = Boolean(currentUser?.emailVerified);
  try {
    const result = await saveSiteSettingsToFirestore(settings, uid);
    return { ok: true, result, userEmail, emailVerified };
  } catch (err) {
    return {
      ok: false,
      errorMessage: formatFirestoreWriteError(err, 'تعذر الكتابة إلى إعدادات Firestore'),
      projectId: activeCfg.projectId,
      databaseId: activeCfg.firestoreDatabaseId || '(default)',
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
