import { deleteApp, initializeApp } from 'firebase/app';
import {
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
  getDoc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import fallbackBackdropImg from '../assets/images/hero_scifi_backdrop_1794813333496.jpg';
import fallbackPosterImg from '../assets/images/poster_running_man_1794813333683.jpg';
import {
  MediaItem,
  RequestStatus,
  SiteSettings,
  StreamServer,
  VisitorRequest,
} from '../types/media';
import { isLikelyNonVideoWebsiteUrl } from './clientScraper';
import {
  buildDedicatedMediaUrl,
  generateCleanSlug,
  isDedicatedAppShortUrl,
} from './permalink';
import { DEFAULT_PLAYER_THEME, saveStoredPlayerTheme } from './playerTheme';
import { DEFAULT_HOME_CONFIG, saveStoredHomeConfig } from './homeConfig';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const PRIMARY_ADMIN_EMAILS = [
  'rahalahmed348@gmail.com',
  'mfeshmeny2@gmail.com',
  'ccicada6@gmail.com',
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
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Mandatory boot connection check
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

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
  return signInWithEmailAndPassword(auth, email, password);
}

export async function registerMemberWithEmailPassword(
  identifier: string,
  password: string,
  displayName: string
) {
  const email = normalizeAuthIdentifier(identifier);
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName.trim()) {
    await updateProfile(cred.user, { displayName: displayName.trim().slice(0, 120) });
  }
  return cred;
}

export async function resendVerificationEmail(user: User) {
  return sendEmailVerification(user);
}

export async function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export async function signOutFirebase() {
  return signOut(auth);
}

export async function checkIsAdminUser(user: User | null): Promise<boolean> {
  if (!user) return false;
  const email = user.email?.toLowerCase() || '';
  if (user.emailVerified && PRIMARY_ADMIN_EMAILS.some((e) => e.toLowerCase() === email)) {
    return true;
  }
  try {
    const adminDoc = await getDoc(doc(db, 'admins', user.uid));
    return adminDoc.exists();
  } catch {
    return false;
  }
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
      const cleanQuality = String(srv.quality || fallbackQuality || '1080p').trim().slice(0, 40) || '1080p';
      return {
        id: String(srv.id || `${idPrefix}-${Date.now()}-${idx + 1}`).slice(0, 80),
        name: `سيرفر ${idx + 1}`,
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
    item.id.replace(/[^a-zA-Z0-9_\-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 128) ||
    `media-${Date.now()}`;
  const safeTitle = (item.title || 'عمل مستورد').trim().slice(0, 200) || 'عمل مستورد';
  const safeEnglishTitle = (item.englishTitle || safeTitle).trim().slice(0, 200) || safeTitle;
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
    ? item.shortUrl.trim().slice(0, 300)
    : buildDedicatedMediaUrl({ id: cleanId, slug: safeSlug }).slice(0, 300);

  const safePoster = (item.poster || '').trim().slice(0, 500) || FALLBACK_POSTER_URL;
  const safeBackdrop = (item.backdrop || safePoster || '').trim().slice(0, 500) || FALLBACK_BACKDROP_URL;
  const safeYear = (item.year || '2026').trim().slice(0, 10);
  const normalizedYear = safeYear.length >= 4 ? safeYear : '2026';

  const normalizedCategories = (item.categories || [])
    .map((c) => String(c || '').trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 10);
  const normalizedGenres = (item.genres || [])
    .map((g) => String(g || '').trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 10);

  let normalizedServers = sanitizeServerList(item.servers, item.quality || '1080p', 15, 'srv');

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
    year: String(season.year || normalizedYear).trim().slice(0, 10),
    episodes: (season.episodes || []).slice(0, 120).map((ep, eIdx) => {
      const epNum = Number(ep.number) || eIdx + 1;
      const epQual = String(ep.quality || item.quality || 'WEB-DL').trim().slice(0, 40);
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
        title: String(ep.title || `الحلقة ${epNum}`).trim().slice(0, 120),
        duration: String(ep.duration || '45 دقيقة').trim().slice(0, 40),
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
        name: `سيرفر ${idx + 1}`,
      }));
    }
  }

  const base: Record<string, unknown> = {
    id: cleanId,
    slug: safeSlug,
    title: safeTitle,
    englishTitle: safeEnglishTitle,
    kind: item.kind || 'movie',
    categories: normalizedCategories.length ? normalizedCategories : ['افلام'],
    genres: normalizedGenres.length ? normalizedGenres : ['دراما'],
    year: normalizedYear,
    country: (item.country || 'الولايات المتحدة').trim().slice(0, 80) || 'الولايات المتحدة',
    language: (item.language || 'الانجليزية').trim().slice(0, 80) || 'الانجليزية',
    quality: (item.quality || 'WEB-DL').trim().slice(0, 40) || 'WEB-DL',
    duration: (item.duration || '120 دقيقة').trim().slice(0, 40) || '120 دقيقة',
    imdb: Math.min(10, Math.max(0, Number(item.imdb) || 7.5)),
    votes: (item.votes || '1,000').trim().slice(0, 40) || '1,000',
    views: Math.max(0, Math.round(Number(item.views) || 0)),
    likes: Math.max(0, Math.round(Number(item.likes) || 0)),
    pinned: Boolean(item.pinned),
    isNew: Boolean(item.isNew),
    comingSoon: Boolean(item.comingSoon),
    poster: safePoster,
    backdrop: safeBackdrop,
    tagline: (item.tagline || '').slice(0, 400),
    story: (item.story || safeTitle).trim().slice(0, 3000) || safeTitle,
    shortUrl: dedicatedShortUrl,
    trailerUrl: (item.trailerUrl || '').slice(0, 500),
    trailerLabel: (item.trailerLabel || safeTitle).slice(0, 200),
    trailerDuration: (item.trailerDuration || '02:00').slice(0, 30),
    cast: normalizedCast,
    seasons: normalizedSeasons,
    franchiseIds: (item.franchiseIds || []).map((f) => String(f)).slice(0, 15),
    servers: normalizedServers,
    downloads: normalizedDownloads,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  };

  if (isCreate) {
    base.createdAt = serverTimestamp();
  }
  return { cleanId, payload: base };
}

export async function seedCatalogToFirestore(items: MediaItem[], uid: string) {
  const path = 'media';
  try {
    const batch = writeBatch(db);
    for (const item of items) {
      const { cleanId, payload } = sanitizeMediaPayload(item, uid, true);
      batch.set(doc(db, 'media', cleanId), payload);
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function bulkSaveMediaToFirestore(items: MediaItem[], uid: string): Promise<number> {
  const path = 'media';
  const CHUNK_SIZE = 35;
  let savedCount = 0;
  try {
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const item of chunk) {
        const { cleanId, payload } = sanitizeMediaPayload(item, uid, true);
        batch.set(doc(db, 'media', cleanId), payload);
      }
      await batch.commit();
      savedCount += chunk.length;
    }
    return savedCount;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveMediaToFirestore(
  item: MediaItem,
  uid: string,
  isCreate: boolean
) {
  const { cleanId, payload } = sanitizeMediaPayload(item, uid, isCreate);
  const path = `media/${cleanId}`;
  try {
    if (isCreate) {
      await setDoc(doc(db, 'media', cleanId), payload);
    } else {
      await updateDoc(doc(db, 'media', cleanId), payload);
    }
  } catch (error) {
    handleFirestoreError(error, isCreate ? OperationType.CREATE : OperationType.UPDATE, path);
  }
}

export async function deleteMediaFromFirestore(mediaId: string) {
  const path = `media/${mediaId}`;
  try {
    await deleteDoc(doc(db, 'media', mediaId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function bulkDeleteMediaFromFirestore(mediaIds: string[]): Promise<number> {
  const path = 'media';
  const CHUNK_SIZE = 400;
  let deletedCount = 0;
  try {
    const validIds = mediaIds
      .map((id) => String(id || '').trim())
      .filter((id) => /^[a-zA-Z0-9_\-]+$/.test(id));
    for (let i = 0; i < validIds.length; i += CHUNK_SIZE) {
      const chunk = validIds.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const id of chunk) {
        batch.delete(doc(db, 'media', id));
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
  const id = `req_${Date.now()}`;
  const path = `requests/${id}`;
  try {
    await setDoc(doc(db, 'requests', id), {
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
  const path = `requests/${requestId}`;
  try {
    await updateDoc(doc(db, 'requests', requestId), {
      status,
      adminNote: adminNote.trim().slice(0, 500),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteVisitorRequestFromFirestore(requestId: string) {
  const path = `requests/${requestId}`;
  try {
    await deleteDoc(doc(db, 'requests', requestId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function syncUserProfileToFirestore(
  user: User,
  localWatchlist: string[],
  isAdminUser: boolean
): Promise<string[]> {
  const userPath = `users/${user.uid}`;
  const privatePath = `users/${user.uid}/private/info`;
  try {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);

    if (user.email) {
      await setDoc(
        doc(db, 'users', user.uid, 'private', 'info'),
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
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      watchlistIds: watchlistIds.slice(0, 100),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function saveSiteSettingsToFirestore(
  settings: SiteSettings,
  uid: string
): Promise<{ syncedHomeToCloud: boolean }> {
  const path = 'settings/general';
  const normalizedTheme = saveStoredPlayerTheme(settings.playerTheme || DEFAULT_PLAYER_THEME);
  const normalizedHome = saveStoredHomeConfig(settings.homeConfig || DEFAULT_HOME_CONFIG);
  const corePayload = {
    siteName: settings.siteName.trim().slice(0, 80) || 'RahaL TV',
    tagline: settings.tagline.trim().slice(0, 300) || 'منصة RahaL TV الترفيهية',
    announcementText: settings.announcementText.trim().slice(0, 300),
    tickerEnabled: Boolean(settings.tickerEnabled),
    featuredLimit: Math.min(20, Math.max(1, Number(settings.featuredLimit) || 5)),
    maintenanceMode: Boolean(settings.maintenanceMode),
    maintenanceMessage: (settings.maintenanceMessage || '').trim().slice(0, 500),
    playerTheme: normalizedTheme,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'settings', 'general'), {
      ...corePayload,
      homeConfig: normalizedHome,
    });
    return { syncedHomeToCloud: true };
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code || '')
        : '';
    if (code === 'permission-denied') {
      try {
        await setDoc(doc(db, 'settings', 'general'), corePayload);
        return { syncedHomeToCloud: false };
      } catch (innerErr) {
        handleFirestoreError(innerErr, OperationType.WRITE, path);
      }
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function grantAdminRoleInFirestore(
  targetUid: string,
  displayName: string,
  addedByUid: string
) {
  const cleanUid = targetUid.trim().replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 128);
  const path = `admins/${cleanUid}`;
  try {
    await setDoc(doc(db, 'admins', cleanUid), {
      uid: cleanUid,
      displayName: displayName.trim().slice(0, 120) || 'مشرف RahaL TV',
      addedBy: addedByUid,
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
  addedByUid: string
): Promise<{ uid: string; email: string }> {
  const email = normalizeAuthIdentifier(identifier);
  const cleanName = displayName.trim().slice(0, 120) || email.split('@')[0] || 'مشرف RahaL TV';
  const secondaryApp = initializeApp(firebaseConfig, `admin-creator-${Date.now()}`);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await updateProfile(cred.user, { displayName: cleanName });
    await grantAdminRoleInFirestore(cred.user.uid, cleanName, addedByUid);
    await signOut(secondaryAuth);
    return { uid: cred.user.uid, email };
  } finally {
    await deleteApp(secondaryApp).catch(() => undefined);
  }
}

export async function revokeAdminRoleFromFirestore(targetUid: string) {
  const path = `admins/${targetUid}`;
  try {
    await deleteDoc(doc(db, 'admins', targetUid));
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
  const cleanMediaId = sanitizeRatingMediaId(mediaId);
  const cleanUid = String(uid || '').trim().replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 128);
  const ratingId = `${cleanMediaId}__${cleanUid}`;
  const path = `ratings/${ratingId}`;
  const safeStars = Math.min(5, Math.max(1, Math.round(Number(stars) || 5)));

  try {
    const ratingRef = doc(db, 'ratings', ratingId);
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
  const cleanMediaId = sanitizeRatingMediaId(mediaId);
  const cleanUid = String(uid || '').trim().replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 128);
  const ratingId = `${cleanMediaId}__${cleanUid}`;
  const path = `ratings/${ratingId}`;

  try {
    await deleteDoc(doc(db, 'ratings', ratingId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
