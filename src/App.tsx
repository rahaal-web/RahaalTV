import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Wrench, X } from 'lucide-react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import type { AdminTab } from './components/AdminDashboardView';
import { isTabAccessible } from './components/admin/adminNavigation';
import { CatalogArchiveView } from './components/CatalogArchiveView';
import { Footer, FooterTopic } from './components/Footer';
import { Header } from './components/Header';
import { HomeView } from './components/HomeView';

const AdminDashboardView = lazy(() =>
  import('./components/AdminDashboardView').then((m) => ({
    default: m.AdminDashboardView,
  }))
);
import { MaintenanceScreen } from './components/MaintenanceScreen';
import {
  FooterInfoModal,
  LoginModal,
  PlayerModal,
  TrailerModal,
  WatchlistModal,
} from './components/Modals';
import { SearchDrawer } from './components/SearchDrawer';
import { OfflineIndicator } from './components/PWAControls';
import { SingleDetailView } from './components/SingleDetailView';
import { CATALOG_ITEMS } from './data/catalog';
import { loadStoredHomeConfig, saveStoredHomeConfig } from './lib/homeConfig';
import { FALLBACK_BACKDROP, FALLBACK_POSTER, resolveMediaAssetUrl } from './lib/mediaFilters';
import { loadStoredPlayerTheme, saveStoredPlayerTheme } from './lib/playerTheme';
import {
  applyTypographyToDocument,
  loadStoredCustomFonts,
  loadStoredTypographyConfig,
  saveStoredCustomFonts,
  saveStoredTypographyConfig,
} from './lib/typographyConfig';
import {
  installGlobalPopupShieldGuards,
  loadStoredPopupShieldConfig,
  saveStoredPopupShieldConfig,
  setLiveShieldConfig,
} from './lib/popupShield';
import {
  findMediaByRouteKey,
  getAppBasePrefix,
  readWatchRouteFromLocation,
} from './lib/permalink';
import {
  applyDisplayDevicePrefs,
  detectClientCapabilities,
  loadDisplayDevicePrefs,
} from './lib/browserCompat';
import { loadAdminWorkspacePrefs } from './lib/adminPreferences';
import { installTvSpatialNavigation } from './lib/tvNavigation';
import {
  appendDatabaseConnectionLog,
  getActiveConnectionProfile,
  loadDatabaseRegistry,
  recordDatabaseConnected,
  recordDatabaseOutage,
  subscribeActiveDatabaseChange,
} from './lib/dbConnectionManager';
import {
  loadStoredMasterAdminSession,
  logoutMasterAdmin,
  MasterAdminSession,
  subscribeMasterAdminSession,
  validateMasterAdminSession,
} from './lib/masterAdminAuth';
import {
  classifyFirestoreConnectionError,
  FirestoreConnectionStatus,
  getActiveAuth,
  getActiveDatabase,
  getUserAdminRole,
  handleFirestoreError,
  OperationType,
  probeDatabaseConnection,
  sanitizeRatingMediaId,
  saveSiteSettingsToFirestore,
  saveWatchlistToFirestore,
  signOutFirebase,
  submitVisitorRequestToFirestore,
  syncUserProfileToFirestore,
} from './lib/firebase';
import {
  AdminPrivilegeRole,
  AdminRoleRecord,
  CatalogFilterState,
  CustomFontRecord,
  CustomFontSlot,
  MediaItem,
  PopupShieldHostRule,
  SiteSettings,
  UserProfileRecord,
  VisitorRequest,
} from './types/media';

const DEFAULT_FILTERS: CatalogFilterState = {
  query: '',
  category: '',
  genre: '',
  year: '',
  country: '',
  language: '',
  quality: '',
  minImdb: 0,
  preset: '',
};

const DEFAULT_SETTINGS: SiteSettings = {
  siteName: 'RahaL TV',
  tagline:
    'افلام ومسلسلات بجودة عالية بدون تقطيع ، تحميل ومشاهدة افلام اجنبية بروابط مباشرة ، مسلسلات اجنبية ، مسلسلات رمضان 2026 وعروض المصارعة الحرة المترجمة.',
  announcementText: '',
  tickerEnabled: false,
  featuredLimit: 5,
  maintenanceMode: false,
  maintenanceMessage:
    'نقوم حاليًا بإجراء أعمال صيانة وتحديثات تقنية لتحسين جودة السيرفرات وتجربة المشاهدة. سنعود للعمل قريبًا، شكرًا لتفهمكم.',
  playerTheme: loadStoredPlayerTheme(),
  homeConfig: loadStoredHomeConfig(),
  typography: loadStoredTypographyConfig(),
  popupShield: loadStoredPopupShieldConfig(),
};

const STORAGE_WATCHLIST = 'moov_watchlist_ids';
const STORAGE_DISMISSED_STARTERS = 'rahaltv_dismissed_starters';
const STORAGE_STARTER_CLEARED = 'rahaltv_starter_cleared';

const isAdminPath = () => {
  if (typeof window === 'undefined') return false;
  const { pathname, hash } = window.location;
  if (hash.startsWith('#/admin')) return true;
  const basePrefix = getAppBasePrefix();
  const normalizedPath = pathname.replace(/\/+$/, '');
  return normalizedPath === '/admin' || normalizedPath === `${basePrefix}/admin`;
};

export default function App() {
  const [view, setView] = useState<'home' | 'archive' | 'single' | 'admin'>(() => {
    if (isAdminPath()) return 'admin';
    if (readWatchRouteFromLocation().watchKey) return 'single';
    return 'home';
  });
  const [selectedMediaId, setSelectedMediaId] = useState<string>(CATALOG_ITEMS[0].id);
  const [routeEpisode, setRouteEpisode] = useState<number | undefined>(() => {
    return readWatchRouteFromLocation().episode || undefined;
  });
  const [openDownloadsOnSingle, setOpenDownloadsOnSingle] = useState(false);
  const [filters, setFilters] = useState<CatalogFilterState>(DEFAULT_FILTERS);

  const [searchOpen, setSearchOpen] = useState(false);
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [trailerItem, setTrailerItem] = useState<MediaItem | null>(null);
  const [playerState, setPlayerState] = useState<{
    item: MediaItem;
    episode: number;
    serverIndex?: number;
  } | null>(null);
  const [footerTopic, setFooterTopic] = useState<FooterTopic | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const clientCapabilities = useMemo(() => detectClientCapabilities(), []);
  const [compatBannerDismissed, setCompatBannerDismissed] = useState(false);

  // Firebase Auth, Master Admin & RBAC State
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [adminRole, setAdminRole] = useState<AdminPrivilegeRole | null>(null);
  const [masterAdminSession, setMasterAdminSession] = useState<MasterAdminSession | null>(() =>
    loadStoredMasterAdminSession()
  );
  const effectiveAdminRole: AdminPrivilegeRole | null =
    adminRole || (masterAdminSession ? 'owner' : null);
  const canAccessAdmin = effectiveAdminRole !== null;
  const isOwnerAdmin = effectiveAdminRole === 'owner';

  useEffect(() => {
    const syncLocal = () => setMasterAdminSession(loadStoredMasterAdminSession());
    const unsub = subscribeMasterAdminSession(syncLocal);
    void validateMasterAdminSession().then((valid) => {
      setMasterAdminSession(valid);
    });
    return unsub;
  }, []);

  // Live Firestore Data State
  const [firestoreCatalog, setFirestoreCatalog] = useState<MediaItem[]>([]);
  const [ratingsByMediaId, setRatingsByMediaId] = useState<
    Record<string, { average: number; count: number }>
  >({});
  const [initialMediaLoaded, setInitialMediaLoaded] = useState(false);
  const [dbConnectionStatus, setDbConnectionStatus] =
    useState<FirestoreConnectionStatus>('connecting');
  const [dbConnectionError, setDbConnectionError] = useState<string | null>(null);
  const [dbReconnectNonce, setDbReconnectNonce] = useState(0);

  useEffect(() => {
    return subscribeActiveDatabaseChange(() => {
      setFirestoreCatalog([]);
      setInitialMediaLoaded(false);
      setDbConnectionStatus('connecting');
      setDbConnectionError(null);
      setDbReconnectNonce((n) => n + 1);
    });
  }, []);
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(DEFAULT_SETTINGS);
  const [customFonts, setCustomFonts] = useState<
    Partial<Record<CustomFontSlot, CustomFontRecord>>
  >(() => loadStoredCustomFonts());
  const [visitorRequests, setVisitorRequests] = useState<VisitorRequest[]>([]);
  const [usersList, setUsersList] = useState<UserProfileRecord[]>([]);
  const [adminsList, setAdminsList] = useState<AdminRoleRecord[]>([]);
  const [adminRequestedTab, setAdminRequestedTab] = useState<{ tab: AdminTab; nonce: number }>({
    tab: 'overview',
    nonce: 0,
  });

  const [watchlistIds, setWatchlistIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_WATCHLIST);
      if (!saved) return ['running-man', 'ramadan-al-saraya'];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : ['running-man', 'ramadan-al-saraya'];
    } catch {
      return ['running-man'];
    }
  });

  const [dismissedStarterIds, setDismissedStarterIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_DISMISSED_STARTERS);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  });
  const [starterCleared, setStarterCleared] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_STARTER_CLEARED) === '1';
    } catch {
      return false;
    }
  });

  const isFirestoreSeeded = firestoreCatalog.length > 0;
  const visibleStarterItems = starterCleared
    ? []
    : CATALOG_ITEMS.filter((item) => !dismissedStarterIds.includes(item.id));
  const rawActiveCatalog = isFirestoreSeeded ? firestoreCatalog : visibleStarterItems;
  const activeCatalog = useMemo(
    () =>
      rawActiveCatalog.map((item) => {
        const agg = ratingsByMediaId[sanitizeRatingMediaId(item.id)];
        return agg ? { ...item, communityRating: agg } : item;
      }),
    [rawActiveCatalog, ratingsByMediaId]
  );
  const selectedMedia =
    activeCatalog.find((item) => item.id === selectedMediaId) || activeCatalog[0] || null;
  const hasDismissedStarters = starterCleared || dismissedStarterIds.length > 0;

  // Sync browser Back/Forward, deep-linked ?watch=<slug> URLs & /admin route
  useEffect(() => {
    const syncFromLocation = () => {
      if (isAdminPath()) {
        setView('admin');
        return;
      }
      const { watchKey, episode } = readWatchRouteFromLocation();
      if (watchKey) {
        const matched = findMediaByRouteKey(activeCatalog, watchKey);
        if (matched) {
          setSelectedMediaId(matched.id);
          setRouteEpisode(episode || undefined);
          setView('single');
          return;
        }
        if (firestoreCatalog.length > 0) {
          // URL points to an unknown slug after catalog loaded
          setView('home');
        }
        return;
      }
      setView((curr) => (curr === 'admin' || curr === 'single' ? 'home' : curr));
    };

    syncFromLocation();
    window.addEventListener('popstate', syncFromLocation);
    window.addEventListener('hashchange', syncFromLocation);
    return () => {
      window.removeEventListener('popstate', syncFromLocation);
      window.removeEventListener('hashchange', syncFromLocation);
    };
  }, [activeCatalog, firestoreCatalog.length]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (view === 'admin') {
      document.title = `إدارة ${siteSettings.siteName} — لوحة التحكم`;
    } else if (view === 'single' && selectedMedia) {
      document.title = `${selectedMedia.title} — ${siteSettings.siteName}`;
    } else {
      document.title = `${siteSettings.siteName} — افلام ومسلسلات بجودة عالية بدون تقطيع`;
    }
  }, [view, selectedMedia, siteSettings.siteName]);

  useEffect(() => {
    applyTypographyToDocument(siteSettings.typography, customFonts);
  }, [siteSettings.typography, customFonts]);

  // Apply TV/Mobile/Low-Spec device display prefs and install D-pad spatial navigation
  useEffect(() => {
    applyDisplayDevicePrefs(loadDisplayDevicePrefs());
  }, []);

  useEffect(() => {
    return installTvSpatialNavigation({
      onBack: () => {
        if (playerState) {
          setPlayerState(null);
          return true;
        }
        if (trailerItem) {
          setTrailerItem(null);
          return true;
        }
        if (searchOpen) {
          setSearchOpen(false);
          return true;
        }
        if (watchlistOpen) {
          setWatchlistOpen(false);
          return true;
        }
        if (loginOpen) {
          setLoginOpen(false);
          return true;
        }
        if (footerTopic) {
          setFooterTopic(null);
          return true;
        }
        if (view === 'single' || view === 'archive') {
          setView('home');
          return true;
        }
        return false;
      },
    });
  }, [playerState, trailerItem, searchOpen, watchlistOpen, loginOpen, footerTopic, view]);

  useEffect(() => {
    setLiveShieldConfig(siteSettings.popupShield);
  }, [siteSettings.popupShield]);

  useEffect(() => {
    return installGlobalPopupShieldGuards();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_WATCHLIST, JSON.stringify(watchlistIds));
    } catch {
      // Ignore storage quota errors
    }
  }, [watchlistIds]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_DISMISSED_STARTERS, JSON.stringify(dismissedStarterIds));
    } catch {
      // Ignore storage quota errors
    }
  }, [dismissedStarterIds]);

  useEffect(() => {
    try {
      if (starterCleared) {
        localStorage.setItem(STORAGE_STARTER_CLEARED, '1');
      } else {
        localStorage.removeItem(STORAGE_STARTER_CLEARED);
      }
    } catch {
      // Ignore storage quota errors
    }
  }, [starterCleared]);

  // 1. Public Firestore Listeners (/media and /settings/general)
  useEffect(() => {
    const activeDb = getActiveDatabase();
    const mediaPath = 'media';
    const unsubMedia = onSnapshot(
      collection(activeDb, mediaPath),
      (snapshot) => {
        const docs = snapshot.docs.map((d) => {
          const raw = d.data() as Partial<MediaItem> & {
            createdAt?: { toMillis?: () => number };
            updatedAt?: { toMillis?: () => number };
          };
          const createdAtMs =
            raw.createdAt && typeof raw.createdAt.toMillis === 'function'
              ? raw.createdAt.toMillis()
              : 0;
          const updatedAtMs =
            raw.updatedAt && typeof raw.updatedAt.toMillis === 'function'
              ? raw.updatedAt.toMillis()
              : createdAtMs;
          const poster = resolveMediaAssetUrl(raw.poster_url || raw.poster, FALLBACK_POSTER);
          const rawDistinctBackdrop =
            raw.backdrop_url !== undefined
              ? resolveMediaAssetUrl(raw.backdrop_url, '')
              : resolveMediaAssetUrl(raw.backdrop, '');
          const backdropUrlNormalized =
            rawDistinctBackdrop && rawDistinctBackdrop !== poster ? rawDistinctBackdrop : '';
          const backdrop = rawDistinctBackdrop || FALLBACK_BACKDROP;
          const parsedImdb = Number(raw.imdb);
          return {
            ...raw,
            id: String(raw.id || d.id),
            slug: raw.slug || String(raw.id || d.id),
            title: raw.title || raw.englishTitle || 'عمل بدون عنوان',
            englishTitle: raw.englishTitle || raw.title || 'Untitled',
            kind: raw.kind || 'movie',
            categories: Array.isArray(raw.categories) && raw.categories.length > 0 ? raw.categories : ['افلام'],
            genres: Array.isArray(raw.genres) ? raw.genres : [],
            year: String(raw.year || '2026'),
            country: raw.country || 'غير محدد',
            language: raw.language || 'مترجم للعربية',
            quality: raw.quality || 'HD',
            duration: raw.duration || '',
            imdb: Number.isFinite(parsedImdb) ? parsedImdb : 7.5,
            votes: raw.votes || '0',
            story: raw.story || '',
            cast: Array.isArray(raw.cast) ? raw.cast : [],
            servers: Array.isArray(raw.servers) ? raw.servers : [],
            downloads: Array.isArray(raw.downloads) ? raw.downloads : [],
            seasons: Array.isArray(raw.seasons) ? raw.seasons : [],
            franchiseIds: Array.isArray(raw.franchiseIds) ? raw.franchiseIds : [],
            poster,
            backdrop,
            poster_url: poster,
            backdrop_url: backdropUrlNormalized,
            createdAtMs,
            updatedAtMs,
          } as MediaItem;
        });
        docs.sort((a, b) => {
          const tDiff = (b.updatedAtMs || b.createdAtMs || 0) - (a.updatedAtMs || a.createdAtMs || 0);
          if (tDiff !== 0) return tDiff;
          return (parseInt(b.year || '0', 10) || 0) - (parseInt(a.year || '0', 10) || 0);
        });
        setFirestoreCatalog(docs);
        setInitialMediaLoaded(true);
        setDbConnectionStatus('connected');
        setDbConnectionError(null);
        recordDatabaseConnected();
        if (docs.length > 0) {
          // Once Firestore holds live items, prevent initial fallback items from popping back if DB is cleared later
          setStarterCleared(true);
        }
      },
      (error) => {
        setInitialMediaLoaded(true);
        const classified = classifyFirestoreConnectionError(error);
        setDbConnectionStatus(classified.status);
        setDbConnectionError(classified.message);
        recordDatabaseOutage(
          classified.status === 'error' || classified.status === 'connecting'
            ? 'offline'
            : classified.status,
          classified.message,
          error instanceof Error ? error.message : String(error)
        );
        try {
          handleFirestoreError(error, OperationType.LIST, mediaPath);
        } catch {
          // Keep fallback catalog visible instead of crashing on network/permission errors
        }
      }
    );

    const settingsPath = 'settings/general';
    const unsubSettings = onSnapshot(
      doc(activeDb, 'settings', 'general'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<SiteSettings>;
          const syncedTheme = data.playerTheme
            ? saveStoredPlayerTheme(data.playerTheme)
            : loadStoredPlayerTheme();
          const syncedHome = data.homeConfig
            ? saveStoredHomeConfig(data.homeConfig)
            : loadStoredHomeConfig();
          const syncedTypography = data.typography
            ? saveStoredTypographyConfig(data.typography)
            : loadStoredTypographyConfig();
          const syncedShield = data.popupShield
            ? saveStoredPopupShieldConfig(data.popupShield)
            : loadStoredPopupShieldConfig();
          setSiteSettings({
            siteName: data.siteName || DEFAULT_SETTINGS.siteName,
            tagline: data.tagline || DEFAULT_SETTINGS.tagline,
            announcementText: data.announcementText || '',
            tickerEnabled: data.tickerEnabled ?? false,
            featuredLimit: data.featuredLimit || 5,
            maintenanceMode: Boolean(data.maintenanceMode),
            maintenanceMessage:
              typeof data.maintenanceMessage === 'string' && data.maintenanceMessage.trim()
                ? data.maintenanceMessage
                : DEFAULT_SETTINGS.maintenanceMessage,
            playerTheme: syncedTheme,
            homeConfig: syncedHome,
            typography: syncedTypography,
            popupShield: syncedShield,
          });
        }
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.GET, settingsPath);
        } catch {
          // Fallback to default settings if settings doc cannot be fetched
        }
      }
    );

    const fontsPath = 'fonts';
    const unsubFonts = onSnapshot(
      collection(activeDb, fontsPath),
      (snapshot) => {
        const nextFonts: Partial<Record<CustomFontSlot, CustomFontRecord>> = {};
        snapshot.docs.forEach((d) => {
          const raw = d.data() as Partial<CustomFontRecord>;
          const slot: CustomFontSlot | null =
            d.id === 'arabic' || raw.id === 'arabic'
              ? 'arabic'
              : d.id === 'english' || raw.id === 'english'
                ? 'english'
                : null;
          if (!slot || !raw.sourceUrl || !raw.family) return;
          nextFonts[slot] = {
            id: slot,
            family: String(raw.family),
            fileName: String(raw.fileName || 'custom-font'),
            format: raw.format || 'woff2',
            sourceUrl: String(raw.sourceUrl),
          };
        });
        saveStoredCustomFonts(nextFonts);
        setCustomFonts(nextFonts);
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, fontsPath);
        } catch {
          // Keep locally stored custom fonts if cloud rules for /fonts are not yet deployed
        }
      }
    );

    const ratingsPath = 'ratings';
    const unsubRatings = onSnapshot(
      collection(activeDb, ratingsPath),
      (snapshot) => {
        const sums: Record<string, { total: number; count: number }> = {};
        snapshot.docs.forEach((d) => {
          const data = d.data() as { mediaId?: unknown; stars?: unknown };
          const mediaKey = sanitizeRatingMediaId(String(data.mediaId || ''));
          const stars = Math.round(Number(data.stars) || 0);
          if (!mediaKey || stars < 1 || stars > 5) return;
          if (!sums[mediaKey]) {
            sums[mediaKey] = { total: 0, count: 0 };
          }
          sums[mediaKey].total += stars;
          sums[mediaKey].count += 1;
        });

        const nextAgg: Record<string, { average: number; count: number }> = {};
        Object.entries(sums).forEach(([key, val]) => {
          nextAgg[key] = {
            average: val.total / val.count,
            count: val.count,
          };
        });
        setRatingsByMediaId(nextAgg);
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, ratingsPath);
        } catch {
          // Keep app functional if ratings rules are not deployed yet
        }
      }
    );

    return () => {
      unsubMedia();
      unsubSettings();
      unsubFonts();
      unsubRatings();
    };
  }, [dbReconnectNonce]);

  // 1b. Automatic Transient Outage Retry Guard
  useEffect(() => {
    if (dbConnectionStatus !== 'offline') return;
    const reg = loadDatabaseRegistry();
    if (!reg.autoRetryEnabled) return;

    let cancelled = false;
    let attempt = 0;
    const delays = [6000, 15000, 30000];
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = () => {
      if (cancelled || attempt >= delays.length) return;
      const delay = delays[attempt];
      attempt += 1;
      timer = setTimeout(async () => {
        if (cancelled) return;
        const activeProf = getActiveConnectionProfile();
        const probe = await probeDatabaseConnection();
        appendDatabaseConnectionLog({
          event: 'retry',
          connectionId: activeProf.id,
          connectionName: activeProf.name,
          status: probe.ok ? 'success' : 'warning',
          resultStatus: probe.ok ? 'connected' : 'offline',
          message: probe.ok
            ? `نجحت إعادة المحاولة التلقائية (#${attempt}) وتم استرجاع الاتصال.`
            : `فشلت إعادة المحاولة التلقائية (#${attempt}): ${probe.message || 'غير متصل'}`,
        });
        if (probe.ok) {
          setDbReconnectNonce((n) => n + 1);
        } else {
          scheduleNext();
        }
      }, delay);
    };

    scheduleNext();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [dbConnectionStatus, dbReconnectNonce]);

  // 2. Auth State Listener + Profile Sync (re-attaches if active Firebase App switches)
  useEffect(() => {
    const activeAuth = getActiveAuth();
    const unsubAuth = onAuthStateChanged(activeAuth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        const resolvedRole = await getUserAdminRole(user);
        setAdminRole(resolvedRole);
        if (resolvedRole !== 'owner') {
          setUsersList([]);
          setAdminsList([]);
        }
        try {
          const cloudWatchlist = await syncUserProfileToFirestore(
            user,
            watchlistIds,
            resolvedRole !== null
          );
          setWatchlistIds(cloudWatchlist);
        } catch {
          // Handled cleanly inside firebase helper
        }
      } else {
        setAdminRole(null);
        setVisitorRequests([]);
        setUsersList([]);
        setAdminsList([]);
      }
      setAuthLoading(false);
    });
    return () => unsubAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbReconnectNonce]);

  // 3. Authenticated Listeners (/requests, plus /users & /admins for Owner Admins only)
  useEffect(() => {
    if (authLoading || !firebaseUser) return;

    const activeDb = getActiveDatabase();
    const reqPath = 'requests';
    const reqQuery = isOwnerAdmin
      ? query(collection(activeDb, reqPath), orderBy('createdAt', 'desc'))
      : query(collection(activeDb, reqPath), where('userId', '==', firebaseUser.uid));

    const unsubRequests = onSnapshot(
      reqQuery,
      (snapshot) => {
        const list = snapshot.docs
          .map((d) => {
            const data = d.data();
            const createdMs =
              data.createdAt && typeof data.createdAt.toMillis === 'function'
                ? data.createdAt.toMillis()
                : 0;
            return {
              createdMs,
              item: {
                id: data.id || d.id,
                userId: data.userId,
                requesterName: data.requesterName,
                title: data.title,
                type: data.type,
                notes: data.notes || '',
                status: data.status || 'pending',
                adminNote: data.adminNote || '',
                createdAt:
                  data.createdAt && typeof data.createdAt.toDate === 'function'
                    ? data.createdAt.toDate().toISOString()
                    : new Date().toISOString(),
              } as VisitorRequest,
            };
          })
          .sort((a, b) => b.createdMs - a.createdMs)
          .map((entry) => entry.item);
        setVisitorRequests(list);
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, reqPath);
        } catch {
          // Ignore background listener permission errors gracefully
        }
      }
    );

    let unsubUsers = () => {};
    let unsubAdmins = () => {};

    if (isOwnerAdmin) {
      unsubUsers = onSnapshot(
        collection(activeDb, 'users'),
        (snapshot) => {
          setUsersList(snapshot.docs.map((d) => d.data() as UserProfileRecord));
        },
        (error) => {
          try {
            handleFirestoreError(error, OperationType.LIST, 'users');
          } catch {
            // Ignore background listener permission errors gracefully
          }
        }
      );

      unsubAdmins = onSnapshot(
        collection(activeDb, 'admins'),
        (snapshot) => {
          setAdminsList(snapshot.docs.map((d) => d.data() as AdminRoleRecord));
        },
        (error) => {
          try {
            handleFirestoreError(error, OperationType.LIST, 'admins');
          } catch {
            // Ignore background listener permission errors gracefully
          }
        }
      );
    }

    return () => {
      unsubRequests();
      unsubUsers();
      unsubAdmins();
    };
  }, [authLoading, firebaseUser, isOwnerAdmin, dbReconnectNonce]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 3200);
  }, []);

  const pushPathIfNeeded = (targetPath: '/' | '/admin') => {
    if (typeof window === 'undefined') return;
    const basePrefix = getAppBasePrefix();
    if (basePrefix) {
      const desiredUrl = targetPath === '/admin' ? `${basePrefix}/#/admin` : `${basePrefix}/`;
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (currentUrl !== desiredUrl) {
        window.history.pushState({}, '', desiredUrl);
      }
      return;
    }
    const currentFull = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (currentFull !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
  };

  const pushWatchRoute = (item: MediaItem, episodeNumber?: number) => {
    if (typeof window === 'undefined') return;
    const basePrefix = getAppBasePrefix();
    const watchSlug = encodeURIComponent((item.slug || item.id).trim());
    const epPart = episodeNumber && episodeNumber > 1 ? `&ep=${episodeNumber}` : '';
    const desiredUrl = `${basePrefix}/?watch=${watchSlug}${epPart}`;
    const currentFull = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (currentFull !== desiredUrl) {
      window.history.pushState({}, '', desiredUrl);
    }
  };

  const openAdminPage = (tab?: AdminTab) => {
    const prefs = loadAdminWorkspacePrefs();
    const moderatorPerms = prefs.moderatorSubPermissions;
    const isOwner = effectiveAdminRole === 'owner';
    const fallbackTab: AdminTab = isOwner ? 'overview' : 'catalog';
    const storedLast = prefs.lastTab as AdminTab | undefined;
    const desiredTab =
      tab ||
      (storedLast && isTabAccessible(storedLast, isOwner, moderatorPerms)
        ? storedLast
        : fallbackTab);
    const resolvedTab: AdminTab = isTabAccessible(desiredTab, isOwner, moderatorPerms)
      ? desiredTab
      : fallbackTab;
    setAdminRequestedTab((prev) => ({ tab: resolvedTab, nonce: prev.nonce + 1 }));
    pushPathIfNeeded('/admin');
    setView('admin');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigateHome = () => {
    pushPathIfNeeded('/');
    setRouteEpisode(undefined);
    setFilters(DEFAULT_FILTERS);
    setView('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectMedia = (item: MediaItem, openDownloads = false) => {
    pushWatchRoute(item);
    setSelectedMediaId(item.id);
    setRouteEpisode(undefined);
    setOpenDownloadsOnSingle(openDownloads);
    setView('single');
    if (!openDownloads) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleApplyFilter = (partial: Partial<CatalogFilterState>) => {
    pushPathIfNeeded('/');
    setRouteEpisode(undefined);
    setFilters({ ...DEFAULT_FILTERS, ...partial });
    setView('archive');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleToggleWatchlist = (item: MediaItem) => {
    setWatchlistIds((prev) => {
      const exists = prev.includes(item.id);
      const next = exists ? prev.filter((id) => id !== item.id) : [item.id, ...prev];
      showToast(
        exists
          ? `تمت إزالة "${item.title}" من قائمتي`
          : `تمت إضافة "${item.title}" إلى قائمتي بنجاح`
      );
      if (firebaseUser) {
        void saveWatchlistToFirestore(firebaseUser.uid, next);
      }
      return next;
    });
  };

  const handleLogout = async () => {
    await logoutMasterAdmin();
    await signOutFirebase().catch(() => undefined);
    showToast('تم تسجيل الخروج بنجاح');
  };

  const handleAddRequest = async (req: {
    title: string;
    type: VisitorRequest['type'];
    notes: string;
  }) => {
    if (!firebaseUser) return;
    await submitVisitorRequestToFirestore(firebaseUser, req);
    showToast('تم إرسال طلبك وحفظه في قاعدة البيانات');
  };

  const handleDeleteStarterItems = (ids: string[]) => {
    if (ids.length === 0) return;
    setDismissedStarterIds((prev) => {
      const merged = Array.from(new Set([...prev, ...ids]));
      const remaining = CATALOG_ITEMS.filter((item) => !merged.includes(item.id));
      if (remaining.length === 0) {
        setStarterCleared(true);
      }
      return merged;
    });
  };

  const handleClearAllStarterItems = () => {
    setStarterCleared(true);
    setDismissedStarterIds(CATALOG_ITEMS.map((item) => item.id));
  };

  const handleRestoreStarterItems = () => {
    setStarterCleared(false);
    setDismissedStarterIds([]);
  };

  const handleUpdateHostRule = (rule: PopupShieldHostRule) => {
    const baseShield = siteSettings.popupShield || loadStoredPopupShieldConfig();
    const nextShield = saveStoredPopupShieldConfig({
      ...baseShield,
      hostRules: {
        ...baseShield.hostRules,
        [rule.hostname]: rule,
      },
    });
    const nextSettings: SiteSettings = {
      ...siteSettings,
      popupShield: nextShield,
    };
    setSiteSettings(nextSettings);
    if (isOwnerAdmin && firebaseUser) {
      void saveSiteSettingsToFirestore(nextSettings, firebaseUser.uid).catch(() => undefined);
    }
  };

  const watchlistItems = activeCatalog.filter((i) => watchlistIds.includes(i.id));

  /* ---------------- Dedicated Standalone /admin Page (No Header / No Footer) ---------------- */
  if (view === 'admin') {
    return (
      <>
        <Suspense
          fallback={
            <div className="min-h-screen bg-[#06131c] flex flex-col items-center justify-center gap-3 text-white">
              <div className="h-9 w-9 animate-spin rounded-full border-4 border-[#D92321] border-t-transparent" />
              <span className="text-xs font-bold text-[#b7c9ef]">جاري تحميل لوحة الإدارة...</span>
            </div>
          }
        >
          <AdminDashboardView
            user={firebaseUser}
            masterAdminSession={masterAdminSession}
            isAdmin={canAccessAdmin}
            adminRole={effectiveAdminRole}
            authLoading={authLoading && !masterAdminSession}
            catalog={activeCatalog}
            isFirestoreSeeded={isFirestoreSeeded}
            dbConnectionStatus={dbConnectionStatus}
            dbConnectionError={dbConnectionError}
            onReconnectDatabase={async () => {
              setDbConnectionStatus('connecting');
              setDbConnectionError(null);
              const probe = await probeDatabaseConnection();
              setDbReconnectNonce((n) => n + 1);
              if (!probe.ok && probe.status !== 'connected') {
                setDbConnectionStatus(probe.status);
                setDbConnectionError(probe.message || null);
                showToast(probe.message || 'تعذر إعادة الاتصال بقاعدة البيانات');
              } else {
                showToast('تم إرسال طلب إعادة الاتصال بقاعدة بيانات Firestore');
              }
            }}
            hasDismissedStarters={hasDismissedStarters}
            requests={visitorRequests}
            usersList={usersList}
            adminsList={adminsList}
            siteSettings={siteSettings}
            customFonts={customFonts}
            onCustomFontsChange={(next) => {
              saveStoredCustomFonts(next);
              setCustomFonts(next);
            }}
            onPopupShieldChange={(next) => {
              const clean = saveStoredPopupShieldConfig(next);
              setSiteSettings((prev) => ({ ...prev, popupShield: clean }));
            }}
            requestedTab={adminRequestedTab}
            onExitDashboard={navigateHome}
            onPreviewMedia={(item) => handleSelectMedia(item, false)}
            onDeleteStarterItems={handleDeleteStarterItems}
            onClearAllStarterItems={handleClearAllStarterItems}
            onRestoreStarterItems={handleRestoreStarterItems}
            onNotify={showToast}
          />
        </Suspense>

        {toastMessage && (
          <div
            role="status"
            className="fixed bottom-6 right-6 z-[60] inline-flex items-center gap-2.5 rounded-2xl bg-[#4CAF50] px-4 py-3 text-xs sm:text-sm font-extrabold text-white shadow-2xl border border-white/20"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}
      </>
    );
  }

  /* ---------------- Maintenance Mode Gate (Regular Visitors Blocked; Admins & Moderators Bypass) ---------------- */
  if (siteSettings.maintenanceMode && !canAccessAdmin) {
    if (authLoading) {
      return (
        <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center text-white">
          <div className="h-9 w-9 animate-spin rounded-full border-4 border-[#E50914] border-t-transparent" />
        </div>
      );
    }
    return (
      <>
        <MaintenanceScreen
          siteName={siteSettings.siteName}
          tagline={siteSettings.tagline}
          message={siteSettings.maintenanceMessage}
          onOpenAdminLogin={() => setLoginOpen(true)}
        />
        <LoginModal
          isOpen={loginOpen}
          onClose={() => setLoginOpen(false)}
          firebaseUser={firebaseUser}
          masterAdminSession={masterAdminSession}
          isAdmin={canAccessAdmin}
          adminRole={effectiveAdminRole}
          onLogout={handleLogout}
          onOpenAdmin={() => openAdminPage()}
          onNotify={showToast}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#0f0f0f] text-white">
      {!clientCapabilities.baselineSupported && !compatBannerDismissed && (
        <div
          role="status"
          className="bg-[#1a242e] text-white border-b border-[#f9c400]/35 px-4 py-2 text-xs flex items-center justify-between gap-3 z-50"
        >
          <span className="inline-flex items-center gap-2 font-bold text-[#f9c400]">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              {clientCapabilities.baselineNotes[0] ||
                'إصدار المتصفح قديم نسبياً — يوصى بتحديثه للحصول على أفضل أداء وتشغيل فيديو.'}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setCompatBannerDismissed(true)}
            aria-label="إغلاق تنبيه التوافق"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {siteSettings.maintenanceMode && canAccessAdmin && (
        <div className="bg-[#f9c400] text-[#0f0f0f] px-4 py-2 text-xs font-black flex flex-wrap items-center justify-center gap-3 z-50">
          <span className="inline-flex items-center gap-1.5">
            <Wrench className="w-3.5 h-3.5" />
            <span>
              {isOwnerAdmin
                ? 'وضع الصيانة مُفعّل حاليًا للزوار — الموقع متاح لك بصلاحية المسؤول'
                : 'وضع الصيانة مُفعّل حاليًا للزوار — الموقع متاح لك بصلاحية المشرف'}
            </span>
          </span>
          {isOwnerAdmin && (
            <button
              type="button"
              onClick={() => openAdminPage('settings')}
              className="rounded-lg bg-[#0f0f0f] text-white px-3 py-1 text-[11px] font-extrabold hover:bg-[#E50914] transition-colors cursor-pointer"
            >
              إدارة الإعدادات
            </button>
          )}
        </div>
      )}
      <Header
        catalog={activeCatalog}
        onNavigateHome={navigateHome}
        onSelectCategory={(category) => handleApplyFilter({ category })}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenWatchlist={() => setWatchlistOpen(true)}
        onOpenContact={() => setFooterTopic('requests')}
        onOpenLogin={() => setLoginOpen(true)}
        onOpenAdmin={() => openAdminPage()}
        onSelectMedia={handleSelectMedia}
        watchlistCount={watchlistItems.length}
        username={firebaseUser?.displayName || masterAdminSession?.displayName || null}
        userPhoto={firebaseUser?.photoURL || null}
        isAdmin={canAccessAdmin}
        activeCategory={filters.category}
        currentView={view}
      />

      <main className="flex-1">
        {view === 'home' && (
          <HomeView
            catalog={activeCatalog}
            siteSettings={siteSettings}
            isAdmin={isOwnerAdmin}
            loading={!initialMediaLoaded && activeCatalog.length === 0}
            onSelectMedia={handleSelectMedia}
            onApplyFilter={handleApplyFilter}
            onPlayNow={(item) => setPlayerState({ item, episode: 1 })}
            onOpenContact={() => setFooterTopic('requests')}
            onOpenHomeBuilder={() => openAdminPage('home_builder')}
            watchlistIds={watchlistIds}
            onToggleWatchlist={handleToggleWatchlist}
          />
        )}

        {view === 'archive' && (
          <CatalogArchiveView
            catalog={activeCatalog}
            filters={filters}
            onUpdateFilters={setFilters}
            onResetFilters={() => setFilters(DEFAULT_FILTERS)}
            onSelectMedia={handleSelectMedia}
            watchlistIds={watchlistIds}
            onToggleWatchlist={handleToggleWatchlist}
          />
        )}

        {view === 'single' && selectedMedia && (
          <SingleDetailView
            catalog={activeCatalog}
            item={selectedMedia}
            initialEpisode={routeEpisode}
            initialOpenDownloads={openDownloadsOnSingle}
            currentUser={firebaseUser}
            onOpenLogin={() => setLoginOpen(true)}
            onSelectMedia={handleSelectMedia}
            onApplyFilter={handleApplyFilter}
            onNavigateHome={navigateHome}
            onOpenTrailer={(item) => setTrailerItem(item)}
            onOpenPlayer={(item, ep = 1, srvIdx = 0) =>
              setPlayerState({ item, episode: ep, serverIndex: srvIdx })
            }
            isInWatchlist={watchlistIds.includes(selectedMedia.id)}
            onToggleWatchlist={handleToggleWatchlist}
            onNotify={showToast}
            watchlistIds={watchlistIds}
          />
        )}
      </main>

      <Footer
        tagline={siteSettings.tagline}
        onOpenTopic={(topic) => setFooterTopic(topic)}
        onNavigateHome={navigateHome}
      />

      {/* Overlays & Modals */}
      <SearchDrawer
        catalog={activeCatalog}
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectMedia={handleSelectMedia}
        onViewAllResults={(queryText, category) =>
          handleApplyFilter({ query: queryText, category })
        }
      />

      <WatchlistModal
        isOpen={watchlistOpen}
        onClose={() => setWatchlistOpen(false)}
        items={watchlistItems}
        onSelectMedia={handleSelectMedia}
        onRemove={handleToggleWatchlist}
      />

      <TrailerModal
        item={trailerItem}
        playerTheme={siteSettings.playerTheme}
        popupShieldConfig={siteSettings.popupShield}
        onClose={() => setTrailerItem(null)}
        onWatchFull={(item) => setPlayerState({ item, episode: 1 })}
      />

      <PlayerModal
        item={playerState?.item || null}
        initialEpisode={playerState?.episode || 1}
        initialServerIndex={playerState?.serverIndex || 0}
        playerTheme={siteSettings.playerTheme}
        popupShieldConfig={siteSettings.popupShield}
        onUpdateHostRule={handleUpdateHostRule}
        isInWatchlist={playerState?.item ? watchlistIds.includes(playerState.item.id) : false}
        onToggleWatchlist={handleToggleWatchlist}
        onNotify={showToast}
        onClose={() => setPlayerState(null)}
      />

      <LoginModal
        isOpen={loginOpen}
        onClose={() => setLoginOpen(false)}
        firebaseUser={firebaseUser}
        masterAdminSession={masterAdminSession}
        isAdmin={canAccessAdmin}
        adminRole={effectiveAdminRole}
        onLogout={handleLogout}
        onOpenAdmin={() => openAdminPage()}
        onNotify={showToast}
      />

      <FooterInfoModal
        topic={footerTopic}
        onClose={() => setFooterTopic(null)}
        firebaseUser={firebaseUser}
        onOpenLogin={() => setLoginOpen(true)}
        requests={visitorRequests}
        onAddRequest={handleAddRequest}
      />

      {/* Green Bottom-Right Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-50 inline-flex items-center gap-2.5 rounded-2xl bg-[#4CAF50] px-4 py-3 text-xs sm:text-sm font-extrabold text-white shadow-2xl border border-white/20"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
      {/* Offline Connectivity Indicator */}
      <OfflineIndicator />
    </div>
  );
}
