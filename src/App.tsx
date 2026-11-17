import { useEffect, useState } from 'react';
import { CheckCircle2, Wrench } from 'lucide-react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { AdminDashboardView } from './components/AdminDashboardView';
import { CatalogArchiveView } from './components/CatalogArchiveView';
import { Footer, FooterTopic } from './components/Footer';
import { Header } from './components/Header';
import { HomeView } from './components/HomeView';
import { MaintenanceScreen } from './components/MaintenanceScreen';
import {
  FooterInfoModal,
  LoginModal,
  PlayerModal,
  TrailerModal,
  WatchlistModal,
} from './components/Modals';
import { SearchDrawer } from './components/SearchDrawer';
import { SingleDetailView } from './components/SingleDetailView';
import { CATALOG_ITEMS } from './data/catalog';
import { FALLBACK_BACKDROP, FALLBACK_POSTER, resolveMediaAssetUrl } from './lib/mediaFilters';
import {
  auth,
  checkIsAdminUser,
  db,
  handleFirestoreError,
  OperationType,
  saveWatchlistToFirestore,
  signInWithGoogle,
  signOutFirebase,
  submitVisitorRequestToFirestore,
  syncUserProfileToFirestore,
} from './lib/firebase';
import {
  AdminRoleRecord,
  CatalogFilterState,
  MediaItem,
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
  tickerEnabled: true,
  featuredLimit: 5,
  maintenanceMode: false,
  maintenanceMessage:
    'نقوم حاليًا بإجراء أعمال صيانة وتحديثات تقنية لتحسين جودة السيرفرات وتجربة المشاهدة. سنعود للعمل قريبًا، شكرًا لتفهمكم.',
};

const STORAGE_WATCHLIST = 'moov_watchlist_ids';
const STORAGE_DISMISSED_STARTERS = 'rahaltv_dismissed_starters';
const STORAGE_STARTER_CLEARED = 'rahaltv_starter_cleared';

const getBasePrefix = () => {
  const base = import.meta.env.BASE_URL || '/';
  return base === '/' ? '' : base.replace(/\/+$/, '');
};

const isAdminPath = () => {
  if (typeof window === 'undefined') return false;
  const { pathname, hash } = window.location;
  if (hash.startsWith('#/admin')) return true;
  const basePrefix = getBasePrefix();
  const normalizedPath = pathname.replace(/\/+$/, '');
  return normalizedPath === '/admin' || normalizedPath === `${basePrefix}/admin`;
};

export default function App() {
  const [view, setView] = useState<'home' | 'archive' | 'single' | 'admin'>(() =>
    isAdminPath() ? 'admin' : 'home'
  );
  const [selectedMediaId, setSelectedMediaId] = useState<string>(CATALOG_ITEMS[0].id);
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

  // Firebase Auth & RBAC State
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Live Firestore Data State
  const [firestoreCatalog, setFirestoreCatalog] = useState<MediaItem[]>([]);
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(DEFAULT_SETTINGS);
  const [visitorRequests, setVisitorRequests] = useState<VisitorRequest[]>([]);
  const [usersList, setUsersList] = useState<UserProfileRecord[]>([]);
  const [adminsList, setAdminsList] = useState<AdminRoleRecord[]>([]);

  const [watchlistIds, setWatchlistIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_WATCHLIST);
      return saved ? JSON.parse(saved) : ['running-man', 'ramadan-al-saraya'];
    } catch {
      return ['running-man'];
    }
  });

  const [dismissedStarterIds, setDismissedStarterIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_DISMISSED_STARTERS);
      return saved ? (JSON.parse(saved) as string[]) : [];
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
  const activeCatalog = isFirestoreSeeded ? firestoreCatalog : visibleStarterItems;
  const selectedMedia =
    activeCatalog.find((item) => item.id === selectedMediaId) || activeCatalog[0] || null;
  const hasDismissedStarters = starterCleared || dismissedStarterIds.length > 0;

  // Sync browser Back/Forward & hash navigation with /admin standalone route
  useEffect(() => {
    const handleRouteChange = () => {
      if (isAdminPath()) {
        setView('admin');
      } else {
        setView((curr) => (curr === 'admin' ? 'home' : curr));
      }
    };
    window.addEventListener('popstate', handleRouteChange);
    window.addEventListener('hashchange', handleRouteChange);
    return () => {
      window.removeEventListener('popstate', handleRouteChange);
      window.removeEventListener('hashchange', handleRouteChange);
    };
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
    const mediaPath = 'media';
    const unsubMedia = onSnapshot(
      collection(db, mediaPath),
      (snapshot) => {
        const docs = snapshot.docs.map((d) => {
          const raw = d.data() as MediaItem & {
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
          const poster = resolveMediaAssetUrl(raw.poster, FALLBACK_POSTER);
          const backdrop = resolveMediaAssetUrl(raw.backdrop, poster || FALLBACK_BACKDROP);
          return {
            ...raw,
            poster,
            backdrop,
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
        if (docs.length > 0) {
          // Once Firestore holds live items, prevent initial fallback items from popping back if DB is cleared later
          setStarterCleared(true);
        }
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, mediaPath);
        } catch {
          // Keep fallback catalog visible instead of crashing on network/permission errors
        }
      }
    );

    const settingsPath = 'settings/general';
    const unsubSettings = onSnapshot(
      doc(db, 'settings', 'general'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<SiteSettings>;
          setSiteSettings({
            siteName: data.siteName || DEFAULT_SETTINGS.siteName,
            tagline: data.tagline || DEFAULT_SETTINGS.tagline,
            announcementText: data.announcementText || '',
            tickerEnabled: data.tickerEnabled ?? true,
            featuredLimit: data.featuredLimit || 5,
            maintenanceMode: Boolean(data.maintenanceMode),
            maintenanceMessage:
              typeof data.maintenanceMessage === 'string' && data.maintenanceMessage.trim()
                ? data.maintenanceMessage
                : DEFAULT_SETTINGS.maintenanceMessage,
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

    return () => {
      unsubMedia();
      unsubSettings();
    };
  }, []);

  // 2. Auth State Listener + Profile Sync
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        const adminFlag = await checkIsAdminUser(user);
        setIsAdmin(adminFlag);
        try {
          const cloudWatchlist = await syncUserProfileToFirestore(user, watchlistIds, adminFlag);
          setWatchlistIds(cloudWatchlist);
        } catch {
          // Handled cleanly inside firebase helper
        }
      } else {
        setIsAdmin(false);
        setVisitorRequests([]);
        setUsersList([]);
        setAdminsList([]);
      }
      setAuthLoading(false);
    });
    return () => unsubAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3. Authenticated Listeners (/requests, plus /users & /admins for Admins only)
  useEffect(() => {
    if (authLoading || !firebaseUser) return;

    const reqPath = 'requests';
    const reqQuery = isAdmin
      ? query(collection(db, reqPath), orderBy('createdAt', 'desc'))
      : query(
          collection(db, reqPath),
          where('userId', '==', firebaseUser.uid),
          orderBy('createdAt', 'desc')
        );

    const unsubRequests = onSnapshot(
      reqQuery,
      (snapshot) => {
        const list = snapshot.docs.map((d) => {
          const data = d.data();
          return {
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
          } as VisitorRequest;
        });
        setVisitorRequests(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, reqPath);
      }
    );

    let unsubUsers = () => {};
    let unsubAdmins = () => {};

    if (isAdmin) {
      unsubUsers = onSnapshot(
        collection(db, 'users'),
        (snapshot) => {
          setUsersList(snapshot.docs.map((d) => d.data() as UserProfileRecord));
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'users');
        }
      );

      unsubAdmins = onSnapshot(
        collection(db, 'admins'),
        (snapshot) => {
          setAdminsList(snapshot.docs.map((d) => d.data() as AdminRoleRecord));
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'admins');
        }
      );
    }

    return () => {
      unsubRequests();
      unsubUsers();
      unsubAdmins();
    };
  }, [authLoading, firebaseUser, isAdmin]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 3200);
  };

  const pushPathIfNeeded = (targetPath: '/' | '/admin') => {
    if (typeof window === 'undefined') return;
    const basePrefix = getBasePrefix();
    if (basePrefix) {
      // Under subpath hosting (e.g. GitHub Pages /RahaalTV-v1/), use hash route for /admin so reloads never 404
      const desiredUrl = targetPath === '/admin' ? `${basePrefix}/#/admin` : `${basePrefix}/`;
      const currentUrl = `${window.location.pathname}${window.location.hash}`;
      if (currentUrl !== desiredUrl) {
        window.history.pushState({}, '', desiredUrl);
      }
      return;
    }
    if (window.location.pathname !== targetPath || window.location.hash) {
      window.history.pushState({}, '', targetPath);
    }
  };

  const openAdminPage = () => {
    pushPathIfNeeded('/admin');
    setView('admin');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigateHome = () => {
    pushPathIfNeeded('/');
    setFilters(DEFAULT_FILTERS);
    setView('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectMedia = (item: MediaItem, openDownloads = false) => {
    pushPathIfNeeded('/');
    setSelectedMediaId(item.id);
    setOpenDownloadsOnSingle(openDownloads);
    setView('single');
    if (!openDownloads) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleApplyFilter = (partial: Partial<CatalogFilterState>) => {
    pushPathIfNeeded('/');
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

  const handleGoogleLogin = async () => {
    try {
      const res = await signInWithGoogle();
      showToast(`مرحبًا بك يا ${res.user.displayName || 'مستخدم'} في RahaL TV`);
    } catch {
      showToast('تم إلغاء تسجيل الدخول');
    }
  };

  const handleLogout = async () => {
    await signOutFirebase();
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

  const watchlistItems = activeCatalog.filter((i) => watchlistIds.includes(i.id));

  /* ---------------- Dedicated Standalone /admin Page (No Header / No Footer) ---------------- */
  if (view === 'admin') {
    return (
      <>
        <AdminDashboardView
          user={firebaseUser}
          isAdmin={isAdmin}
          authLoading={authLoading}
          catalog={activeCatalog}
          isFirestoreSeeded={isFirestoreSeeded}
          hasDismissedStarters={hasDismissedStarters}
          requests={visitorRequests}
          usersList={usersList}
          adminsList={adminsList}
          siteSettings={siteSettings}
          onExitDashboard={navigateHome}
          onPreviewMedia={(item) => handleSelectMedia(item, false)}
          onDeleteStarterItems={handleDeleteStarterItems}
          onClearAllStarterItems={handleClearAllStarterItems}
          onRestoreStarterItems={handleRestoreStarterItems}
          onNotify={showToast}
        />

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

  /* ---------------- Maintenance Mode Gate (Regular Visitors Blocked; Admins Bypass) ---------------- */
  if (siteSettings.maintenanceMode && !isAdmin) {
    if (authLoading) {
      return (
        <div className="min-h-screen bg-[#06131c] flex items-center justify-center text-white">
          <div className="h-9 w-9 animate-spin rounded-full border-4 border-[#D92321] border-t-transparent" />
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
          isAdmin={isAdmin}
          onGoogleLogin={handleGoogleLogin}
          onLogout={handleLogout}
          onOpenAdmin={openAdminPage}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#06131c] text-white">
      {siteSettings.maintenanceMode && isAdmin && (
        <div className="bg-[#f9c400] text-[#06131c] px-4 py-2 text-xs font-black flex flex-wrap items-center justify-center gap-3 z-50">
          <span className="inline-flex items-center gap-1.5">
            <Wrench className="w-3.5 h-3.5" />
            <span>وضع الصيانة مُفعّل حاليًا للزوار — الموقع متاح لك بصلاحية الأدمن</span>
          </span>
          <button
            type="button"
            onClick={openAdminPage}
            className="rounded-lg bg-[#06131c] text-white px-3 py-1 text-[11px] font-extrabold hover:bg-[#D92321] transition-colors cursor-pointer"
          >
            إدارة الإعدادات
          </button>
        </div>
      )}
      <Header
        catalog={activeCatalog}
        onNavigateHome={navigateHome}
        onSelectCategory={(category) => handleApplyFilter({ category })}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenWatchlist={() => setWatchlistOpen(true)}
        onOpenLogin={() => setLoginOpen(true)}
        onOpenAdmin={openAdminPage}
        onSelectMedia={handleSelectMedia}
        watchlistCount={watchlistItems.length}
        username={firebaseUser?.displayName || null}
        userPhoto={firebaseUser?.photoURL || null}
        isAdmin={isAdmin}
        activeCategory={filters.category}
        currentView={view}
      />

      <main className="flex-1">
        {view === 'home' && (
          <HomeView
            catalog={activeCatalog}
            siteSettings={siteSettings}
            onSelectMedia={handleSelectMedia}
            onApplyFilter={handleApplyFilter}
            onPlayNow={(item) => setPlayerState({ item, episode: 1 })}
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
            initialOpenDownloads={openDownloadsOnSingle}
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
        onClose={() => setTrailerItem(null)}
        onWatchFull={(item) => setPlayerState({ item, episode: 1 })}
      />

      <PlayerModal
        item={playerState?.item || null}
        initialEpisode={playerState?.episode || 1}
        initialServerIndex={playerState?.serverIndex || 0}
        onClose={() => setPlayerState(null)}
      />

      <LoginModal
        isOpen={loginOpen}
        onClose={() => setLoginOpen(false)}
        firebaseUser={firebaseUser}
        isAdmin={isAdmin}
        onGoogleLogin={handleGoogleLogin}
        onLogout={handleLogout}
        onOpenAdmin={openAdminPage}
      />

      <FooterInfoModal
        topic={footerTopic}
        onClose={() => setFooterTopic(null)}
        firebaseUser={firebaseUser}
        onGoogleLogin={handleGoogleLogin}
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
    </div>
  );
}
