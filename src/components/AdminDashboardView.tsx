import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  CheckCircle2,
  Code2,
  Copy,
  Database,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  Film,
  Globe,
  Layers,
  LayoutDashboard,
  Link2,
  Loader2,
  Lock,
  LogOut,
  MessageSquarePlus,
  Palette,
  Pin,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Tv,
  Users,
  Wand2,
  Wrench,
  X,
} from 'lucide-react';
import { User } from 'firebase/auth';
import { ASSETS, CATALOG_ITEMS } from '../data/catalog';
import { MediaPreviewModal } from './MediaPreviewModal';
import {
  bulkDeleteMediaFromFirestore,
  bulkSaveMediaToFirestore,
  createAdminAccountInFirebase,
  deleteMediaFromFirestore,
  deleteVisitorRequestFromFirestore,
  getFirebaseAuthErrorMessage,
  grantAdminRoleInFirestore,
  revokeAdminRoleFromFirestore,
  saveMediaToFirestore,
  saveSiteSettingsToFirestore,
  seedCatalogToFirestore,
  signInWithEmailPassword,
  signOutFirebase,
  updateVisitorRequestInFirestore,
} from '../lib/firebase';
import {
  checkServerUrlsInBrowser,
  CLOUDFLARE_WORKER_SOURCE,
  findTrailerInBrowser,
  getCustomApiBaseUrl,
  isLikelyNonVideoWebsiteUrl,
  resolveApiEndpoint,
  ScrapedPayload,
  scrapeSingleInBrowser,
  scrapeSiteInBrowser,
  setCustomApiBaseUrl,
} from '../lib/clientScraper';
import {
  DEFAULT_PLAYER_THEME,
  PLAYER_THEME_PRESETS,
  buildPlayerThemeVars,
  loadStoredPlayerTheme,
  normalizePlayerTheme,
  saveStoredPlayerTheme,
} from '../lib/playerTheme';
import {
  AdminRoleRecord,
  CastMember,
  DownloadMirror,
  EpisodeItem,
  MediaItem,
  MediaKind,
  PlayerThemeConfig,
  RequestStatus,
  SeasonItem,
  SiteSettings,
  StreamServer,
  UserProfileRecord,
  VisitorRequest,
} from '../types/media';

interface AdminDashboardViewProps {
  user: User | null;
  isAdmin: boolean;
  authLoading: boolean;
  catalog: MediaItem[];
  isFirestoreSeeded: boolean;
  hasDismissedStarters: boolean;
  requests: VisitorRequest[];
  usersList: UserProfileRecord[];
  adminsList: AdminRoleRecord[];
  siteSettings: SiteSettings;
  onExitDashboard: () => void;
  onPreviewMedia: (item: MediaItem) => void;
  onDeleteStarterItems: (ids: string[]) => void;
  onClearAllStarterItems: () => void;
  onRestoreStarterItems: () => void;
  onNotify: (msg: string) => void;
}

type AdminTab =
  | 'overview'
  | 'catalog'
  | 'scraper'
  | 'site_scraper'
  | 'requests'
  | 'users'
  | 'settings';
type EditorSubTab = 'basic' | 'servers' | 'downloads' | 'seasons_cast';

const POSTER_CHOICES = [
  { label: 'أكشن مستقبلي (Running Man)', url: ASSETS.runningMan },
  { label: 'أعماق المحيط (Fantasy)', url: ASSETS.oceanFantasy },
  { label: 'دراما رمضانية (Saraya)', url: ASSETS.ramadanEpic },
  { label: 'تحقيقات القاهرة (Noir)', url: ASSETS.arabianDrama },
  { label: 'ساموراي وضباب (Action)', url: ASSETS.samuraiAction },
  { label: 'فضاء وخيال علمي (Eclipse)', url: ASSETS.spaceOdyssey },
  { label: 'أنميشن ومغامرات (Clouds)', url: ASSETS.animatedAdventure },
  { label: 'رعب وغموض (Mansion)', url: ASSETS.horrorMansion },
  { label: 'حلبة المصارعة (Wrestling)', url: ASSETS.wrestlingArena },
];

const KIND_LABELS: Record<MediaKind, string> = {
  movie: 'فيلم',
  series: 'مسلسل',
  tv: 'برنامج / مسرحية',
  wrestling: 'مصارعة حرة',
};

const REQUEST_STATUS_LABELS: Record<RequestStatus, { label: string; cls: string }> = {
  pending: { label: 'قيد المراجعة', cls: 'bg-[#f9c400]/15 text-[#f9c400] border-[#f9c400]/30' },
  approved: { label: 'تمت الموافقة', cls: 'bg-sky-500/15 text-sky-300 border-sky-400/30' },
  completed: { label: 'تمت الإضافة', cls: 'bg-[#4CAF50]/15 text-[#4CAF50] border-[#4CAF50]/30' },
  rejected: { label: 'مرفوض', cls: 'bg-[#D92321]/15 text-[#D92321] border-[#D92321]/30' },
};

interface ServerStatusEntry {
  status: 'checking' | 'working' | 'warning' | 'broken';
  httpStatus?: number;
  label: string;
  detail?: string;
  sandboxBlocked?: boolean;
}

function extractIframeSrcPreview(embedCode?: string): string | null {
  if (!embedCode) return null;
  const match = embedCode.match(/src\s*=\s*["']([^"']+)["']/i);
  if (match) return match[1].trim();
  if (/^https?:\/\//i.test(embedCode.trim())) return embedCode.trim();
  return null;
}

function resolveWatchServerUrl(srv?: { mode?: 'url' | 'embed'; url?: string; embedCode?: string; watchUrl?: string }): string {
  if (!srv) return '';
  const fromEmbed = extractIframeSrcPreview(srv.embedCode);
  if (srv.mode === 'embed' && fromEmbed) return fromEmbed;
  if (srv.url && /^https?:\/\//i.test(srv.url.trim())) return srv.url.trim();
  if (srv.watchUrl && /^https?:\/\//i.test(srv.watchUrl.trim())) return srv.watchUrl.trim();
  if (fromEmbed) return fromEmbed;
  return (srv.url || srv.watchUrl || '').trim();
}

function renumberServers(servers: StreamServer[]): StreamServer[] {
  return servers.map((srv, idx) => ({
    ...srv,
    name: `سيرفر ${idx + 1}`,
  }));
}

function createEmptyMedia(): MediaItem {
  const id = `work-${Date.now()}`;
  return {
    id,
    slug: id,
    title: '',
    englishTitle: '',
    kind: 'movie',
    categories: ['افلام', 'افلام اجنبية'],
    genres: ['اكشن', 'إثارة'],
    year: '2026',
    country: 'الولايات المتحدة',
    language: 'الانجليزية',
    quality: 'WEB-DL',
    duration: '125 دقيقة',
    imdb: 8.0,
    votes: '12,400',
    views: 1500,
    likes: 240,
    pinned: false,
    isNew: true,
    comingSoon: false,
    poster: ASSETS.runningMan,
    backdrop: ASSETS.heroBackdrop,
    tagline: '',
    story: '',
    shortUrl: `https://rahaltv.com/${id}`,
    trailerUrl: '',
    trailerLabel: 'الإعلان الرسمي المترجم',
    trailerDuration: '02:15',
    cast: [{ name: 'نجم العمل', role: 'البطل', initials: 'RT' }],
    seasons: [],
    franchiseIds: [],
    servers: [
      {
        id: `srv-${Date.now()}-1`,
        name: 'سيرفر 1',
        mode: 'url',
        url: '',
        embedCode: '',
        quality: '1080p Full HD',
        speed: 'فائق السرعة',
        tag: 'رئيسي',
      },
    ],
    downloads: [
      {
        id: `dl-${Date.now()}-1`,
        host: 'رابط تحميل مباشر',
        quality: '1080p',
        size: '1.8 GB',
        format: 'MP4',
        url: '',
      },
    ],
  };
}

function scrapedToMediaItem(scraped: ScrapedPayload, indexOffset = 0): MediaItem {
  const id = `imported-${Date.now()}-${indexOffset}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    slug: id,
    title: scraped.title || 'عمل مستورد جديد',
    englishTitle: scraped.englishTitle || scraped.title || 'Imported Title',
    kind: scraped.kind || 'movie',
    categories: scraped.categories?.length ? scraped.categories : ['افلام'],
    genres: scraped.genres?.length ? scraped.genres : ['دراما'],
    year: scraped.year || '2026',
    country: scraped.country || 'الولايات المتحدة',
    language: scraped.language || 'مترجم للعربية',
    quality: scraped.quality || 'WEB-DL',
    duration: scraped.duration || '120 دقيقة',
    imdb: Number(scraped.imdb) || 7.8,
    votes: scraped.votes || '10,500',
    views: 0,
    likes: 0,
    pinned: false,
    isNew: true,
    comingSoon: false,
    poster: scraped.poster || ASSETS.runningMan,
    backdrop: scraped.backdrop || scraped.poster || ASSETS.heroBackdrop,
    tagline: scraped.tagline || scraped.story?.slice(0, 120) || '',
    story: scraped.story || scraped.title,
    shortUrl: scraped.shortUrl || `https://rahaltv.com/${id}`,
    trailerUrl: scraped.trailerUrl || '',
    trailerLabel: `إعلان ${scraped.title}`,
    trailerDuration: '02:00',
    cast: scraped.cast?.length ? scraped.cast : [{ name: 'طاقم العمل', role: 'تمثيل', initials: 'RT' }],
    seasons: scraped.seasons || [],
    franchiseIds: [],
    servers:
      scraped.servers?.length > 0
        ? renumberServers(scraped.servers)
        : [
            {
              id: `srv-${Date.now()}`,
              name: 'سيرفر 1',
              mode: 'url',
              url: '',
              embedCode: '',
              quality: scraped.quality || '1080p',
              speed: 'سريع',
              tag: 'HD',
            },
          ],
    downloads:
      scraped.downloads?.length > 0
        ? scraped.downloads
        : [
            {
              id: `dl-${Date.now()}`,
              host: 'رابط تحميل مباشر',
              quality: scraped.quality || '1080p',
              size: 'حسب السيرفر',
              format: 'MP4',
              url: '',
            },
          ],
  };
}

export function AdminDashboardView({
  user,
  isAdmin,
  authLoading,
  catalog,
  isFirestoreSeeded,
  hasDismissedStarters,
  requests,
  usersList,
  adminsList,
  siteSettings,
  onExitDashboard,
  onPreviewMedia,
  onDeleteStarterItems,
  onClearAllStarterItems,
  onRestoreStarterItems,
  onNotify,
}: AdminDashboardViewProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [busyAction, setBusyAction] = useState(false);
  const [adminSigningIn, setAdminSigningIn] = useState(false);
  const [adminAuthError, setAdminAuthError] = useState<string | null>(null);
  const [adminLoginEmail, setAdminLoginEmail] = useState('');
  const [adminLoginPassword, setAdminLoginPassword] = useState('');

  // Catalog tab states
  const [searchQuery, setSearchQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [editingItem, setEditingItem] = useState<MediaItem | null>(null);
  const [editorTab, setEditorTab] = useState<EditorSubTab>('basic');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [confirmBulkDeleteMode, setConfirmBulkDeleteMode] = useState<'selected' | 'all' | null>(null);

  // Categories/Genres helper inputs inside editor modal
  const [categoriesText, setCategoriesText] = useState('');
  const [genresText, setGenresText] = useState('');
  const [quickGenCount, setQuickGenCount] = useState(10);

  // External Content Scraper states (Single Item)
  const [scrapeMode, setScrapeMode] = useState<'url' | 'html'>('url');
  const [scrapeUrl, setScrapeUrl] = useState('');
  const [scrapeRawHtml, setScrapeRawHtml] = useState('');
  const [scraping, setScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [scrapedResult, setScrapedResult] = useState<ScrapedPayload | null>(null);
  const [editingScrapedServerIdx, setEditingScrapedServerIdx] = useState<number | null>(null);
  const [fetchingTrailer, setFetchingTrailer] = useState(false);

  // Site-Wide Bulk Crawler states (Entire Website)
  const [siteScrapeMode, setSiteScrapeMode] = useState<'url' | 'html'>('url');
  const [siteCrawlUrl, setSiteCrawlUrl] = useState('');
  const [siteCrawlHtml, setSiteCrawlHtml] = useState('');
  const [siteMaxItems, setSiteMaxItems] = useState(30);
  const [siteMaxPages, setSiteMaxPages] = useState(3);
  const [siteDeepScrape, setSiteDeepScrape] = useState(true);
  const [siteCrawling, setSiteCrawling] = useState(false);
  const [siteCrawlError, setSiteCrawlError] = useState<string | null>(null);
  const [siteCrawlMeta, setSiteCrawlMeta] = useState<{
    strategy: string;
    siteTitle: string;
    totalDiscovered: number;
  } | null>(null);
  const [siteScrapedItems, setSiteScrapedItems] = useState<
    (ScrapedPayload & { tempKey: string; selected: boolean })[]
  >([]);
  const [siteKindFilter, setSiteKindFilter] = useState<'all' | MediaKind>('all');

  // Requests tab states
  const [reqStatusFilter, setReqStatusFilter] = useState<string>('all');
  const [adminReplies, setAdminReplies] = useState<
    Record<string, { status: RequestStatus; note: string }>
  >({});

  // Admins tab states
  const [newAdminUid, setNewAdminUid] = useState('');
  const [newAdminName, setNewAdminName] = useState('');
  const [createAdminName, setCreateAdminName] = useState('');
  const [createAdminEmail, setCreateAdminEmail] = useState('');
  const [createAdminPassword, setCreateAdminPassword] = useState('');
  const [createAdminError, setCreateAdminError] = useState<string | null>(null);
  const [creatingAdmin, setCreatingAdmin] = useState(false);

  // Settings tab state
  const [settingsForm, setSettingsForm] = useState<SiteSettings>(() => ({
    ...siteSettings,
    playerTheme: normalizePlayerTheme(siteSettings.playerTheme || loadStoredPlayerTheme()),
  }));
  const [customApiUrl, setCustomApiUrl] = useState<string>(() => getCustomApiBaseUrl());
  useEffect(() => {
    setSettingsForm({
      ...siteSettings,
      playerTheme: normalizePlayerTheme(siteSettings.playerTheme || loadStoredPlayerTheme()),
    });
  }, [siteSettings]);

  const activePlayerTheme = normalizePlayerTheme(
    settingsForm.playerTheme || siteSettings.playerTheme || loadStoredPlayerTheme()
  );

  const updatePlayerTheme = (patch: Partial<PlayerThemeConfig>, keepPreset = false) => {
    const next = normalizePlayerTheme({
      ...activePlayerTheme,
      ...patch,
      presetId: keepPreset ? (patch.presetId ?? activePlayerTheme.presetId) : 'custom',
    });
    saveStoredPlayerTheme(next);
    setSettingsForm((prev) => ({ ...prev, playerTheme: next }));
  };

  // Pre-Publish Preview Modal state
  const [previewModalState, setPreviewModalState] = useState<{
    item: MediaItem;
    source: 'editor' | 'scraper' | 'site_scraper';
  } | null>(null);

  // Server Status Health Checker State
  const [serverStatuses, setServerStatuses] = useState<Record<string, ServerStatusEntry>>({});
  const serverStatusesRef = useRef<Record<string, ServerStatusEntry>>({});
  const [checkingCatalogLinks, setCheckingCatalogLinks] = useState(false);

  const checkServerUrls = useCallback(async (rawUrls: string[], force = false) => {
    const validUrls = Array.from(
      new Set(
        rawUrls
          .map((u) => u.trim())
          .filter((u) => /^https?:\/\//i.test(u))
      )
    );
    if (validUrls.length === 0) return;

    const currentMap = serverStatusesRef.current;
    const targetsToCheck = validUrls.filter((u) => {
      const existing = currentMap[u];
      if (!existing) return true;
      if (existing.status === 'checking') return false;
      return force;
    });
    if (targetsToCheck.length === 0) return;

    const checkingPatch: Record<string, ServerStatusEntry> = {};
    for (const u of targetsToCheck) {
      checkingPatch[u] = { status: 'checking', label: 'جاري الفحص...' };
    }
    serverStatusesRef.current = { ...serverStatusesRef.current, ...checkingPatch };
    setServerStatuses(serverStatusesRef.current);

    try {
      for (let i = 0; i < targetsToCheck.length; i += 35) {
        const chunk = targetsToCheck.slice(i, i + 35);
        let handledByApi = false;
        try {
          const response = await fetch(resolveApiEndpoint('/api/check-servers'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: chunk }),
          });
          const contentType = response.headers.get('content-type') || '';
          const data = contentType.includes('application/json')
            ? ((await response.json()) as {
                ok?: boolean;
                results?: Record<string, ServerStatusEntry>;
              })
            : null;
          if (response.ok && data?.ok && data.results) {
            serverStatusesRef.current = { ...serverStatusesRef.current, ...data.results };
            setServerStatuses(serverStatusesRef.current);
            handledByApi = true;
          }
        } catch {
          // Fall through to browser check when static hosting is active
        }

        if (!handledByApi) {
          const browserResults = await checkServerUrlsInBrowser(chunk);
          serverStatusesRef.current = { ...serverStatusesRef.current, ...browserResults };
          setServerStatuses(serverStatusesRef.current);
        }
      }
    } catch {
      const errPatch: Record<string, ServerStatusEntry> = {};
      for (const u of targetsToCheck) {
        errPatch[u] = { status: 'warning', label: 'تعذر الفحص', detail: 'تعذر التحقق من الرابط' };
      }
      serverStatusesRef.current = { ...serverStatusesRef.current, ...errPatch };
      setServerStatuses(serverStatusesRef.current);
    }
  }, []);

  // Automatically check server & episode watch URLs whenever editingItem opens or URLs change
  const editingServerUrlsKey = useMemo(() => {
    if (!editingItem) return '';
    const urls: string[] = [];
    (editingItem.servers || []).forEach((s) => {
      const u = resolveWatchServerUrl(s);
      if (/^https?:\/\//i.test(u)) urls.push(u);
    });
    (editingItem.seasons || []).forEach((se) => {
      (se.episodes || []).forEach((ep) => {
        const u = resolveWatchServerUrl(ep);
        if (/^https?:\/\//i.test(u)) urls.push(u);
      });
    });
    return urls.join('|');
  }, [editingItem]);

  useEffect(() => {
    if (!editingItem || !editingServerUrlsKey) return;
    const urls = editingServerUrlsKey.split('|').filter(Boolean);
    const timer = setTimeout(() => {
      void checkServerUrls(urls, false);
    }, 450);
    return () => clearTimeout(timer);
  }, [editingItem, editingServerUrlsKey, checkServerUrls]);

  const renderServerStatusBadge = (rawUrl: string, compact = false) => {
    const clean = (rawUrl || '').trim();
    if (!clean) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1 text-[11px] font-bold text-[#b7c9ef]/60">
          <span className="h-2 w-2 rounded-full bg-white/30" />
          <span>{compact ? 'فارغ' : 'لم يُضف رابط'}</span>
        </span>
      );
    }
    if (!/^https?:\/\//i.test(clean)) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#D92321]/15 border border-[#D92321]/40 px-2.5 py-1 text-[11px] font-bold text-[#ff8a88]">
          <span className="h-2 w-2 rounded-full bg-[#D92321]" />
          <span>صيغة غير صالحة</span>
        </span>
      );
    }
    const info = serverStatuses[clean];
    if (!info || info.status === 'checking') {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500/15 border border-sky-400/30 px-2.5 py-1 text-[11px] font-bold text-sky-300">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>جاري الفحص...</span>
        </span>
      );
    }

    const colorCls =
      info.status === 'working'
        ? 'bg-[#4CAF50]/15 border-[#4CAF50]/40 text-[#4CAF50]'
        : info.status === 'warning'
          ? 'bg-[#f9c400]/15 border-[#f9c400]/40 text-[#f9c400]'
          : 'bg-[#D92321]/15 border-[#D92321]/40 text-[#ff8a88]';

    const dotCls =
      info.status === 'working'
        ? 'bg-[#4CAF50]'
        : info.status === 'warning'
          ? 'bg-[#f9c400]'
          : 'bg-[#D92321]';

    return (
      <span
        title={info.detail || info.label}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-extrabold ${colorCls}`}
      >
        <span className={`h-2 w-2 rounded-full ${dotCls}`} />
        <span>{info.label}</span>
        {!compact && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void checkServerUrls([clean], true);
            }}
            title="إعادة فحص هذا الرابط الآن"
            className="mr-0.5 rounded p-0.5 hover:bg-black/20 cursor-pointer"
            aria-label="إعادة فحص السيرفر"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
      </span>
    );
  };

  const totalViews = useMemo(
    () => catalog.reduce((sum, item) => sum + (item.views || 0), 0),
    [catalog]
  );
  const pendingRequestsCount = useMemo(
    () => requests.filter((r) => r.status === 'pending').length,
    [requests]
  );

  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return catalog.filter((item) => {
      if (kindFilter !== 'all' && item.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.englishTitle.toLowerCase().includes(q) ||
        item.year.includes(q)
      );
    });
  }, [catalog, searchQuery, kindFilter]);

  const filteredRequests = useMemo(() => {
    if (reqStatusFilter === 'all') return requests;
    return requests.filter((r) => r.status === reqStatusFilter);
  }, [requests, reqStatusFilter]);

  const openEditorForNew = () => {
    const fresh = createEmptyMedia();
    setIsCreatingNew(true);
    setEditingItem(fresh);
    setEditorTab('basic');
    setCategoriesText(fresh.categories.join('، '));
    setGenresText(fresh.genres.join('، '));
  };

  const openEditorForExisting = (item: MediaItem) => {
    setIsCreatingNew(false);
    setEditingItem({
      ...item,
      servers: item.servers ? item.servers.map((s) => ({ ...s })) : [],
      downloads: item.downloads ? item.downloads.map((d) => ({ ...d })) : [],
      seasons: item.seasons
        ? item.seasons.map((se) => ({
            ...se,
            episodes: se.episodes.map((ep) => ({ ...ep })),
          }))
        : [],
      cast: item.cast ? item.cast.map((c) => ({ ...c })) : [],
    });
    setEditorTab('basic');
    setCategoriesText(item.categories.join('، '));
    setGenresText(item.genres.join('، '));
  };

  const openEditorWithScraped = (scraped: ScrapedPayload) => {
    const draft = scrapedToMediaItem(scraped);
    setIsCreatingNew(true);
    setEditingItem(draft);
    setEditorTab('basic');
    setCategoriesText(draft.categories.join('، '));
    setGenresText(draft.genres.join('، '));
  };

  const handleSeedDatabase = async () => {
    if (!user) return;
    const sourceToSeed = catalog.length > 0 ? catalog : CATALOG_ITEMS;
    setBusyAction(true);
    try {
      await seedCatalogToFirestore(sourceToSeed, user.uid);
      onNotify(`تم استيراد جميع الأعمال (${sourceToSeed.length} عمل) إلى قاعدة بيانات Firestore بنجاح`);
    } catch {
      onNotify('تعذر استيراد البيانات — تأكد من صلاحيات المشرف');
    } finally {
      setBusyAction(false);
    }
  };

  const buildFinalItemFromEditor = (): MediaItem | null => {
    if (!editingItem) return null;
    const parsedCats = categoriesText
      .split(/[،,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const parsedGenres = genresText
      .split(/[،,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const cleanedServers: StreamServer[] = (editingItem.servers || []).map((srv, idx) => ({
      id: srv.id || `srv-${Date.now()}-${idx}`,
      name: `سيرفر ${idx + 1}`,
      mode: srv.mode || (srv.embedCode ? 'embed' : 'url'),
      url: (srv.url || '').trim(),
      embedCode: (srv.embedCode || '').trim(),
      quality: (srv.quality || editingItem.quality || '1080p').trim(),
      speed: (srv.speed || 'سريع').trim(),
      tag: (srv.tag || 'HD').trim(),
    }));

    const cleanedDownloads: DownloadMirror[] = (editingItem.downloads || []).map((dl, idx) => ({
      id: dl.id || `dl-${Date.now()}-${idx}`,
      host: dl.host.trim() || `رابط تحميل ${idx + 1}`,
      quality: (dl.quality || editingItem.quality || '1080p').trim(),
      size: (dl.size || '1.5 GB').trim(),
      format: (dl.format || 'MP4').trim(),
      url: (dl.url || '').trim(),
    }));

    const cleanedCast: CastMember[] = (editingItem.cast || [])
      .filter((c) => c.name.trim().length > 0)
      .map((c) => ({
        name: c.name.trim(),
        role: c.role.trim() || 'ممثل',
        initials:
          c.initials?.trim() ||
          c.name
            .trim()
            .split(/\s+/)
            .map((p) => p[0])
            .join('')
            .slice(0, 2)
            .toUpperCase() ||
          'RT',
      }));

    return {
      ...editingItem,
      categories: parsedCats.length ? parsedCats : ['افلام'],
      genres: parsedGenres.length ? parsedGenres : ['دراما'],
      tagline: editingItem.tagline || editingItem.story.slice(0, 120),
      servers: cleanedServers,
      downloads: cleanedDownloads,
      cast: cleanedCast,
    };
  };

  const commitSaveEditorMedia = async () => {
    const finalItem = buildFinalItemFromEditor();
    if (!user || !finalItem) return;
    setBusyAction(true);
    try {
      const existsInDb = isFirestoreSeeded && !isCreatingNew;
      await saveMediaToFirestore(finalItem, user.uid, !existsInDb);
      onNotify(
        isCreatingNew
          ? 'تم نشر العمل الجديد وحفظ جميع السيرفرات والحلقات في قاعدة البيانات'
          : 'تم تحديث بيانات العمل في قاعدة البيانات بنجاح'
      );
      setPreviewModalState(null);
      setEditingItem(null);
    } catch {
      onNotify('حدث خطأ أثناء الحفظ في Firestore');
    } finally {
      setBusyAction(false);
    }
  };

  const handleSaveMedia = async (e: FormEvent) => {
    e.preventDefault();
    await commitSaveEditorMedia();
  };

  const handleOpenEditorPreview = () => {
    const draft = buildFinalItemFromEditor();
    if (!draft) return;
    setPreviewModalState({ item: draft, source: 'editor' });
  };

  const handleScrapeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setScrapeError(null);
    setScrapedResult(null);

    if (scrapeMode === 'url' && !scrapeUrl.trim()) {
      setScrapeError('يرجى إدخال رابط الصفحة المستهدفة أولاً.');
      return;
    }
    if (scrapeMode === 'html' && scrapeRawHtml.trim().length < 30) {
      setScrapeError('يرجى لصق كود HTML الكامل للصفحة (Ctrl+U ثم نسخ الكل).');
      return;
    }

    setScraping(true);
    try {
      const payload =
        scrapeMode === 'url'
          ? { url: scrapeUrl.trim() }
          : { rawHtml: scrapeRawHtml, url: scrapeUrl.trim() || undefined };

      let data: { ok?: boolean; error?: string; extracted?: ScrapedPayload } | null = null;
      let usedBackend = false;

      try {
        const response = await fetch(resolveApiEndpoint('/api/scrape'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const json = (await response.json()) as {
            ok?: boolean;
            error?: string;
            service?: string;
            extracted?: ScrapedPayload;
          };
          const isRealScrapeApi =
            Boolean(json && typeof json === 'object') &&
            json.service !== 'RahaL TV Proxy Worker' &&
            ('extracted' in json || (!response.ok && typeof json.error === 'string'));
          if (isRealScrapeApi) {
            data = json;
            usedBackend = true;
            if (!response.ok && data.error) {
              setScrapeError(data.error);
              return;
            }
          }
        }
      } catch {
        // Static hosting or unreachable backend -> fall back seamlessly to browser engine
      }

      if (!usedBackend || !data) {
        data = await scrapeSingleInBrowser(payload);
      }

      if (!data.ok || !data.extracted) {
        setScrapeError(
          data.error || 'تعذر سحب البيانات من الموقع المستهدف. جرّب وضع لصق HTML.'
        );
        return;
      }

      setScrapedResult({
        ...data.extracted,
        servers: renumberServers(data.extracted.servers || []),
      });
      setEditingScrapedServerIdx(null);
      const extractedUrls = (data.extracted.servers || [])
        .map((s) => resolveWatchServerUrl(s))
        .filter((u) => /^https?:\/\//i.test(u));
      if (extractedUrls.length > 0) {
        void checkServerUrls(extractedUrls, true);
      }
      onNotify(`تم استخراج "${data.extracted.title}" بنجاح!`);
    } catch {
      setScrapeError('تعذر تحليل الصفحة المستهدفة. جرّب استخدام وضع لصق كود HTML.');
    } finally {
      setScraping(false);
    }
  };

  const handlePublishScrapedDirectly = async () => {
    if (!user || !scrapedResult) return;
    setBusyAction(true);
    try {
      const item = scrapedToMediaItem(scrapedResult);
      await saveMediaToFirestore(item, user.uid, true);
      onNotify(`تم نشر "${item.title}" مباشرة في قاعدة البيانات!`);
      setActiveTab('catalog');
    } catch {
      onNotify('تعذر الحفظ المباشر — جرّب فتح العمل في المحرر ومراجعة الحقول.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleSiteScrapeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSiteCrawlError(null);
    setSiteCrawlMeta(null);
    setSiteScrapedItems([]);

    if (siteScrapeMode === 'url' && !siteCrawlUrl.trim()) {
      setSiteCrawlError('يرجى إدخال رابط الموقع أو القسم المستهدف أولاً.');
      return;
    }
    if (siteScrapeMode === 'html' && siteCrawlHtml.trim().length < 50) {
      setSiteCrawlError('يرجى لصق كود HTML للصفحة الرئيسية أو صفحة الأرشيف.');
      return;
    }

    setSiteCrawling(true);
    try {
      const payload = {
        siteUrl: siteCrawlUrl.trim() || undefined,
        rawHtml: siteScrapeMode === 'html' ? siteCrawlHtml : undefined,
        maxItems: siteMaxItems,
        maxPages: siteMaxPages,
        deepScrape: siteDeepScrape,
      };

      let data: {
        ok?: boolean;
        error?: string;
        strategy?: string;
        siteTitle?: string;
        totalDiscovered?: number;
        items?: ScrapedPayload[];
      } | null = null;
      let usedBackend = false;

      try {
        const response = await fetch(resolveApiEndpoint('/api/scrape-site'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const json = (await response.json()) as {
            ok?: boolean;
            error?: string;
            service?: string;
            strategy?: string;
            siteTitle?: string;
            totalDiscovered?: number;
            items?: ScrapedPayload[];
          };
          const isRealSiteApi =
            Boolean(json && typeof json === 'object') &&
            json.service !== 'RahaL TV Proxy Worker' &&
            (Array.isArray(json.items) || (!response.ok && typeof json.error === 'string'));
          if (isRealSiteApi) {
            data = json;
            usedBackend = true;
            if (!response.ok && data.error) {
              setSiteCrawlError(data.error);
              return;
            }
          }
        }
      } catch {
        // Static hosting or unreachable backend -> fall back seamlessly to browser engine
      }

      if (!usedBackend || !data) {
        data = await scrapeSiteInBrowser(payload);
      }

      if (!data.ok || !Array.isArray(data.items)) {
        setSiteCrawlError(
          data.error || 'تعذر سحب محتوى الموقع. جرّب استخدام وضع لصق كود HTML للصفحة الرئيسية.'
        );
        return;
      }

      setSiteCrawlMeta({
        strategy: data.strategy || 'HTML Crawler',
        siteTitle: data.siteTitle || siteCrawlUrl,
        totalDiscovered: data.totalDiscovered || data.items.length,
      });
      setSiteScrapedItems(
        data.items.map((item, idx) => ({
          ...item,
          tempKey: `site-item-${Date.now()}-${idx}`,
          selected: true,
        }))
      );
      onNotify(`تم جلب ${data.items.length} عملًا من الموقع بنجاح!`);
    } catch {
      setSiteCrawlError('تعذر سحب الموقع. جرّب وضع "لصق HTML الموقع".');
    } finally {
      setSiteCrawling(false);
    }
  };

  const selectedSiteItemsCount = useMemo(
    () => siteScrapedItems.filter((i) => i.selected).length,
    [siteScrapedItems]
  );

  const visibleSiteScrapedItems = useMemo(() => {
    if (siteKindFilter === 'all') return siteScrapedItems;
    return siteScrapedItems.filter((i) => i.kind === siteKindFilter);
  }, [siteScrapedItems, siteKindFilter]);

  const handleBulkPublishSelected = async () => {
    if (!user) return;
    const chosen = siteScrapedItems.filter((i) => i.selected);
    if (chosen.length === 0) {
      onNotify('يرجى تحديد عمل واحد على الأقل قبل النشر.');
      return;
    }

    setBusyAction(true);
    try {
      const prepared = chosen.map((item, idx) => scrapedToMediaItem(item, idx));
      const count = await bulkSaveMediaToFirestore(prepared, user.uid);
      onNotify(`تم نشر وحفظ ${count} عملًا في قاعدة بيانات Firestore دفعة واحدة!`);
      setSiteScrapedItems((prev) => prev.filter((i) => !i.selected));
      setActiveTab('catalog');
    } catch {
      onNotify('حدث خطأ أثناء الحفظ الجماعي في Firestore');
    } finally {
      setBusyAction(false);
    }
  };

  const handleTogglePin = async (item: MediaItem) => {
    if (!user) return;
    if (!isFirestoreSeeded) {
      onNotify('قم أولاً باستيراد المكتبة لقاعدة البيانات لتفعيل التعديلات المباشرة');
      return;
    }
    try {
      await saveMediaToFirestore({ ...item, pinned: !item.pinned }, user.uid, false);
      onNotify(
        !item.pinned ? `تم تثبيت "${item.title}" في السلايدر` : `تم إلغاء تثبيت "${item.title}"`
      );
    } catch {
      onNotify('تعذر تحديث حالة التثبيت');
    }
  };

  const handleDeleteMedia = async (id: string) => {
    if (!isFirestoreSeeded) {
      onDeleteStarterItems([id]);
      setConfirmDeleteId(null);
      setSelectedMediaIds((prev) => prev.filter((itemId) => itemId !== id));
      onNotify('تم حذف العمل المبدئي بنجاح');
      return;
    }

    setBusyAction(true);
    try {
      await deleteMediaFromFirestore(id);
      setConfirmDeleteId(null);
      setSelectedMediaIds((prev) => prev.filter((itemId) => itemId !== id));
      onNotify('تم حذف العمل من قاعدة البيانات نهائيًا');
    } catch {
      onNotify('تعذر حذف العمل');
    } finally {
      setBusyAction(false);
    }
  };

  const toggleMediaSelection = (id: string) => {
    setSelectedMediaIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSelectAllFiltered = () => {
    const filteredIds = filteredCatalog.map((item) => item.id);
    setSelectedMediaIds((prev) => Array.from(new Set([...prev, ...filteredIds])));
  };

  const handleSelectAllCatalog = () => {
    setSelectedMediaIds(catalog.map((item) => item.id));
  };

  const handleClearMediaSelection = () => {
    setSelectedMediaIds([]);
  };

  const handleConfirmBulkDelete = async () => {
    if (!confirmBulkDeleteMode) return;
    const targetIds =
      confirmBulkDeleteMode === 'all'
        ? catalog.map((item) => item.id)
        : selectedMediaIds.filter((id) => catalog.some((item) => item.id === id));

    if (targetIds.length === 0) {
      setConfirmBulkDeleteMode(null);
      return;
    }

    if (!isFirestoreSeeded) {
      if (confirmBulkDeleteMode === 'all') {
        onClearAllStarterItems();
      } else {
        onDeleteStarterItems(targetIds);
      }
      setSelectedMediaIds((prev) => prev.filter((id) => !targetIds.includes(id)));
      setConfirmBulkDeleteMode(null);
      onNotify(`تم حذف ${targetIds.length} عملًا من المحتوى المبدئي بنجاح`);
      return;
    }

    setBusyAction(true);
    try {
      const deletedCount = await bulkDeleteMediaFromFirestore(targetIds);
      if (confirmBulkDeleteMode === 'all') {
        onClearAllStarterItems();
      }
      setSelectedMediaIds((prev) => prev.filter((id) => !targetIds.includes(id)));
      setConfirmBulkDeleteMode(null);
      onNotify(`تم حذف ${deletedCount} عملًا من قاعدة بيانات Firestore نهائيًا`);
    } catch {
      onNotify('تعذر إتمام الحذف الجماعي — تأكد من صلاحيات المشرف');
    } finally {
      setBusyAction(false);
    }
  };

  const handleUpdateRequest = async (req: VisitorRequest) => {
    const draft = adminReplies[req.id] || { status: req.status, note: req.adminNote || '' };
    setBusyAction(true);
    try {
      await updateVisitorRequestInFirestore(req.id, draft.status, draft.note);
      onNotify(`تم تحديث حالة طلب "${req.title}"`);
    } catch {
      onNotify('تعذر تحديث حالة الطلب');
    } finally {
      setBusyAction(false);
    }
  };

  const handleDeleteRequest = async (id: string) => {
    setBusyAction(true);
    try {
      await deleteVisitorRequestFromFirestore(id);
      onNotify('تم حذف الطلب');
    } catch {
      onNotify('تعذر حذف الطلب');
    } finally {
      setBusyAction(false);
    }
  };

  const handleGrantAdmin = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !newAdminUid.trim()) return;
    setBusyAction(true);
    try {
      await grantAdminRoleInFirestore(newAdminUid, newAdminName, user.uid);
      setNewAdminUid('');
      setNewAdminName('');
      onNotify('تمت إضافة المشرف الجديد بصلاحية كاملة');
    } catch {
      onNotify('تعذر إضافة المشرف — تأكد من صحة معرف UID');
    } finally {
      setBusyAction(false);
    }
  };

  const handleCreateAdminAccount = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !createAdminEmail.trim() || createAdminPassword.length < 6) {
      setCreateAdminError('يرجى إدخال البريد/اسم المستخدم وكلمة مرور لا تقل عن 6 أحرف.');
      return;
    }
    setCreateAdminError(null);
    setCreatingAdmin(true);
    try {
      const created = await createAdminAccountInFirebase(
        createAdminEmail,
        createAdminPassword,
        createAdminName,
        user.uid
      );
      setCreateAdminName('');
      setCreateAdminEmail('');
      setCreateAdminPassword('');
      onNotify(`تم إنشاء حساب المشرف (${created.email}) ومنحه الصلاحية بنجاح!`);
    } catch (err: unknown) {
      setCreateAdminError(getFirebaseAuthErrorMessage(err));
    } finally {
      setCreatingAdmin(false);
    }
  };

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusyAction(true);
    try {
      const normalizedTheme = saveStoredPlayerTheme(activePlayerTheme);
      await saveSiteSettingsToFirestore(
        { ...settingsForm, playerTheme: normalizedTheme },
        user.uid
      );
      onNotify('تم حفظ الإعدادات وثيم المشغل الداخلي وتطبيقهما تلقائياً بنجاح');
    } catch {
      onNotify('تعذر حفظ الإعدادات');
    } finally {
      setBusyAction(false);
    }
  };

  const handleSavePlayerThemeOnly = async (themeToSave: PlayerThemeConfig) => {
    const clean = saveStoredPlayerTheme(themeToSave);
    setSettingsForm((prev) => ({ ...prev, playerTheme: clean }));
    if (!user) {
      onNotify('تم تطبيق الثيم محلياً — سجّل الدخول كمشرف لحفظه لكل الزوار');
      return;
    }
    setBusyAction(true);
    try {
      await saveSiteSettingsToFirestore({ ...settingsForm, playerTheme: clean }, user.uid);
      onNotify('تم حفظ وتطبيق ثيم المشغّل الداخلي تلقائياً على جميع مشغّلات الموقع!');
    } catch {
      onNotify('تعذر حفظ الثيم في قاعدة البيانات');
    } finally {
      setBusyAction(false);
    }
  };

  /* ---------------- Editor Sub-builders ---------------- */
  const addServerRow = () => {
    if (!editingItem) return;
    const current = editingItem.servers || [];
    const next: StreamServer = {
      id: `srv-${Date.now()}`,
      name: `سيرفر ${current.length + 1}`,
      mode: 'url',
      url: '',
      embedCode: '',
      quality: editingItem.quality || '1080p',
      speed: 'سريع',
      tag: 'HD',
    };
    setEditingItem({ ...editingItem, servers: renumberServers([...current, next]) });
  };

  const updateServerRow = (idx: number, patch: Partial<StreamServer>) => {
    if (!editingItem) return;
    const next = [...(editingItem.servers || [])];
    next[idx] = { ...next[idx], ...patch, name: `سيرفر ${idx + 1}` };
    setEditingItem({ ...editingItem, servers: next });
  };

  const removeServerRow = (idx: number) => {
    if (!editingItem) return;
    const remaining = (editingItem.servers || []).filter((_, i) => i !== idx);
    setEditingItem({
      ...editingItem,
      servers: renumberServers(remaining),
    });
  };

  const moveServerRow = (idx: number, direction: -1 | 1) => {
    if (!editingItem) return;
    const list = [...(editingItem.servers || [])];
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    const [moved] = list.splice(idx, 1);
    list.splice(targetIdx, 0, moved);
    setEditingItem({
      ...editingItem,
      servers: renumberServers(list),
    });
  };

  /* ---------------- Scraped Preview Server & Trailer Builders ---------------- */
  const addScrapedServerRow = () => {
    if (!scrapedResult) return;
    const nextIdx = (scrapedResult.servers || []).length;
    const nextSrv: StreamServer = {
      id: `srv-scraped-${Date.now()}`,
      name: `سيرفر ${nextIdx + 1}`,
      mode: 'url',
      url: '',
      embedCode: '',
      quality: scrapedResult.quality || '1080p',
      speed: 'سريع',
      tag: 'HD',
    };
    setScrapedResult({
      ...scrapedResult,
      servers: renumberServers([...(scrapedResult.servers || []), nextSrv]),
    });
    setEditingScrapedServerIdx(nextIdx);
  };

  const updateScrapedServerRow = (idx: number, patch: Partial<StreamServer>) => {
    if (!scrapedResult) return;
    const next = [...(scrapedResult.servers || [])];
    next[idx] = { ...next[idx], ...patch, name: `سيرفر ${idx + 1}` };
    setScrapedResult({ ...scrapedResult, servers: next });
  };

  const removeScrapedServerRow = (idx: number) => {
    if (!scrapedResult) return;
    const remaining = (scrapedResult.servers || []).filter((_, i) => i !== idx);
    setScrapedResult({
      ...scrapedResult,
      servers: renumberServers(remaining),
    });
    setEditingScrapedServerIdx((prev) => {
      if (prev === null) return null;
      if (prev === idx) return null;
      return prev > idx ? prev - 1 : prev;
    });
  };

  const moveScrapedServerRow = (idx: number, direction: -1 | 1) => {
    if (!scrapedResult) return;
    const list = [...(scrapedResult.servers || [])];
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    const [moved] = list.splice(idx, 1);
    list.splice(targetIdx, 0, moved);
    setScrapedResult({
      ...scrapedResult,
      servers: renumberServers(list),
    });
    setEditingScrapedServerIdx((prev) => {
      if (prev === idx) return targetIdx;
      if (prev === targetIdx) return idx;
      return prev;
    });
  };

  const handleAutoFetchTrailerForScraped = async () => {
    if (!scrapedResult || fetchingTrailer) return;
    setFetchingTrailer(true);
    try {
      const found = await findTrailerInBrowser({
        title: scrapedResult.title,
        englishTitle: scrapedResult.englishTitle,
        year: scrapedResult.year,
        kind: scrapedResult.kind,
      });
      if (found) {
        setScrapedResult((prev) => (prev ? { ...prev, trailerUrl: found } : prev));
        onNotify('تم جلب رابط التريلر تلقائياً!');
      } else {
        onNotify('لم يُعثر على تريلر تلقائي — يمكنك لصق رابط يوتيوب يدوياً');
      }
    } finally {
      setFetchingTrailer(false);
    }
  };

  const handleAutoFetchTrailerForEditor = async () => {
    if (!editingItem || fetchingTrailer) return;
    setFetchingTrailer(true);
    try {
      const found = await findTrailerInBrowser({
        title: editingItem.title,
        englishTitle: editingItem.englishTitle,
        year: editingItem.year,
        kind: editingItem.kind,
      });
      if (found) {
        setEditingItem((prev) => (prev ? { ...prev, trailerUrl: found } : prev));
        onNotify('تم جلب رابط التريلر تلقائياً!');
      } else {
        onNotify('لم يُعثر على تريلر تلقائي — يمكنك لصق رابط يوتيوب يدوياً');
      }
    } finally {
      setFetchingTrailer(false);
    }
  };

  const addDownloadRow = () => {
    if (!editingItem) return;
    const next: DownloadMirror = {
      id: `dl-${Date.now()}`,
      host: 'MediaFire / Direct',
      quality: editingItem.quality || '1080p',
      size: '1.8 GB',
      format: 'MP4',
      url: '',
    };
    setEditingItem({ ...editingItem, downloads: [...(editingItem.downloads || []), next] });
  };

  const updateDownloadRow = (idx: number, patch: Partial<DownloadMirror>) => {
    if (!editingItem) return;
    const next = [...(editingItem.downloads || [])];
    next[idx] = { ...next[idx], ...patch };
    setEditingItem({ ...editingItem, downloads: next });
  };

  const removeDownloadRow = (idx: number) => {
    if (!editingItem) return;
    setEditingItem({
      ...editingItem,
      downloads: (editingItem.downloads || []).filter((_, i) => i !== idx),
    });
  };

  const addSeason = () => {
    if (!editingItem) return;
    const current = editingItem.seasons || [];
    const nextNum = current.length + 1;
    const newSeason: SeasonItem = {
      seasonNumber: nextNum,
      label: `الموسم ${String(nextNum).padStart(2, '0')}`,
      year: editingItem.year || '2026',
      episodes: [
        {
          number: 1,
          title: 'الحلقة 01',
          duration: '45 دقيقة',
          quality: editingItem.quality || 'WEB-DL',
          watchUrl: '',
          embedCode: '',
        },
      ],
    };
    setEditingItem({ ...editingItem, seasons: [...current, newSeason] });
  };

  const removeSeason = (seasonIdx: number) => {
    if (!editingItem) return;
    setEditingItem({
      ...editingItem,
      seasons: (editingItem.seasons || []).filter((_, i) => i !== seasonIdx),
    });
  };

  const addEpisodeToSeason = (seasonIdx: number) => {
    if (!editingItem) return;
    const seasons = [...(editingItem.seasons || [])];
    const target = seasons[seasonIdx];
    const nextNum = target.episodes.length + 1;
    seasons[seasonIdx] = {
      ...target,
      episodes: [
        ...target.episodes,
        {
          number: nextNum,
          title: `الحلقة ${String(nextNum).padStart(2, '0')}`,
          duration: '45 دقيقة',
          quality: editingItem.quality || 'WEB-DL',
          watchUrl: '',
          embedCode: '',
        },
      ],
    };
    setEditingItem({ ...editingItem, seasons });
  };

  const generateEpisodesForSeason = (seasonIdx: number, count: number) => {
    if (!editingItem || count <= 0) return;
    const seasons = [...(editingItem.seasons || [])];
    const target = seasons[seasonIdx];
    const startNum = target.episodes.length + 1;
    const generated: EpisodeItem[] = Array.from({ length: Math.min(60, count) }, (_, i) => {
      const n = startNum + i;
      return {
        number: n,
        title: `الحلقة ${String(n).padStart(2, '0')}`,
        duration: '45 دقيقة',
        quality: editingItem.quality || 'WEB-DL',
        watchUrl: '',
        embedCode: '',
      };
    });
    seasons[seasonIdx] = {
      ...target,
      episodes: [...target.episodes, ...generated],
    };
    setEditingItem({ ...editingItem, seasons });
  };

  const updateEpisode = (seasonIdx: number, epIdx: number, patch: Partial<EpisodeItem>) => {
    if (!editingItem) return;
    const seasons = [...(editingItem.seasons || [])];
    const eps = [...seasons[seasonIdx].episodes];
    eps[epIdx] = { ...eps[epIdx], ...patch };
    seasons[seasonIdx] = { ...seasons[seasonIdx], episodes: eps };
    setEditingItem({ ...editingItem, seasons });
  };

  const removeEpisode = (seasonIdx: number, epIdx: number) => {
    if (!editingItem) return;
    const seasons = [...(editingItem.seasons || [])];
    seasons[seasonIdx] = {
      ...seasons[seasonIdx],
      episodes: seasons[seasonIdx].episodes.filter((_, i) => i !== epIdx),
    };
    setEditingItem({ ...editingItem, seasons });
  };

  const addCastMember = () => {
    if (!editingItem) return;
    setEditingItem({
      ...editingItem,
      cast: [...(editingItem.cast || []), { name: '', role: 'ممثل', initials: 'RT' }],
    });
  };

  const updateCastMember = (idx: number, patch: Partial<CastMember>) => {
    if (!editingItem) return;
    const next = [...(editingItem.cast || [])];
    next[idx] = { ...next[idx], ...patch };
    setEditingItem({ ...editingItem, cast: next });
  };

  const removeCastMember = (idx: number) => {
    if (!editingItem) return;
    setEditingItem({
      ...editingItem,
      cast: (editingItem.cast || []).filter((_, i) => i !== idx),
    });
  };

  /* ---------------- Standalone Auth / Access Gate ---------------- */
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#06131c] flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-3xl bg-[#0c1821] border border-white/10 p-10 text-center shadow-2xl">
          <Database className="w-10 h-10 text-[#D92321] mx-auto mb-3 animate-pulse" />
          <p className="text-sm font-bold text-[#b7c9ef]">
            جاري التحقق من صلاحيات المشرف والاتصال بقاعدة البيانات...
          </p>
        </div>
      </div>
    );
  }

  if (!user || !isAdmin) {
    return (
      <div className="min-h-screen bg-[#06131c] flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-3xl bg-[#0c1821] border border-white/10 p-8 shadow-2xl text-center space-y-5">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#D92321]/15 border border-[#D92321]/40 text-[#D92321]">
            <Lock className="w-8 h-8" />
          </div>

          <div>
            <span className="font-latin inline-block rounded-lg bg-white/5 border border-white/10 px-3 py-1 text-[11px] font-bold text-[#f9c400] mb-3">
              RahaL TV • /admin
            </span>
            <h1 className="font-display text-2xl font-extrabold text-white">
              بوابة إدارة RahaL TV المستقلة
            </h1>
            <p className="mt-2 text-sm text-[#b7c9ef] leading-relaxed">
              {!user
                ? 'سجّل الدخول بالبريد الإلكتروني (أو اسم المستخدم) وكلمة المرور للوصول إلى لوحة تحكم الإدارة.'
                : `الحساب الحالي (${user.email}) لا يمتلك صلاحيات المشرف بعد.`}
            </p>
          </div>

          {!user ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!adminLoginEmail.trim() || !adminLoginPassword) {
                  setAdminAuthError('يرجى إدخال اسم المستخدم/البريد الإلكتروني وكلمة المرور.');
                  return;
                }
                setAdminAuthError(null);
                setAdminSigningIn(true);
                try {
                  await signInWithEmailPassword(adminLoginEmail, adminLoginPassword);
                } catch (err: unknown) {
                  setAdminAuthError(getFirebaseAuthErrorMessage(err));
                } finally {
                  setAdminSigningIn(false);
                }
              }}
              className="space-y-3 text-right"
            >
              <div>
                <label className="block text-xs font-bold text-[#b7c9ef] mb-1.5">
                  البريد الإلكتروني أو اسم المستخدم
                </label>
                <input
                  type="text"
                  required
                  dir="ltr"
                  value={adminLoginEmail}
                  onChange={(e) => setAdminLoginEmail(e.target.value)}
                  placeholder="admin@rahaltv.com أو admin"
                  className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-4 py-3 text-sm text-white focus:border-[#D92321] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#b7c9ef] mb-1.5">
                  كلمة المرور
                </label>
                <input
                  type="password"
                  required
                  dir="ltr"
                  value={adminLoginPassword}
                  onChange={(e) => setAdminLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-4 py-3 text-sm text-white focus:border-[#D92321] focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={adminSigningIn}
                className="w-full inline-flex items-center justify-center gap-2.5 rounded-2xl bg-[#D92321] hover:bg-[#dc0e30] disabled:opacity-60 py-3.5 px-6 text-sm font-extrabold text-white shadow-lg transition-colors cursor-pointer"
              >
                {adminSigningIn ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <ShieldCheck className="w-5 h-5" />
                )}
                <span>{adminSigningIn ? 'جاري تسجيل الدخول...' : 'دخول إلى لوحة التحكم'}</span>
              </button>

              {adminAuthError && (
                <div className="rounded-xl bg-[#D92321]/15 border border-[#D92321]/40 p-3 text-xs leading-relaxed text-red-200">
                  {adminAuthError}
                </div>
              )}

              <p className="text-[11px] text-[#b7c9ef]/70 text-center leading-relaxed pt-1">
                إذا كتبت اسم مستخدم بدون @ سيتم إلحاق <span className="font-latin text-white/90">@rahaltv.com</span> تلقائيًا.
              </p>
            </form>
          ) : (
            <div className="space-y-3 text-right">
              <div className="rounded-xl bg-[#1a242e] p-3.5 text-xs text-[#b7c9ef] space-y-2">
                <p className="font-bold text-white">معرّف الحساب (UID) في Firebase:</p>
                <div className="flex items-center justify-between gap-2 rounded-lg bg-[#06131c] px-3 py-2 border border-white/10">
                  <span className="font-latin text-xs font-bold text-[#f9c400] select-all truncate" dir="ltr">
                    {user.uid}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(user.uid);
                      onNotify('تم نسخ UID بنجاح');
                    }}
                    className="shrink-0 rounded-md bg-white/10 hover:bg-white/20 px-2.5 py-1 text-[11px] font-bold text-white cursor-pointer"
                  >
                    نسخ
                  </button>
                </div>
                <p className="text-[11px] leading-relaxed text-[#b7c9ef]/85">
                  لتفعيل هذا الحساب كمدير رئيسي: أنشئ مستندًا في Firestore داخل مجموعة{' '}
                  <span className="font-latin text-white">admins</span> بنفس معرف الـ UID أعلاه، أو اطلب من المدير الحالي إضافتك من تبويب إدارة المشرفين.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void signOutFirebase()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#1a242e] hover:bg-[#D92321] border border-white/10 py-3 text-xs font-extrabold text-white transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>تسجيل الخروج / تبديل الحساب</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={onExitDashboard}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-[#b7c9ef] hover:text-white cursor-pointer"
          >
            <ArrowRight className="w-4 h-4" />
            <span>العودة إلى الموقع الرئيسي</span>
          </button>
        </div>
      </div>
    );
  }

  /* ---------------- Standalone Authenticated /admin Dashboard ---------------- */
  return (
    <div className="min-h-screen bg-[#06131c] text-white flex flex-col">
      {/* Dedicated Standalone Admin Top Bar */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0c1821]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1520px] flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#D92321] text-white shadow-lg">
              <LayoutDashboard className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-lg sm:text-xl font-extrabold text-white">
                  إدارة RahaL TV
                </h1>
                <span className="font-latin rounded-lg bg-[#f9c400]/15 border border-[#f9c400]/30 px-2 py-0.5 text-[10px] font-black text-[#f9c400]">
                  /admin
                </span>
                <span className="inline-flex items-center gap-1 rounded-lg bg-[#4CAF50]/15 border border-[#4CAF50]/35 px-2.5 py-0.5 text-[11px] font-extrabold text-[#4CAF50]">
                  <Database className="w-3 h-3" />
                  متصل بـ Firestore
                </span>
              </div>
              <p className="text-[11px] text-[#b7c9ef] hidden sm:block">
                لوحة إدارة مستقلة — نشر الأفلام والمسلسلات، السيرفرات، الحلقات، وجلب المحتوى الخارجي
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('site_scraper')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-[#f9c400]/20 border border-[#f9c400]/40 px-3.5 py-2 text-xs font-extrabold text-[#f9c400] cursor-pointer"
            >
              <Globe className="w-4 h-4" />
              <span className="hidden md:inline">جلب موقع بالكامل</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('scraper')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-[#4CAF50]/20 border border-[#4CAF50]/40 px-3.5 py-2 text-xs font-extrabold text-[#4CAF50] cursor-pointer"
            >
              <Wand2 className="w-4 h-4" />
              <span className="hidden md:inline">جلب عمل واحد</span>
            </button>

            <button
              type="button"
              onClick={openEditorForNew}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#D92321] hover:bg-[#dc0e30] px-4 py-2 text-xs font-extrabold text-white shadow-md cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة عمل جديد</span>
            </button>

            <button
              type="button"
              onClick={onExitDashboard}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3.5 py-2 text-xs font-bold text-white cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>معاينة الموقع</span>
            </button>

            <div className="hidden xl:flex items-center gap-2 rounded-xl bg-[#1a242e] border border-white/10 px-3 py-1.5">
              {user.photoURL && (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'Admin'}
                  referrerPolicy="no-referrer"
                  className="h-6 w-6 rounded-full object-cover"
                />
              )}
              <div className="text-right leading-tight">
                <p className="text-[11px] font-extrabold text-white truncate max-w-[120px]">
                  {user.displayName || 'مشرف'}
                </p>
                <p className="font-latin text-[10px] text-[#b7c9ef] truncate max-w-[140px]">
                  {user.email}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void signOutFirebase()}
                title="تسجيل الخروج"
                className="mr-1 rounded-lg p-1 text-[#b7c9ef] hover:bg-[#D92321] hover:text-white cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Split Workspace */}
      <div className="mx-auto w-full max-w-[1520px] flex-1 px-4 sm:px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Sidebar Navigation */}
          <aside className="lg:col-span-3 rounded-3xl bg-[#0c1821] border border-white/[0.08] p-3 space-y-1.5 lg:sticky lg:top-24">
            {(
              [
                { id: 'overview', label: 'نظرة عامة والإحصائيات', icon: BarChart3 },
                { id: 'catalog', label: `الأفلام والمسلسلات (${catalog.length})`, icon: Film },
                { id: 'scraper', label: 'جلب عمل واحد (رابط)', icon: Wand2 },
                {
                  id: 'site_scraper',
                  label: 'جلب موقع بالكامل (Crawler)',
                  icon: Globe,
                  badge: 'جديد',
                },
                {
                  id: 'requests',
                  label: `طلبات الزوار (${requests.length})`,
                  icon: MessageSquarePlus,
                  badge: pendingRequestsCount > 0 ? String(pendingRequestsCount) : undefined,
                },
                { id: 'users', label: `الأعضاء والمشرفين (${usersList.length})`, icon: Users },
                { id: 'settings', label: 'إعدادات المنصة', icon: Settings },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    if (tab.id === 'settings') setSettingsForm(siteSettings);
                  }}
                  className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#D92321] text-white shadow-md'
                      : 'text-[#b7c9ef] hover:bg-[#1a242e] hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{tab.label}</span>
                  </span>
                  {'badge' in tab && tab.badge ? (
                    <span className="rounded-md bg-[#f9c400] px-2 py-0.5 text-[10px] font-black text-[#06131c]">
                      {tab.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </aside>

          {/* Active Tab Workspace */}
          <div className="lg:col-span-9 space-y-6">
            {/* TAB 1: OVERVIEW */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {!isFirestoreSeeded && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-3xl bg-gradient-to-l from-[#D92321]/20 via-[#1a242e] to-[#0c1821] border border-[#D92321]/40 p-5">
                    <div>
                      <h2 className="font-display text-base font-extrabold text-white flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-[#f9c400]" />
                        تهيئة قاعدة البيانات لأول مرة
                      </h2>
                      <p className="text-xs text-[#b7c9ef] mt-1">
                        المكتبة المعروضة حاليًا هي البيانات المبدئية. اضغط لاستيراد الـ{' '}
                        {CATALOG_ITEMS.length} عملًا إلى Firestore لتتمكن من تعديلها وحذفها وحفظها فعليًا.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={handleSeedDatabase}
                      className="shrink-0 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-50 px-5 py-3 text-xs font-extrabold text-white shadow-lg cursor-pointer"
                    >
                      {busyAction ? 'جاري الاستيراد...' : 'استيراد المكتبة إلى Firestore الآن'}
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-5">
                    <div className="flex items-center justify-between text-xs text-[#b7c9ef] mb-2">
                      <span>إجمالي الأعمال</span>
                      <Film className="w-4 h-4 text-[#D92321]" />
                    </div>
                    <p className="text-3xl font-black text-white tabular-nums">{catalog.length}</p>
                    <p className="text-[11px] text-[#4CAF50] mt-1 font-bold">
                      {isFirestoreSeeded ? 'محفوظة في Firestore' : 'بيانات مبدئية'}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-5">
                    <div className="flex items-center justify-between text-xs text-[#b7c9ef] mb-2">
                      <span>إجمالي المشاهدات</span>
                      <Eye className="w-4 h-4 text-[#f9c400]" />
                    </div>
                    <p className="text-3xl font-black text-white tabular-nums">
                      {totalViews.toLocaleString('en-US')}
                    </p>
                    <p className="text-[11px] text-[#b7c9ef] mt-1">عبر جميع الأقسام</p>
                  </div>

                  <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-5">
                    <div className="flex items-center justify-between text-xs text-[#b7c9ef] mb-2">
                      <span>طلبات بانتظار المراجعة</span>
                      <MessageSquarePlus className="w-4 h-4 text-[#f9c400]" />
                    </div>
                    <p className="text-3xl font-black text-white tabular-nums">
                      {pendingRequestsCount}
                    </p>
                    <p className="text-[11px] text-[#b7c9ef] mt-1">من أصل {requests.length} طلب</p>
                  </div>

                  <div className="rounded-2xl bg-[#0c1821] border border-white/[0.08] p-5">
                    <div className="flex items-center justify-between text-xs text-[#b7c9ef] mb-2">
                      <span>الأعضاء المسجلون</span>
                      <Users className="w-4 h-4 text-[#4CAF50]" />
                    </div>
                    <p className="text-3xl font-black text-white tabular-nums">{usersList.length}</p>
                    <p className="text-[11px] text-[#b7c9ef] mt-1">
                      مشرفون إضافيون: {adminsList.length}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-4">
                    <h2 className="font-display text-base font-extrabold text-white">
                      توزيع المكتبة حسب النوع
                    </h2>
                    {(['movie', 'series', 'tv', 'wrestling'] as MediaKind[]).map((kind) => {
                      const count = catalog.filter((c) => c.kind === kind).length;
                      const pct = catalog.length ? Math.round((count / catalog.length) * 100) : 0;
                      return (
                        <div key={kind} className="space-y-1.5">
                          <div className="flex justify-between text-xs font-bold">
                            <span className="text-white">{KIND_LABELS[kind]}</span>
                            <span className="text-[#b7c9ef] tabular-nums">
                              {count} ({pct}%)
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-[#1a242e] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[#D92321]"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5">
                    <h2 className="font-display text-base font-extrabold text-white mb-4">
                      الأعمال الأعلى تقييمًا (IMDb)
                    </h2>
                    <div className="space-y-2.5">
                      {[...catalog]
                        .sort((a, b) => b.imdb - a.imdb)
                        .slice(0, 5)
                        .map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between gap-3 rounded-2xl bg-[#1a242e]/65 p-2.5"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <img
                                src={item.poster}
                                alt={item.title}
                                className="h-12 w-9 rounded-lg object-cover shrink-0"
                              />
                              <div className="min-w-0">
                                <p className="text-xs font-extrabold text-white truncate">
                                  {item.title}
                                </p>
                                <p className="text-[11px] text-[#b7c9ef]">
                                  {item.year} • {item.quality}
                                </p>
                              </div>
                            </div>
                            <span className="inline-flex items-center gap-1 rounded-lg bg-[#f9c400]/15 px-2.5 py-1 text-xs font-black text-[#f9c400] tabular-nums">
                              <Star className="w-3.5 h-3.5 fill-current" />
                              {item.imdb.toFixed(1)}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: CATALOG MANAGEMENT */}
            {activeTab === 'catalog' && (
              <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-[#D92321] absolute right-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="ابحث باسم الفيلم أو المسلسل أو السنة..."
                      className="w-full rounded-xl bg-[#1a242e] border border-white/10 pr-10 pl-4 py-2.5 text-xs font-bold text-white focus:border-[#D92321] focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={kindFilter}
                      onChange={(e) => setKindFilter(e.target.value)}
                      aria-label="تصفية حسب النوع"
                      className="rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2.5 text-xs font-bold text-white focus:outline-none"
                    >
                      <option value="all">كل الأنواع</option>
                      <option value="movie">أفلام</option>
                      <option value="series">مسلسلات</option>
                      <option value="tv">برامج ومسرحيات</option>
                      <option value="wrestling">مصارعة حرة</option>
                    </select>

                    <button
                      type="button"
                      disabled={checkingCatalogLinks || filteredCatalog.length === 0}
                      onClick={async () => {
                        const urls = filteredCatalog
                          .slice(0, 20)
                          .flatMap((it) => (it.servers || []).map((s) => resolveWatchServerUrl(s)))
                          .filter((u) => /^https?:\/\//i.test(u));
                        if (urls.length === 0) {
                          onNotify('لا توجد روابط مشاهدة لفحصها في النتائج المعروضة');
                          return;
                        }
                        setCheckingCatalogLinks(true);
                        await checkServerUrls(urls, true);
                        setCheckingCatalogLinks(false);
                        onNotify(`تم فحص ${Math.min(urls.length, 40)} رابط مشاهدة`);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-sky-500/20 border border-sky-400/30 disabled:opacity-40 px-3.5 py-2.5 text-xs font-extrabold text-sky-300 cursor-pointer"
                    >
                      {checkingCatalogLinks ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      <span>فحص حالة السيرفرات</span>
                    </button>

                    <button
                      type="button"
                      onClick={openEditorForNew}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#D92321] hover:bg-[#dc0e30] px-4 py-2.5 text-xs font-extrabold text-white cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>إضافة فيلم / مسلسل</span>
                    </button>

                    {!isFirestoreSeeded && catalog.length > 0 && (
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={handleSeedDatabase}
                        className="rounded-xl bg-[#4CAF50] hover:bg-[#43a047] px-3.5 py-2.5 text-xs font-extrabold text-white cursor-pointer"
                      >
                        استيراد المبدئي لـ Firestore
                      </button>
                    )}
                  </div>
                </div>

                {/* Bulk Selection & Mass Delete Toolbar */}
                {filteredCatalog.length > 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#1a242e]/75 border border-white/10 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSelectAllFiltered}
                        className="rounded-xl bg-[#0c1821] hover:bg-white/10 border border-white/10 px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
                      >
                        تحديد المعروض ({filteredCatalog.length})
                      </button>

                      {catalog.length > filteredCatalog.length && (
                        <button
                          type="button"
                          onClick={handleSelectAllCatalog}
                          className="rounded-xl bg-[#0c1821] hover:bg-white/10 border border-white/10 px-3 py-1.5 text-xs font-bold text-[#f9c400] cursor-pointer"
                        >
                          تحديد كل المكتبة ({catalog.length})
                        </button>
                      )}

                      {selectedMediaIds.length > 0 && (
                        <button
                          type="button"
                          onClick={handleClearMediaSelection}
                          className="rounded-xl bg-[#0c1821] hover:bg-white/10 border border-white/10 px-3 py-1.5 text-xs font-bold text-[#b7c9ef] cursor-pointer"
                        >
                          إلغاء التحديد
                        </button>
                      )}

                      <span className="rounded-lg bg-[#0c1821] px-2.5 py-1 text-[11px] font-extrabold text-[#b7c9ef] tabular-nums">
                        المحدد: <strong className="text-white">{selectedMediaIds.length}</strong>
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busyAction || selectedMediaIds.length === 0}
                        onClick={() => setConfirmBulkDeleteMode('selected')}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#D92321] hover:bg-[#dc0e30] disabled:opacity-40 px-3.5 py-1.5 text-xs font-extrabold text-white cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>حذف المحدد ({selectedMediaIds.length})</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyAction || catalog.length === 0}
                        onClick={() => setConfirmBulkDeleteMode('all')}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#D92321]/15 hover:bg-[#D92321] border border-[#D92321]/50 disabled:opacity-40 px-3.5 py-1.5 text-xs font-extrabold text-[#ff8a88] hover:text-white transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>حذف كل المحتوى ({catalog.length})</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl bg-[#1a242e]/50 border border-dashed border-white/15 p-8 text-center space-y-3">
                    <p className="text-sm font-extrabold text-white">
                      {catalog.length === 0
                        ? 'لا يوجد أي محتوى حاليًا في المنصة'
                        : 'لا توجد نتائج تطابق بحثك الحالي'}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setActiveTab('site_scraper')}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#f9c400] px-4 py-2 text-xs font-black text-[#06131c] cursor-pointer"
                      >
                        <Globe className="w-3.5 h-3.5" />
                        <span>جلب محتوى من موقع بالكامل</span>
                      </button>
                      {!isFirestoreSeeded && hasDismissedStarters && (
                        <button
                          type="button"
                          onClick={() => {
                            onRestoreStarterItems();
                            onNotify('تمت استعادة المحتوى الافتراضي المبدئي');
                          }}
                          className="rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/15 px-4 py-2 text-xs font-bold text-[#b7c9ef] cursor-pointer"
                        >
                          استعادة المحتوى المبدئي
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-right border-collapse">
                    <thead>
                      <tr className="border-b border-white/10 text-[11px] font-extrabold text-[#b7c9ef]">
                        <th className="py-3 px-2 w-10 text-center">
                          <input
                            type="checkbox"
                            aria-label="تحديد أو إلغاء تحديد كل المعروض"
                            checked={
                              filteredCatalog.length > 0 &&
                              filteredCatalog.every((item) => selectedMediaIds.includes(item.id))
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                handleSelectAllFiltered();
                              } else {
                                const filteredSet = new Set(filteredCatalog.map((i) => i.id));
                                setSelectedMediaIds((prev) => prev.filter((id) => !filteredSet.has(id)));
                              }
                            }}
                            className="h-4 w-4 accent-[#D92321] cursor-pointer"
                          />
                        </th>
                        <th className="py-3 px-2">العمل</th>
                        <th className="py-3 px-2">النوع</th>
                        <th className="py-3 px-2">السيرفرات / التحميل</th>
                        <th className="py-3 px-2">IMDb</th>
                        <th className="py-3 px-2">مثبت</th>
                        <th className="py-3 px-2 text-left">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06] text-xs">
                      {filteredCatalog.map((item) => {
                        const isSelected = selectedMediaIds.includes(item.id);
                        return (
                        <tr
                          key={item.id}
                          className={`transition-colors ${
                            isSelected ? 'bg-[#D92321]/[0.08]' : 'hover:bg-white/[0.02]'
                          }`}
                        >
                          <td className="py-3 px-2 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleMediaSelection(item.id)}
                              aria-label={`تحديد ${item.title}`}
                              className="h-4 w-4 accent-[#D92321] cursor-pointer"
                            />
                          </td>
                          <td className="py-3 px-2">
                            <div className="flex items-center gap-3">
                              <img
                                src={item.poster}
                                alt={item.title}
                                className="h-14 w-10 rounded-lg object-cover shrink-0"
                              />
                              <div className="min-w-0 max-w-[230px]">
                                <p className="font-extrabold text-white truncate">{item.title}</p>
                                <p className="text-[11px] text-[#b7c9ef] truncate">
                                  {item.quality} • {item.year}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-2">
                            <span className="rounded-lg bg-[#1a242e] px-2.5 py-1 text-[11px] font-bold text-[#b7c9ef]">
                              {KIND_LABELS[item.kind]}
                            </span>
                          </td>
                          <td className="py-3 px-2 font-bold text-[#b7c9ef] tabular-nums space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span>
                                {item.servers?.length || 0} سيرفر • {item.downloads?.length || 0} تحميل
                                {item.seasons && item.seasons.length > 0
                                  ? ` • ${item.seasons.reduce((a, s) => a + s.episodes.length, 0)} حلقة`
                                  : ''}
                              </span>
                              {(item.servers || []).some((s) => /^https?:\/\//i.test(resolveWatchServerUrl(s))) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const urls = (item.servers || [])
                                      .map((s) => resolveWatchServerUrl(s))
                                      .filter((u) => /^https?:\/\//i.test(u));
                                    void checkServerUrls(urls, true);
                                  }}
                                  title="فحص روابط سيرفرات هذا العمل"
                                  className="inline-flex items-center gap-1 rounded-md bg-white/5 hover:bg-sky-500/20 border border-white/10 px-1.5 py-0.5 text-[10px] font-bold text-sky-300 cursor-pointer"
                                >
                                  <RefreshCw className="w-2.5 h-2.5" />
                                  <span>فحص</span>
                                </button>
                              )}
                            </div>
                            {(() => {
                              const urls = (item.servers || [])
                                .map((s) => resolveWatchServerUrl(s))
                                .filter((u) => /^https?:\/\//i.test(u));
                              const checked = urls.map((u) => serverStatuses[u]).filter(Boolean);
                              if (checked.length === 0) return null;
                              const workingCount = checked.filter((c) => c.status === 'working').length;
                              const warnCount = checked.filter((c) => c.status === 'warning').length;
                              const brokenCount = checked.filter((c) => c.status === 'broken').length;
                              const checkingCount = checked.filter((c) => c.status === 'checking').length;
                              return (
                                <div className="flex flex-wrap items-center gap-1 text-[10px] font-extrabold">
                                  {checkingCount > 0 && (
                                    <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300">
                                      جاري الفحص ({checkingCount})
                                    </span>
                                  )}
                                  {workingCount > 0 && (
                                    <span className="rounded bg-[#4CAF50]/15 px-1.5 py-0.5 text-[#4CAF50]">
                                      ● {workingCount} يعمل
                                    </span>
                                  )}
                                  {warnCount > 0 && (
                                    <span className="rounded bg-[#f9c400]/15 px-1.5 py-0.5 text-[#f9c400]">
                                      ● {warnCount} تحذير تضمين
                                    </span>
                                  )}
                                  {brokenCount > 0 && (
                                    <span className="rounded bg-[#D92321]/20 px-1.5 py-0.5 text-[#ff8a88]">
                                      ● {brokenCount} معطل
                                    </span>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="py-3 px-2 font-black text-[#f9c400] tabular-nums">
                            ★ {item.imdb.toFixed(1)}
                          </td>
                          <td className="py-3 px-2">
                            <button
                              type="button"
                              onClick={() => handleTogglePin(item)}
                              aria-label="تبديل التثبيت"
                              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors cursor-pointer ${
                                item.pinned
                                  ? 'bg-[#f9c400] border-[#f9c400] text-[#06131c]'
                                  : 'bg-[#1a242e] border-white/10 text-[#b7c9ef]'
                              }`}
                            >
                              <Pin className="w-3.5 h-3.5" />
                            </button>
                          </td>
                          <td className="py-3 px-2">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => onPreviewMedia(item)}
                                aria-label="معاينة"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#1a242e] text-[#b7c9ef] hover:text-white cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditorForExisting(item)}
                                aria-label="تعديل"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#1a242e] text-sky-300 hover:bg-sky-500 hover:text-white cursor-pointer"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(item.id)}
                                aria-label="حذف"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#1a242e] text-[#D92321] hover:bg-[#D92321] hover:text-white cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 3: EXTERNAL CONTENT SCRAPER */}
            {activeTab === 'scraper' && (
              <div className="space-y-6">
                <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
                    <div>
                      <h2 className="font-display text-lg font-extrabold text-white flex items-center gap-2">
                        <Wand2 className="w-5 h-5 text-[#4CAF50]" />
                        أداة جلب وسحب المحتوى من المواقع الأخرى
                      </h2>
                      <p className="text-xs text-[#b7c9ef] mt-1">
                        ضع رابط صفحة الفيلم أو المسلسل على أي موقع آخر وسيتم استخراج البوستر، القصة،
                        التقييم، التصنيفات، أكواد iframe للسيرفرات، روابط التحميل، والحلقات تلقائيًا.
                      </p>
                    </div>

                    <div className="flex rounded-xl bg-[#1a242e] p-1 border border-white/10 shrink-0">
                      <button
                        type="button"
                        onClick={() => setScrapeMode('url')}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-extrabold cursor-pointer ${
                          scrapeMode === 'url'
                            ? 'bg-[#D92321] text-white'
                            : 'text-[#b7c9ef] hover:text-white'
                        }`}
                      >
                        <Globe className="w-3.5 h-3.5" />
                        <span>جلب بالرابط (URL)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setScrapeMode('html')}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-extrabold cursor-pointer ${
                          scrapeMode === 'html'
                            ? 'bg-[#D92321] text-white'
                            : 'text-[#b7c9ef] hover:text-white'
                        }`}
                      >
                        <Code2 className="w-3.5 h-3.5" />
                        <span>لصق كود HTML</span>
                      </button>
                    </div>
                  </div>

                  <form onSubmit={handleScrapeSubmit} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-[#b7c9ef] mb-1.5">
                        {scrapeMode === 'url'
                          ? 'رابط صفحة الفيلم أو المسلسل في الموقع المصدر'
                          : 'رابط الصفحة المصدر (اختياري - لحل المسارات النسبية)'}
                      </label>
                      <input
                        type="url"
                        dir="ltr"
                        required={scrapeMode === 'url'}
                        value={scrapeUrl}
                        onChange={(e) => setScrapeUrl(e.target.value)}
                        placeholder="https://example.com/movie/running-man-2026"
                        className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-4 py-3 text-sm text-white focus:border-[#4CAF50] focus:outline-none"
                      />
                    </div>

                    {scrapeMode === 'html' && (
                      <div>
                        <label className="block text-xs font-bold text-[#b7c9ef] mb-1.5">
                          كود الصفحة المصدر (HTML / View-Source) — مفيد إذا كان الموقع محميًا بـ Cloudflare
                        </label>
                        <textarea
                          rows={7}
                          dir="ltr"
                          required
                          value={scrapeRawHtml}
                          onChange={(e) => setScrapeRawHtml(e.target.value)}
                          placeholder="<!DOCTYPE html><html>... الصق كود السورس هنا ..."
                          className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 p-3.5 text-xs text-white focus:border-[#4CAF50] focus:outline-none"
                        />
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="submit"
                        disabled={scraping}
                        className="inline-flex items-center gap-2 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-60 px-6 py-3 text-xs font-extrabold text-white shadow-lg cursor-pointer"
                      >
                        {scraping ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Wand2 className="w-4 h-4" />
                        )}
                        <span>{scraping ? 'جاري تحليل واستخراج البيانات...' : 'استخراج البيانات الآن'}</span>
                      </button>
                    </div>
                  </form>

                  {scrapeError && (
                    <div className="rounded-2xl bg-[#D92321]/15 border border-[#D92321]/40 p-4 text-xs font-bold text-[#ff8a88] space-y-2.5">
                      <p>{scrapeError}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        {scrapeMode === 'url' && (
                          <button
                            type="button"
                            onClick={() => setScrapeMode('html')}
                            className="inline-flex items-center gap-1 rounded-lg bg-[#D92321] px-3 py-1.5 text-[11px] font-extrabold text-white cursor-pointer"
                          >
                            <Code2 className="w-3.5 h-3.5" />
                            <span>التبديل إلى وضع لصق كود HTML</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setActiveTab('settings')}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#f9c400] hover:bg-[#dfb20b] px-3 py-1.5 text-[11px] font-black text-[#06131c] cursor-pointer"
                        >
                          <Settings className="w-3.5 h-3.5" />
                          <span>إعداد بروكسي Cloudflare المجاني في الإعدادات</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Scraped Results Preview */}
                {scrapedResult && (
                  <div className="rounded-3xl bg-[#0c1821] border border-[#4CAF50]/40 p-6 space-y-5 shadow-2xl">
                    <div className="flex flex-col md:flex-row gap-5">
                      {scrapedResult.poster ? (
                        <img
                          src={scrapedResult.poster}
                          alt={scrapedResult.title}
                          className="h-64 w-44 rounded-2xl object-cover border border-white/10 shrink-0"
                        />
                      ) : (
                        <div className="h-64 w-44 rounded-2xl bg-[#1a242e] flex items-center justify-center text-xs text-[#b7c9ef] shrink-0">
                          لا يوجد بوستر
                        </div>
                      )}

                      <div className="flex-1 space-y-3 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-lg bg-[#D92321] px-2.5 py-1 text-[11px] font-black text-white">
                            {KIND_LABELS[scrapedResult.kind]}
                          </span>
                          <span className="rounded-lg bg-[#f9c400]/15 px-2.5 py-1 text-[11px] font-black text-[#f9c400]">
                            ★ IMDb {scrapedResult.imdb}
                          </span>
                          <span className="rounded-lg bg-[#1a242e] px-2.5 py-1 text-[11px] font-bold text-white">
                            {scrapedResult.year} • {scrapedResult.quality}
                          </span>
                          <span className="rounded-lg bg-[#1a242e] px-2.5 py-1 text-[11px] font-bold text-[#b7c9ef]">
                            {scrapedResult.duration}
                          </span>
                        </div>

                        <h3 className="font-display text-xl font-extrabold text-white">
                          {scrapedResult.title}
                        </h3>
                        <p className="font-latin text-xs text-[#b7c9ef]">{scrapedResult.englishTitle}</p>

                        <p className="text-xs leading-relaxed text-[#b7c9ef] line-clamp-4">
                          {scrapedResult.story}
                        </p>

                        <div className="flex flex-wrap gap-1.5">
                          {scrapedResult.categories.map((c) => (
                            <span
                              key={c}
                              className="rounded-md bg-[#1a242e] border border-white/10 px-2 py-0.5 text-[11px] font-bold text-white"
                            >
                              {c}
                            </span>
                          ))}
                          {scrapedResult.genres.map((g) => (
                            <span
                              key={g}
                              className="rounded-md bg-[#D92321]/15 border border-[#D92321]/30 px-2 py-0.5 text-[11px] font-bold text-[#ff8a88]"
                            >
                              {g}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Extracted Trailer Control Bar */}
                    <div className="rounded-2xl bg-[#1a242e]/85 border border-[#D92321]/30 p-3.5 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-extrabold text-white flex items-center gap-2">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[#D92321] text-white">
                            <Play className="w-3 h-3 fill-current" />
                          </span>
                          <span>تريلر العمل (Trailer)</span>
                          {scrapedResult.trailerUrl ? (
                            <span className="rounded-md bg-[#4CAF50]/15 border border-[#4CAF50]/35 px-2 py-0.5 text-[10px] font-bold text-[#4CAF50]">
                              مُستخرج تلقائياً
                            </span>
                          ) : (
                            <span className="rounded-md bg-[#f9c400]/15 border border-[#f9c400]/35 px-2 py-0.5 text-[10px] font-bold text-[#f9c400]">
                              غير متوفر بالصفحة
                            </span>
                          )}
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={fetchingTrailer}
                            onClick={() => void handleAutoFetchTrailerForScraped()}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#D92321] hover:bg-[#dc0e30] disabled:opacity-50 px-3 py-1.5 text-[11px] font-extrabold text-white cursor-pointer"
                          >
                            {fetchingTrailer ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Wand2 className="w-3.5 h-3.5" />
                            )}
                            <span>{fetchingTrailer ? 'جاري البحث...' : 'جلب التريلر تلقائياً'}</span>
                          </button>
                          {scrapedResult.trailerUrl && (
                            <a
                              href={scrapedResult.trailerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-lg bg-[#0c1821] border border-white/10 px-2.5 py-1.5 text-[11px] font-bold text-[#b7c9ef] hover:text-white"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>تجربة</span>
                            </a>
                          )}
                        </div>
                      </div>
                      <input
                        type="text"
                        dir="ltr"
                        value={scrapedResult.trailerUrl || ''}
                        onChange={(e) =>
                          setScrapedResult({ ...scrapedResult, trailerUrl: e.target.value })
                        }
                        placeholder="https://www.youtube.com/watch?v=... أو رابط MP4"
                        className="font-latin w-full rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-xs text-white focus:border-[#D92321] focus:outline-none"
                      />
                    </div>

                    {/* Extracted Assets Summary + Full Interactive Server Manager */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-2 border-t border-white/10">
                      {/* Full Interactive Watch Servers Manager */}
                      <div className="lg:col-span-7 rounded-2xl bg-[#1a242e]/85 border border-white/10 p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs sm:text-sm font-extrabold text-white flex items-center gap-2">
                            <Server className="w-4 h-4 text-[#D92321]" />
                            <span>إدارة سيرفرات المشاهدة ({scrapedResult.servers.length})</span>
                          </p>
                          <div className="flex items-center gap-1.5">
                            {scrapedResult.servers.length > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const urls = scrapedResult.servers
                                    .map((s) => resolveWatchServerUrl(s))
                                    .filter((u) => /^https?:\/\//i.test(u));
                                  void checkServerUrls(urls, true);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg bg-[#0c1821] border border-sky-400/30 px-2.5 py-1 text-[11px] font-bold text-sky-300 hover:bg-sky-500/15 cursor-pointer"
                              >
                                <RefreshCw className="w-3 h-3" />
                                <span>فحص</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={addScrapedServerRow}
                              className="inline-flex items-center gap-1 rounded-lg bg-[#4CAF50] hover:bg-[#43a047] px-2.5 py-1 text-[11px] font-extrabold text-white cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>إضافة سيرفر</span>
                            </button>
                          </div>
                        </div>

                        {scrapedResult.servers.length === 0 ? (
                          <div className="space-y-1.5 rounded-xl bg-[#0c1821]/60 p-3">
                            <p className="text-[11px] text-[#b7c9ef]">
                              لم يُعثر على سيرفرات صالحة في الصفحة (أو تم استبعاد روابط الصفحات الرئيسية تلقائياً).
                            </p>
                            {!customApiUrl && (
                              <p className="text-[10px] leading-relaxed text-[#f9c400]/90">
                                بعض المواقع تضع السيرفرات في صفحة <span className="font-latin">/watch</span> منفصلة؛ فعّل{' '}
                                <button
                                  type="button"
                                  onClick={() => setActiveTab('settings')}
                                  className="underline font-bold cursor-pointer"
                                >
                                  Cloudflare Worker المجاني
                                </button>{' '}
                                في الإعدادات لجلبها تلقائياً من GitHub Pages.
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                            {scrapedResult.servers.map((s, idx) => {
                              const srvUrl = resolveWatchServerUrl(s);
                              const isPortal = Boolean(srvUrl && isLikelyNonVideoWebsiteUrl(srvUrl));
                              const isEditingThis = editingScrapedServerIdx === idx;
                              const srvMode = s.mode || (s.embedCode ? 'embed' : 'url');
                              return (
                                <div
                                  key={s.id || idx}
                                  className={`rounded-xl border p-2.5 space-y-2 ${
                                    isPortal
                                      ? 'bg-[#D92321]/10 border-[#D92321]/45'
                                      : 'bg-[#0c1821]/85 border-white/10'
                                  }`}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                                      <span className="inline-flex items-center gap-1 rounded-lg bg-[#D92321] px-2.5 py-0.5 text-[11px] font-black text-white tabular-nums">
                                        سيرفر {idx + 1}
                                      </span>
                                      <span className="font-latin rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-[#f9c400]">
                                        {s.quality || 'HD'}
                                      </span>
                                      {renderServerStatusBadge(srvUrl, true)}
                                      {isPortal && (
                                        <span className="rounded bg-[#D92321]/25 px-1.5 py-0.5 text-[10px] font-bold text-[#ff8a88]">
                                          صفحة موقع وليست فيديو
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        disabled={idx === 0}
                                        onClick={() => moveScrapedServerRow(idx, -1)}
                                        title="تحريك لأعلى"
                                        className="rounded-md bg-[#1a242e] p-1 text-[#b7c9ef] hover:text-white disabled:opacity-30 cursor-pointer"
                                      >
                                        <ArrowUp className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={idx === scrapedResult.servers.length - 1}
                                        onClick={() => moveScrapedServerRow(idx, 1)}
                                        title="تحريك لأسفل"
                                        className="rounded-md bg-[#1a242e] p-1 text-[#b7c9ef] hover:text-white disabled:opacity-30 cursor-pointer"
                                      >
                                        <ArrowDown className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setEditingScrapedServerIdx(isEditingThis ? null : idx)
                                        }
                                        title="تعديل السيرفر"
                                        className={`rounded-md p-1 cursor-pointer ${
                                          isEditingThis
                                            ? 'bg-sky-500 text-white'
                                            : 'bg-[#1a242e] text-sky-300 hover:bg-sky-500 hover:text-white'
                                        }`}
                                      >
                                        <Edit3 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => removeScrapedServerRow(idx)}
                                        title="حذف السيرفر"
                                        className="rounded-md bg-[#1a242e] p-1 text-[#D92321] hover:bg-[#D92321] hover:text-white cursor-pointer"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>

                                  <p className="truncate font-latin text-[10px] text-[#b7c9ef]/75" dir="ltr">
                                    {srvUrl || 'لم يُضف رابط بعد'}
                                  </p>

                                  {isEditingThis && (
                                    <div className="space-y-2 pt-2 border-t border-white/10">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <div className="flex rounded-lg bg-[#1a242e] p-0.5 border border-white/10">
                                          <button
                                            type="button"
                                            onClick={() => updateScrapedServerRow(idx, { mode: 'url' })}
                                            className={`rounded-md px-2 py-0.5 text-[10px] font-bold cursor-pointer ${
                                              srvMode === 'url'
                                                ? 'bg-[#4CAF50] text-white'
                                                : 'text-[#b7c9ef]'
                                            }`}
                                          >
                                            رابط مباشر
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              updateScrapedServerRow(idx, { mode: 'embed' })
                                            }
                                            className={`rounded-md px-2 py-0.5 text-[10px] font-bold cursor-pointer ${
                                              srvMode === 'embed'
                                                ? 'bg-[#f9c400] text-[#06131c]'
                                                : 'text-[#b7c9ef]'
                                            }`}
                                          >
                                            كود Iframe
                                          </button>
                                        </div>
                                        <input
                                          type="text"
                                          value={s.quality}
                                          onChange={(e) =>
                                            updateScrapedServerRow(idx, { quality: e.target.value })
                                          }
                                          placeholder="الجودة (1080p)"
                                          className="w-28 rounded-lg bg-[#1a242e] border border-white/10 px-2.5 py-1 text-[11px] text-white"
                                        />
                                      </div>

                                      {srvMode === 'url' ? (
                                        <input
                                          type="text"
                                          dir="ltr"
                                          value={s.url || ''}
                                          onChange={(e) =>
                                            updateScrapedServerRow(idx, { url: e.target.value })
                                          }
                                          placeholder="https://..."
                                          className="font-latin w-full rounded-lg bg-[#1a242e] border border-white/10 px-2.5 py-1.5 text-[11px] text-white focus:border-[#4CAF50] focus:outline-none"
                                        />
                                      ) : (
                                        <textarea
                                          rows={2}
                                          dir="ltr"
                                          value={s.embedCode || ''}
                                          onChange={(e) =>
                                            updateScrapedServerRow(idx, {
                                              embedCode: e.target.value,
                                            })
                                          }
                                          placeholder='<iframe src="https://..." allowfullscreen></iframe>'
                                          className="font-latin w-full rounded-lg bg-[#1a242e] border border-white/10 p-2 text-[11px] text-white focus:border-[#f9c400] focus:outline-none"
                                        />
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Downloads & Seasons/Cast Summary */}
                      <div className="lg:col-span-5 grid grid-cols-1 gap-4">
                        <div className="rounded-2xl bg-[#1a242e]/80 p-3.5">
                          <p className="text-xs font-extrabold text-white flex items-center gap-1.5 mb-2">
                            <Download className="w-4 h-4 text-[#4CAF50]" />
                            روابط التحميل ({scrapedResult.downloads.length})
                          </p>
                          {scrapedResult.downloads.length === 0 ? (
                            <p className="text-[11px] text-[#b7c9ef]">لم يُعثر على روابط تحميل مباشرة</p>
                          ) : (
                            <ul className="space-y-1 text-[11px] text-[#b7c9ef]">
                              {scrapedResult.downloads.slice(0, 5).map((d) => (
                                <li key={d.id} className="truncate font-latin">
                                  • {d.host} ({d.quality})
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div className="rounded-2xl bg-[#1a242e]/80 p-3.5">
                          <p className="text-xs font-extrabold text-white flex items-center gap-1.5 mb-2">
                            <Layers className="w-4 h-4 text-[#f9c400]" />
                            الحلقات وطاقم العمل
                          </p>
                          <p className="text-[11px] text-[#b7c9ef]">
                            حلقات مستخرجة:{' '}
                            <strong className="text-white">
                              {scrapedResult.seasons?.[0]?.episodes.length || 0}
                            </strong>
                            <br />
                            ممثلون مستخرجون:{' '}
                            <strong className="text-white">{scrapedResult.cast.length}</strong>
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewModalState({
                            item: scrapedToMediaItem(scrapedResult),
                            source: 'scraper',
                          })
                        }
                        className="inline-flex items-center gap-2 rounded-xl bg-[#f9c400] hover:bg-[#dfb20b] px-5 py-3 text-xs font-black text-[#06131c] shadow-lg cursor-pointer"
                      >
                        <Eye className="w-4 h-4" />
                        <span>معاينة قبل النشر</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditorWithScraped(scrapedResult)}
                        className="inline-flex items-center gap-2 rounded-xl bg-[#1a242e] hover:bg-sky-500 border border-white/15 px-5 py-3 text-xs font-extrabold text-white cursor-pointer"
                      >
                        <Edit3 className="w-4 h-4" />
                        <span>مراجعة وتعديل في المحرر الكامل</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() => void handlePublishScrapedDirectly()}
                        className="inline-flex items-center gap-2 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] px-6 py-3 text-xs font-extrabold text-white shadow-lg cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>حفظ ونشر فورًا في قاعدة البيانات</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3B: SITE-WIDE BULK CRAWLER */}
            {activeTab === 'site_scraper' && (
              <div className="space-y-6">
                <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
                    <div>
                      <h2 className="font-display text-lg font-extrabold text-white flex items-center gap-2">
                        <Globe className="w-5 h-5 text-[#f9c400]" />
                        أداة جلب محتوى موقع بالكامل (Bulk Site Crawler)
                      </h2>
                      <p className="text-xs text-[#b7c9ef] mt-1">
                        ضع رابط موقع أفلام/مسلسلات أو قسم كامل، وستقوم الأداة بفحص الموقع (Blogger
                        Feed / WordPress API / صفحات التصفح / Sitemap) وسحب جميع الأعمال وسيرفراتها
                        دفعة واحدة.
                      </p>
                    </div>

                    <div className="flex rounded-xl bg-[#1a242e] p-1 border border-white/10 shrink-0">
                      <button
                        type="button"
                        onClick={() => setSiteScrapeMode('url')}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-extrabold cursor-pointer ${
                          siteScrapeMode === 'url'
                            ? 'bg-[#D92321] text-white'
                            : 'text-[#b7c9ef] hover:text-white'
                        }`}
                      >
                        <Globe className="w-3.5 h-3.5" />
                        <span>رابط الموقع (URL)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSiteScrapeMode('html')}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-extrabold cursor-pointer ${
                          siteScrapeMode === 'html'
                            ? 'bg-[#D92321] text-white'
                            : 'text-[#b7c9ef] hover:text-white'
                        }`}
                      >
                        <Code2 className="w-3.5 h-3.5" />
                        <span>لصق HTML الموقع</span>
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-[#4CAF50]/10 border border-[#4CAF50]/30 px-4 py-3 text-xs text-[#b7c9ef] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span>
                      <strong className="text-[#4CAF50]">وضع التشغيل المدمج (متوافق مع GitHub Pages):</strong>{' '}
                      لجلب أقسام المواقع المحمية مع جميع سيرفرات المشاهدة (<span className="font-latin text-white">/watch</span>) مثل <span className="font-latin text-white">akwams.org/movies/</span> على GitHub Pages، فعّل رابط <strong className="text-white">Cloudflare Worker المجاني</strong> من الإعدادات.
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('settings')}
                      className="shrink-0 rounded-lg bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3 py-1.5 text-[11px] font-bold text-white cursor-pointer"
                    >
                      إعداد بروكسي Cloudflare المجاني
                    </button>
                  </div>

                  <form onSubmit={handleSiteScrapeSubmit} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-[#b7c9ef] mb-1.5">
                        {siteScrapeMode === 'url'
                          ? 'رابط الموقع أو القسم المستهدف (مثال: https://mooveg.blogspot.com)'
                          : 'رابط الموقع الأساسي (لتحويل الروابط النسبية إلى كاملة)'}
                      </label>
                      <input
                        type="url"
                        dir="ltr"
                        required={siteScrapeMode === 'url'}
                        value={siteCrawlUrl}
                        onChange={(e) => setSiteCrawlUrl(e.target.value)}
                        placeholder="https://example.com"
                        className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-4 py-3 text-sm text-white focus:border-[#f9c400] focus:outline-none"
                      />
                    </div>

                    {siteScrapeMode === 'html' && (
                      <div>
                        <label className="block text-xs font-bold text-[#b7c9ef] mb-1.5">
                          كود HTML للصفحة الرئيسية أو الأرشيف (لاستخراج كل البطاقات والروابط منه)
                        </label>
                        <textarea
                          rows={6}
                          dir="ltr"
                          required
                          value={siteCrawlHtml}
                          onChange={(e) => setSiteCrawlHtml(e.target.value)}
                          placeholder="<!DOCTYPE html><html>... الصق سورس الصفحة الرئيسية هنا ..."
                          className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 p-3.5 text-xs text-white focus:border-[#f9c400] focus:outline-none"
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-2xl bg-[#1a242e]/60 border border-white/[0.07] p-4">
                      <div>
                        <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                          أقصى عدد للأعمال المسحوبة
                        </label>
                        <select
                          value={siteMaxItems}
                          onChange={(e) => setSiteMaxItems(Number(e.target.value))}
                          className="w-full rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-xs font-bold text-white"
                        >
                          <option value={10}>10 أعمال</option>
                          <option value={20}>20 عملًا</option>
                          <option value={30}>30 عملًا (موصى به)</option>
                          <option value={50}>50 عملًا</option>
                          <option value={80}>80 عملًا (الحد الأقصى)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                          عدد صفحات التصفح (Pagination)
                        </label>
                        <select
                          value={siteMaxPages}
                          onChange={(e) => setSiteMaxPages(Number(e.target.value))}
                          className="w-full rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-xs font-bold text-white"
                        >
                          <option value={1}>الصفحة الأولى فقط</option>
                          <option value={3}>حتى 3 صفحات</option>
                          <option value={5}>حتى 5 صفحات</option>
                          <option value={8}>حتى 8 صفحات</option>
                        </select>
                      </div>

                      <div className="flex items-center">
                        <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer">
                          <input
                            type="checkbox"
                            checked={siteDeepScrape}
                            onChange={(e) => setSiteDeepScrape(e.target.checked)}
                            className="h-4 w-4 accent-[#4CAF50]"
                          />
                          <span>فحص عميق لكل عمل (جلب القصة + iframe السيرفرات + التحميل)</span>
                        </label>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={siteCrawling}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#f9c400] hover:bg-[#dfb20b] disabled:opacity-60 px-6 py-3 text-xs font-black text-[#06131c] shadow-lg cursor-pointer"
                    >
                      {siteCrawling ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Globe className="w-4 h-4" />
                      )}
                      <span>
                        {siteCrawling
                          ? 'جاري فحص الموقع وجلب جميع المحتويات...'
                          : 'بدء جلب جميع محتوى الموقع الآن'}
                      </span>
                    </button>
                  </form>

                  {siteCrawlError && (
                    <div className="rounded-2xl bg-[#D92321]/15 border border-[#D92321]/40 p-4 text-xs font-bold text-[#ff8a88] space-y-2.5">
                      <p>{siteCrawlError}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        {siteScrapeMode === 'url' && (
                          <button
                            type="button"
                            onClick={() => setSiteScrapeMode('html')}
                            className="inline-flex items-center gap-1 rounded-lg bg-[#D92321] px-3 py-1.5 text-[11px] font-extrabold text-white cursor-pointer"
                          >
                            <Code2 className="w-3.5 h-3.5" />
                            <span>التبديل إلى وضع لصق HTML الصفحة</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setActiveTab('settings')}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#f9c400] hover:bg-[#dfb20b] px-3 py-1.5 text-[11px] font-black text-[#06131c] cursor-pointer"
                        >
                          <Settings className="w-3.5 h-3.5" />
                          <span>إعداد بروكسي Cloudflare المجاني</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Crawled Website Results Toolbar + Bulk Publish */}
                {siteScrapedItems.length > 0 && siteCrawlMeta && (
                  <div className="rounded-3xl bg-[#0c1821] border border-[#4CAF50]/40 p-5 space-y-5 shadow-2xl">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-display text-base font-extrabold text-white">
                            تم اكتشاف {siteCrawlMeta.totalDiscovered} عملًا من:{' '}
                            <span className="text-[#f9c400]">{siteCrawlMeta.siteTitle}</span>
                          </h3>
                          <span className="font-latin rounded-md bg-[#4CAF50]/15 border border-[#4CAF50]/35 px-2 py-0.5 text-[11px] font-bold text-[#4CAF50]">
                            {siteCrawlMeta.strategy}
                          </span>
                        </div>
                        <p className="text-xs text-[#b7c9ef] mt-1">
                          حدد الأعمال المطلوبة أو عدّل أي عمل قبل النشر الجماعي في قاعدة البيانات.
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={busyAction || selectedSiteItemsCount === 0}
                        onClick={() => void handleBulkPublishSelected()}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-50 px-5 py-3 text-xs font-extrabold text-white shadow-lg cursor-pointer shrink-0"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>
                          {busyAction
                            ? 'جاري النشر في Firestore...'
                            : `نشر المحدد دفعة واحدة (${selectedSiteItemsCount} عمل)`}
                        </span>
                      </button>
                    </div>

                    {!customApiUrl &&
                      siteDeepScrape &&
                      siteScrapedItems.every((item) => item.servers.length === 0) && (
                        <div className="rounded-2xl bg-[#f9c400]/10 border border-[#f9c400]/35 px-4 py-3 text-xs text-[#fde68a] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <span>
                            تم جلب بيانات الأعمال، لكن المتصفح مُنع من فتح صفحات السيرفرات الداخلية (<span className="font-latin">/watch</span>) لهذا الموقع على الاستضافة الثابتة. لإحضار جميع سيرفرات المشاهدة تلقائياً، أضف رابط <strong>Cloudflare Worker المجاني</strong> من الإعدادات.
                          </span>
                          <button
                            type="button"
                            onClick={() => setActiveTab('settings')}
                            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-[#f9c400] hover:bg-[#dfb20b] px-3.5 py-2 text-[11px] font-black text-[#06131c] cursor-pointer"
                          >
                            <Settings className="w-3.5 h-3.5" />
                            <span>تفعيل Cloudflare Worker الآن</span>
                          </button>
                        </div>
                      )}

                    {/* Selection & Filter Controls */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setSiteScrapedItems((prev) =>
                              prev.map((item) => ({ ...item, selected: true }))
                            )
                          }
                          className="rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
                        >
                          تحديد الكل ({siteScrapedItems.length})
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setSiteScrapedItems((prev) =>
                              prev.map((item) => ({ ...item, selected: false }))
                            )
                          }
                          className="rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3 py-1.5 text-xs font-bold text-[#b7c9ef] cursor-pointer"
                        >
                          إلغاء التحديد
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {(
                          [
                            { id: 'all', label: 'الكل' },
                            { id: 'movie', label: 'أفلام' },
                            { id: 'series', label: 'مسلسلات' },
                            { id: 'wrestling', label: 'مصارعة' },
                          ] as const
                        ).map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => setSiteKindFilter(f.id)}
                            className={`rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer ${
                              siteKindFilter === f.id
                                ? 'bg-[#D92321] text-white'
                                : 'bg-[#1a242e] text-[#b7c9ef]'
                            }`}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Items Cards Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 max-h-[560px] overflow-y-auto pr-1">
                      {visibleSiteScrapedItems.map((item) => (
                        <div
                          key={item.tempKey}
                          className={`flex gap-3.5 rounded-2xl border p-3.5 transition-colors ${
                            item.selected
                              ? 'bg-[#1a242e] border-[#4CAF50]/50'
                              : 'bg-[#1a242e]/45 border-white/10 opacity-70'
                          }`}
                        >
                          <div className="flex flex-col items-center gap-2 shrink-0">
                            <input
                              type="checkbox"
                              checked={item.selected}
                              onChange={(e) =>
                                setSiteScrapedItems((prev) =>
                                  prev.map((x) =>
                                    x.tempKey === item.tempKey
                                      ? { ...x, selected: e.target.checked }
                                      : x
                                  )
                                )
                              }
                              aria-label={`تحديد ${item.title}`}
                              className="h-4 w-4 accent-[#4CAF50] cursor-pointer"
                            />
                            <img
                              src={item.poster || ASSETS.runningMan}
                              alt={item.title}
                              className="h-24 w-16 rounded-xl object-cover border border-white/10"
                            />
                          </div>

                          <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
                            <div>
                              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                <span className="rounded-md bg-[#D92321] px-2 py-0.5 text-[10px] font-black text-white">
                                  {KIND_LABELS[item.kind]}
                                </span>
                                <span className="rounded-md bg-[#0c1821] px-2 py-0.5 text-[10px] font-bold text-[#f9c400]">
                                  ★ {item.imdb}
                                </span>
                                <span className="rounded-md bg-[#0c1821] px-2 py-0.5 text-[10px] font-bold text-[#b7c9ef]">
                                  {item.year} • {item.quality}
                                </span>
                              </div>
                              <h4 className="text-xs sm:text-sm font-extrabold text-white line-clamp-1">
                                {item.title}
                              </h4>
                              <p className="text-[11px] text-[#b7c9ef] line-clamp-2 mt-0.5">
                                {item.story}
                              </p>
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/[0.06]">
                              <span className="text-[10px] font-bold text-[#4CAF50]">
                                {item.servers.length} سيرفر • {item.downloads.length} تحميل
                                {item.seasons?.[0]?.episodes.length
                                  ? ` • ${item.seasons[0].episodes.length} حلقة`
                                  : ''}
                                {item.trailerUrl ? ' • تريلر متاح' : ''}
                              </span>

                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPreviewModalState({
                                      item: scrapedToMediaItem(item),
                                      source: 'site_scraper',
                                    })
                                  }
                                  className="inline-flex items-center gap-1 rounded-lg bg-[#f9c400]/15 hover:bg-[#f9c400] px-2.5 py-1 text-[11px] font-bold text-[#f9c400] hover:text-[#06131c] cursor-pointer"
                                >
                                  <Eye className="w-3 h-3" />
                                  <span>معاينة</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditorWithScraped(item)}
                                  className="inline-flex items-center gap-1 rounded-lg bg-[#0c1821] hover:bg-sky-500 px-2.5 py-1 text-[11px] font-bold text-sky-300 hover:text-white cursor-pointer"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  <span>تعديل</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSiteScrapedItems((prev) =>
                                      prev.filter((x) => x.tempKey !== item.tempKey)
                                    )
                                  }
                                  className="inline-flex items-center gap-1 rounded-lg bg-[#0c1821] hover:bg-[#D92321] px-2 py-1 text-[11px] font-bold text-[#D92321] hover:text-white cursor-pointer"
                                  aria-label="استبعاد"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: VISITOR REQUESTS */}
            {activeTab === 'requests' && (
              <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-display text-lg font-extrabold text-white">
                    إدارة طلبات الزوار المباشرة
                  </h2>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        { id: 'all', label: 'الكل' },
                        { id: 'pending', label: 'قيد المراجعة' },
                        { id: 'approved', label: 'موافق عليه' },
                        { id: 'completed', label: 'مكتمل' },
                        { id: 'rejected', label: 'مرفوض' },
                      ] as const
                    ).map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => setReqStatusFilter(st.id)}
                        className={`rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer ${
                          reqStatusFilter === st.id
                            ? 'bg-[#D92321] text-white'
                            : 'bg-[#1a242e] text-[#b7c9ef]'
                        }`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>

                {filteredRequests.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 py-14 text-center text-xs text-[#b7c9ef]">
                    لا توجد طلبات زوار في هذه الحالة حاليًا.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredRequests.map((req) => {
                      const draft = adminReplies[req.id] || {
                        status: req.status,
                        note: req.adminNote || '',
                      };
                      const badge = REQUEST_STATUS_LABELS[req.status];
                      return (
                        <div
                          key={req.id}
                          className="rounded-2xl bg-[#1a242e]/80 border border-white/[0.08] p-4 space-y-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="text-sm font-extrabold text-white">{req.title}</h3>
                                <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white">
                                  {req.type}
                                </span>
                                <span
                                  className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}
                                >
                                  {badge.label}
                                </span>
                              </div>
                              <p className="text-xs text-[#b7c9ef] mt-1">
                                مقدم الطلب:{' '}
                                <strong className="text-white">{req.requesterName || 'زائر'}</strong>
                                {req.notes ? ` — ملاحظات: ${req.notes}` : ''}
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() => void handleDeleteRequest(req.id)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#0c1821] text-[#D92321] hover:bg-[#D92321] hover:text-white cursor-pointer"
                              aria-label="حذف الطلب"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 pt-2 border-t border-white/[0.06]">
                            <select
                              value={draft.status}
                              onChange={(e) =>
                                setAdminReplies((prev) => ({
                                  ...prev,
                                  [req.id]: {
                                    ...draft,
                                    status: e.target.value as RequestStatus,
                                  },
                                }))
                              }
                              aria-label="تحديث حالة الطلب"
                              className="sm:col-span-3 rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-xs font-bold text-white"
                            >
                              <option value="pending">قيد المراجعة</option>
                              <option value="approved">تمت الموافقة</option>
                              <option value="completed">تمت الإضافة للموقع</option>
                              <option value="rejected">مرفوض</option>
                            </select>

                            <input
                              type="text"
                              value={draft.note}
                              onChange={(e) =>
                                setAdminReplies((prev) => ({
                                  ...prev,
                                  [req.id]: { ...draft, note: e.target.value },
                                }))
                              }
                              placeholder="رد الإدارة للزائر (اختياري)..."
                              className="sm:col-span-6 rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-xs text-white focus:border-[#4CAF50] focus:outline-none"
                            />

                            <button
                              type="button"
                              disabled={busyAction}
                              onClick={() => void handleUpdateRequest(req)}
                              className="sm:col-span-3 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] py-2 px-3 text-xs font-extrabold text-white cursor-pointer"
                            >
                              حفظ التحديث
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 5: USERS & ADMINS RBAC */}
            {activeTab === 'users' && (
              <div className="space-y-6">
                {/* Create New Admin Directly with Email/Username & Password */}
                <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-4">
                  <div>
                    <h2 className="font-display text-base font-extrabold text-white">
                      إنشاء حساب مشرف جديد (باسم وباسورد مباشرة)
                    </h2>
                    <p className="text-xs text-[#b7c9ef] mt-1">
                      يتم إنشاء الحساب في Firebase Auth ومنحه صلاحية الإدارة فورًا بدون تسجيل خروجك.
                    </p>
                  </div>

                  <form onSubmit={handleCreateAdminAccount} className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    <input
                      type="text"
                      required
                      value={createAdminName}
                      onChange={(e) => setCreateAdminName(e.target.value)}
                      placeholder="اسم المشرف (مثال: أحمد)"
                      className="sm:col-span-3 rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-xs text-white focus:border-[#D92321] focus:outline-none"
                    />
                    <input
                      type="text"
                      required
                      dir="ltr"
                      value={createAdminEmail}
                      onChange={(e) => setCreateAdminEmail(e.target.value)}
                      placeholder="البريد أو اسم المستخدم (mod@rahaltv.com)"
                      className="sm:col-span-4 rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-xs text-white focus:border-[#D92321] focus:outline-none"
                    />
                    <input
                      type="password"
                      required
                      minLength={6}
                      dir="ltr"
                      value={createAdminPassword}
                      onChange={(e) => setCreateAdminPassword(e.target.value)}
                      placeholder="كلمة المرور (6 أحرف+)"
                      className="sm:col-span-3 rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-xs text-white focus:border-[#D92321] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={creatingAdmin}
                      className="sm:col-span-2 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-60 py-2.5 px-4 text-xs font-extrabold text-white cursor-pointer"
                    >
                      {creatingAdmin ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      <span>إضافة مشرف</span>
                    </button>
                  </form>

                  {createAdminError && (
                    <div className="rounded-xl bg-[#D92321]/15 border border-[#D92321]/40 p-3 text-xs text-red-200">
                      {createAdminError}
                    </div>
                  )}
                </div>

                <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-4">
                  <h2 className="font-display text-base font-extrabold text-white">
                    أو إضافة مشرف موجود عبر معرف المستخدم (UID)
                  </h2>
                  <form onSubmit={handleGrantAdmin} className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    <input
                      type="text"
                      required
                      value={newAdminUid}
                      onChange={(e) => setNewAdminUid(e.target.value)}
                      placeholder="معرّف المستخدم (Firebase UID)"
                      className="sm:col-span-5 rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-xs text-white focus:border-[#D92321] focus:outline-none"
                    />
                    <input
                      type="text"
                      required
                      value={newAdminName}
                      onChange={(e) => setNewAdminName(e.target.value)}
                      placeholder="اسم المشرف"
                      className="sm:col-span-4 rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-xs text-white focus:border-[#D92321] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={busyAction}
                      className="sm:col-span-3 rounded-xl bg-[#D92321] hover:bg-[#dc0e30] py-2.5 px-4 text-xs font-extrabold text-white cursor-pointer"
                    >
                      منح صلاحية مشرف
                    </button>
                  </form>

                  {adminsList.length > 0 && (
                    <div className="pt-3 border-t border-white/10 space-y-2">
                      <p className="text-xs font-bold text-[#b7c9ef]">المشرفون المضافون ({adminsList.length}):</p>
                      {adminsList.map((adm) => (
                        <div
                          key={adm.uid}
                          className="flex items-center justify-between rounded-xl bg-[#1a242e] px-3.5 py-2.5 text-xs"
                        >
                          <div>
                            <span className="font-extrabold text-white">{adm.displayName}</span>
                            {adm.uid === user.uid && (
                              <span className="mr-2 rounded bg-[#f9c400]/20 px-1.5 py-0.5 text-[10px] font-black text-[#f9c400]">
                                حسابك الحالي
                              </span>
                            )}
                            <span className="text-[#b7c9ef] mr-2 font-latin" dir="ltr">({adm.uid})</span>
                          </div>
                          {adm.uid !== user.uid && (
                            <button
                              type="button"
                              onClick={() => void revokeAdminRoleFromFirestore(adm.uid)}
                              className="text-xs font-bold text-[#D92321] hover:underline cursor-pointer"
                            >
                              سحب الصلاحية
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5">
                  <h2 className="font-display text-base font-extrabold text-white mb-4">
                    الأعضاء المسجلون في قاعدة البيانات ({usersList.length})
                  </h2>
                  {usersList.length === 0 ? (
                    <p className="text-xs text-[#b7c9ef]">لم يسجل أي عضو دخولًا بعد.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {usersList.map((u) => (
                        <div
                          key={u.uid}
                          className="flex items-center justify-between gap-3 rounded-2xl bg-[#1a242e]/70 p-3.5 border border-white/[0.06]"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {u.photoURL ? (
                              <img
                                src={u.photoURL}
                                alt={u.displayName}
                                referrerPolicy="no-referrer"
                                className="h-10 w-10 rounded-xl object-cover shrink-0"
                              />
                            ) : (
                              <div className="h-10 w-10 rounded-xl bg-[#D92321]/20 flex items-center justify-center text-xs font-black text-white shrink-0">
                                {u.displayName.slice(0, 2).toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-xs font-extrabold text-white truncate">
                                {u.displayName}
                              </p>
                              <p className="font-latin text-[10px] text-[#b7c9ef] truncate select-all">
                                {u.uid}
                              </p>
                            </div>
                          </div>
                          <span className="rounded-lg bg-white/5 px-2.5 py-1 text-[11px] font-bold text-[#4CAF50] shrink-0">
                            قائمتي: {u.watchlistIds?.length || 0}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 6: SITE SETTINGS */}
            {activeTab === 'settings' && (
              <form
                onSubmit={handleSaveSettings}
                className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-5"
              >
                <div className="flex items-center gap-2.5 border-b border-white/10 pb-4">
                  <Tv className="w-5 h-5 text-[#D92321]" />
                  <h2 className="font-display text-lg font-extrabold text-white">
                    إعدادات منصة RahaL TV العامة
                  </h2>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-[#b7c9ef] mb-1.5">
                      اسم المنصة
                    </label>
                    <input
                      type="text"
                      required
                      value={settingsForm.siteName}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, siteName: e.target.value })
                      }
                      className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-sm text-white focus:border-[#D92321] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#b7c9ef] mb-1.5">
                      عدد الأعمال المثبتة في السلايدر
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={15}
                      value={settingsForm.featuredLimit}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          featuredLimit: Number(e.target.value) || 5,
                        })
                      }
                      className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-sm text-white focus:border-[#D92321] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#b7c9ef] mb-1.5">
                    الوصف التعريفي للموقع (Tagline)
                  </label>
                  <textarea
                    rows={3}
                    value={settingsForm.tagline}
                    onChange={(e) => setSettingsForm({ ...settingsForm, tagline: e.target.value })}
                    className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-sm text-white focus:border-[#D92321] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#b7c9ef] mb-1.5">
                    شريط تنبيهات وإعلانات المشاهدين (اختياري)
                  </label>
                  <input
                    type="text"
                    value={settingsForm.announcementText}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, announcementText: e.target.value })
                    }
                    placeholder="مثال: تمت إضافة حلقات جديدة من مسلسلات رمضان 2026 بجودة BluRay"
                    className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-sm text-white focus:border-[#D92321] focus:outline-none"
                  />
                </div>

                <label className="flex items-center gap-2.5 text-xs font-bold text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.tickerEnabled}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, tickerEnabled: e.target.checked })
                    }
                    className="h-4 w-4 accent-[#D92321]"
                  />
                  <span>تفعيل شريط التنبيهات في الصفحة الرئيسية</span>
                </label>

                {/* Maintenance Mode Section */}
                <div
                  className={`rounded-2xl border p-5 space-y-4 transition-colors ${
                    settingsForm.maintenanceMode
                      ? 'bg-[#D92321]/10 border-[#D92321]/45'
                      : 'bg-[#1a242e]/65 border-white/10'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
                          settingsForm.maintenanceMode
                            ? 'bg-[#D92321]/20 border-[#D92321]/50 text-[#ff8a88]'
                            : 'bg-[#0c1821] border-white/10 text-[#f9c400]'
                        }`}
                      >
                        <Wrench className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-extrabold text-white">وضع الصيانة (Maintenance Mode)</h3>
                          <span
                            className={`rounded-md px-2 py-0.5 text-[10px] font-black ${
                              settingsForm.maintenanceMode
                                ? 'bg-[#D92321] text-white'
                                : 'bg-[#4CAF50]/20 text-[#4CAF50]'
                            }`}
                          >
                            {settingsForm.maintenanceMode ? 'مُفعّل حاليًا' : 'متوقف'}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#b7c9ef] mt-0.5">
                          عند التفعيل، تظهر رسالة الصيانة للزوار العاديين فقط بينما يظل الموقع ولوحة التحكم متاحَين لك كأدمن.
                        </p>
                      </div>
                    </div>

                    {/* Interactive Toggle Switch */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settingsForm.maintenanceMode}
                      aria-label="تبديل وضع الصيانة"
                      onClick={() =>
                        setSettingsForm({
                          ...settingsForm,
                          maintenanceMode: !settingsForm.maintenanceMode,
                        })
                      }
                      className={`relative inline-flex h-7 w-13 shrink-0 items-center rounded-full border transition-colors cursor-pointer ${
                        settingsForm.maintenanceMode
                          ? 'bg-[#D92321] border-[#ff5a58]'
                          : 'bg-[#0c1821] border-white/20'
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                          settingsForm.maintenanceMode ? '-translate-x-7' : '-translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-[#b7c9ef]">
                        نص رسالة الصيانة المخصصة للمستخدمين
                      </label>
                      <span className="font-latin text-[10px] font-bold text-[#b7c9ef]">
                        {(settingsForm.maintenanceMessage || '').length} / 500
                      </span>
                    </div>
                    <textarea
                      rows={3}
                      maxLength={500}
                      value={settingsForm.maintenanceMessage}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          maintenanceMessage: e.target.value,
                        })
                      }
                      placeholder="اكتب الرسالة التي ستظهر للزوار أثناء وضع الصيانة..."
                      className="w-full rounded-xl bg-[#0c1821] border border-white/10 px-3.5 py-2.5 text-sm text-white focus:border-[#D92321] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="rounded-2xl bg-[#1a242e]/65 border border-white/10 p-5 space-y-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 flex-1 min-w-[240px]">
                      <h3 className="text-sm font-extrabold text-white">
                        رابط بروكسي السحب (Cloudflare Worker المجاني أو خادم Node.js)
                      </h3>
                      <p className="text-[11px] leading-relaxed text-[#b7c9ef]">
                        مواقع مثل <span className="font-latin text-white">akwams.org</span> تمنع الجلب المباشر من المتصفح وتخفي السيرفرات في صفحة <span className="font-latin text-white">/watch</span>. أنشئ Cloudflare Worker مجانياً (100 ألف طلب يومياً بلا توقف) وضع رابطه هنا لتعمل أداة السحب على GitHub Pages بنفس كفاءة المعاينة تماماً.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (navigator.clipboard?.writeText) {
                          void navigator.clipboard
                            .writeText(CLOUDFLARE_WORKER_SOURCE)
                            .then(() => onNotify('تم نسخ كود Cloudflare Worker المجاني إلى الحافظة!'))
                            .catch(() => onNotify('تعذر النسخ التلقائي — راجع ملف cloudflare-worker.js في المستودع.'));
                        } else {
                          onNotify('افتح ملف cloudflare-worker.js من المستودع وانسخ محتواه.');
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 px-3.5 py-2 text-[11px] font-extrabold text-white cursor-pointer shrink-0"
                    >
                      <Copy className="w-3.5 h-3.5 text-[#f9c400]" />
                      <span>نسخ كود Cloudflare Worker المجاني</span>
                    </button>
                  </div>

                  <ol className="list-decimal list-inside space-y-1 text-[11px] text-[#b7c9ef] bg-[#0c1821]/70 border border-white/5 rounded-xl p-3">
                    <li>
                      ادخل إلى{' '}
                      <a
                        href="https://dash.cloudflare.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-latin text-[#f9c400] underline inline-flex items-center gap-1"
                      >
                        dash.cloudflare.com
                        <ExternalLink className="w-3 h-3" />
                      </a>{' '}
                      ثم اختر <span className="font-latin text-white">Workers &amp; Pages &larr; Create Worker</span>.
                    </li>
                    <li>احذف الكود الافتراضي والصق الكود المنسوخ بالزر أعلاه ثم اضغط <span className="font-latin text-white">Deploy</span>.</li>
                    <li>انسخ رابط الـ Worker (ينتهي بـ <span className="font-latin text-white">.workers.dev</span>) والصقه بالأسفل ثم احفظ.</li>
                  </ol>

                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <input
                      type="url"
                      dir="ltr"
                      value={customApiUrl}
                      onChange={(e) => setCustomApiUrl(e.target.value)}
                      placeholder="https://rahaltv-proxy.yourname.workers.dev"
                      className="font-latin flex-1 rounded-xl bg-[#0c1821] border border-white/10 px-3.5 py-2.5 text-xs text-white focus:border-[#f9c400] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const saved = setCustomApiBaseUrl(customApiUrl);
                        setCustomApiUrl(saved);
                        onNotify(
                          saved
                            ? `تم حفظ رابط بروكسي السحب: ${saved}`
                            : 'تم مسح الرابط — سيعمل السحب بالوضع المدمج في المتصفح'
                        );
                      }}
                      className="rounded-xl bg-[#f9c400] hover:bg-[#dfb20b] px-4 py-2.5 text-xs font-black text-[#06131c] cursor-pointer shrink-0"
                    >
                      حفظ رابط البروكسي
                    </button>
                  </div>
                </div>

                {/* Internal Video Player Theme Customizer */}
                <div className="rounded-2xl bg-[#1a242e]/65 border border-white/10 p-5 space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
                    <div className="flex items-center gap-3">
                      <div
                        style={{
                          backgroundColor: `${activePlayerTheme.accentColor}22`,
                          borderColor: `${activePlayerTheme.accentColor}55`,
                          color: activePlayerTheme.accentColor,
                        }}
                        className="flex h-10 w-10 items-center justify-center rounded-xl border"
                      >
                        <Palette className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-extrabold text-white">
                          تخصيص ثيم المشغّل الداخلي (يُطبّق تلقائياً)
                        </h3>
                        <p className="text-[11px] text-[#b7c9ef] mt-0.5">
                          تحكّم في ألوان الإطار، شكل الحواف، اسم المشغّل، وأشرطة التحكم — بمجرد الحفظ يتغير المشغّل تلقائياً في كل الموقع.
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const resetTheme = { ...DEFAULT_PLAYER_THEME };
                          saveStoredPlayerTheme(resetTheme);
                          setSettingsForm((prev) => ({ ...prev, playerTheme: resetTheme }));
                          onNotify('تمت استعادة الثيم الافتراضي للمشغّل — اضغط حفظ لتعميمه');
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#0c1821] hover:bg-white/10 border border-white/10 px-3 py-2 text-[11px] font-bold text-[#b7c9ef] hover:text-white cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>استعادة الافتراضي</span>
                      </button>

                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() => void handleSavePlayerThemeOnly(activePlayerTheme)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#f9c400] hover:bg-[#dfb20b] px-4 py-2 text-[11px] font-black text-[#06131c] shadow cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{busyAction ? 'جاري التعميم...' : 'تطبيق وحفظ الثيم تلقائياً'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Quick Presets */}
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-[#b7c9ef]">
                      ثيمات جاهزة سريعة
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                      {PLAYER_THEME_PRESETS.map((preset) => {
                        const isSelected = activePlayerTheme.presetId === preset.id;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => updatePlayerTheme(preset.theme, true)}
                            className={`text-right rounded-xl border p-3 transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-[#0c1821] border-white/40 shadow-lg'
                                : 'bg-[#0c1821]/60 border-white/10 hover:border-white/25'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <span className="text-xs font-extrabold text-white truncate">
                                {preset.name}
                              </span>
                              <div className="flex items-center gap-1 shrink-0">
                                <span
                                  className="h-3.5 w-3.5 rounded-full border border-white/25"
                                  style={{ backgroundColor: preset.theme.accentColor }}
                                />
                                <span
                                  className="h-3.5 w-3.5 rounded-full border border-white/25"
                                  style={{ backgroundColor: preset.theme.frameBgColor }}
                                />
                              </div>
                            </div>
                            <p className="text-[10px] text-[#b7c9ef]/80 leading-snug">
                              {preset.subtitle}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Theme Controls + Live Mini Preview Grid */}
                  <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
                    {/* Controls Column */}
                    <div className="xl:col-span-6 space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-[#b7c9ef] mb-1.5">
                          اسم المشغّل الظاهر داخل الإطار
                        </label>
                        <input
                          type="text"
                          maxLength={40}
                          value={activePlayerTheme.brandLabel}
                          onChange={(e) =>
                            updatePlayerTheme({ brandLabel: e.target.value })
                          }
                          placeholder="RahaL TV"
                          className="w-full rounded-xl bg-[#0c1821] border border-white/10 px-3.5 py-2 text-xs font-bold text-white focus:border-[#f9c400] focus:outline-none"
                        />
                      </div>

                      {/* Color Pickers */}
                      <div className="grid grid-cols-3 gap-2.5">
                        <label className="block rounded-xl bg-[#0c1821] border border-white/10 p-2.5 cursor-pointer hover:border-white/25">
                          <span className="block text-[10px] font-bold text-[#b7c9ef] mb-1.5">
                            اللون المميز
                          </span>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={activePlayerTheme.accentColor}
                              onChange={(e) =>
                                updatePlayerTheme({ accentColor: e.target.value })
                              }
                              className="h-7 w-9 rounded border-0 bg-transparent cursor-pointer"
                            />
                            <span className="font-latin text-[11px] font-bold text-white uppercase">
                              {activePlayerTheme.accentColor}
                            </span>
                          </div>
                        </label>

                        <label className="block rounded-xl bg-[#0c1821] border border-white/10 p-2.5 cursor-pointer hover:border-white/25">
                          <span className="block text-[10px] font-bold text-[#b7c9ef] mb-1.5">
                            خلفية الإطار
                          </span>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={activePlayerTheme.frameBgColor}
                              onChange={(e) =>
                                updatePlayerTheme({ frameBgColor: e.target.value })
                              }
                              className="h-7 w-9 rounded border-0 bg-transparent cursor-pointer"
                            />
                            <span className="font-latin text-[11px] font-bold text-white uppercase">
                              {activePlayerTheme.frameBgColor}
                            </span>
                          </div>
                        </label>

                        <label className="block rounded-xl bg-[#0c1821] border border-white/10 p-2.5 cursor-pointer hover:border-white/25">
                          <span className="block text-[10px] font-bold text-[#b7c9ef] mb-1.5">
                            خلفية النافذة
                          </span>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={activePlayerTheme.modalBgColor}
                              onChange={(e) =>
                                updatePlayerTheme({ modalBgColor: e.target.value })
                              }
                              className="h-7 w-9 rounded border-0 bg-transparent cursor-pointer"
                            />
                            <span className="font-latin text-[11px] font-bold text-white uppercase">
                              {activePlayerTheme.modalBgColor}
                            </span>
                          </div>
                        </label>
                      </div>

                      {/* Radius & Glow Controls */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <span className="block text-[11px] font-bold text-[#b7c9ef] mb-1.5">
                            استدارة الحواف
                          </span>
                          <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-[#0c1821] p-1 border border-white/10">
                            {(
                              [
                                { id: 'sharp', label: 'حاد' },
                                { id: 'rounded', label: 'ناعم' },
                                { id: 'cinema', label: 'سينمائي' },
                              ] as const
                            ).map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => updatePlayerTheme({ borderRadius: opt.id })}
                                className={`rounded-lg py-1.5 text-[11px] font-extrabold cursor-pointer transition-colors ${
                                  activePlayerTheme.borderRadius === opt.id
                                    ? 'bg-white/15 text-white'
                                    : 'text-[#b7c9ef] hover:text-white'
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <span className="block text-[11px] font-bold text-[#b7c9ef] mb-1.5">
                            شدة التوهج حول المربع
                          </span>
                          <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-[#0c1821] p-1 border border-white/10">
                            {(
                              [
                                { id: 'none', label: 'بدون' },
                                { id: 'soft', label: 'خفيف' },
                                { id: 'strong', label: 'قوي' },
                              ] as const
                            ).map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => updatePlayerTheme({ glowIntensity: opt.id })}
                                className={`rounded-lg py-1.5 text-[11px] font-extrabold cursor-pointer transition-colors ${
                                  activePlayerTheme.glowIntensity === opt.id
                                    ? 'bg-white/15 text-white'
                                    : 'text-[#b7c9ef] hover:text-white'
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Visibility Toggles */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <label className="flex items-center gap-2 rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-[11px] font-bold text-white cursor-pointer">
                          <input
                            type="checkbox"
                            checked={activePlayerTheme.showHeaderBar}
                            onChange={(e) =>
                              updatePlayerTheme({ showHeaderBar: e.target.checked })
                            }
                            className="h-3.5 w-3.5 accent-[#f9c400]"
                          />
                          <span>الشريط العلوي</span>
                        </label>
                        <label className="flex items-center gap-2 rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-[11px] font-bold text-white cursor-pointer">
                          <input
                            type="checkbox"
                            checked={activePlayerTheme.showFooterBar}
                            onChange={(e) =>
                              updatePlayerTheme({ showFooterBar: e.target.checked })
                            }
                            className="h-3.5 w-3.5 accent-[#f9c400]"
                          />
                          <span>الشريط السفلي</span>
                        </label>
                        <label className="flex items-center gap-2 rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-[11px] font-bold text-white cursor-pointer">
                          <input
                            type="checkbox"
                            checked={activePlayerTheme.showBrandBadge}
                            onChange={(e) =>
                              updatePlayerTheme({ showBrandBadge: e.target.checked })
                            }
                            className="h-3.5 w-3.5 accent-[#f9c400]"
                          />
                          <span>شعار المشغّل</span>
                        </label>
                      </div>
                    </div>

                    {/* Live Mini-Player Preview Column */}
                    <div className="xl:col-span-6 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-bold text-[#b7c9ef]">
                        <span>معاينة حية لمربع المشغّل الداخلي</span>
                        <span className="font-latin text-[10px] text-white/60">Live Preview</span>
                      </div>

                      <div
                        style={{
                          ...buildPlayerThemeVars(activePlayerTheme),
                          backgroundColor: 'var(--pt-modal)',
                          borderColor: 'var(--pt-accent-20)',
                          borderRadius: 'var(--pt-radius)',
                        }}
                        className="border p-3 shadow-2xl"
                      >
                        <div className="grid grid-cols-12 gap-2.5 items-stretch">
                          {/* Mini Server Sidebar */}
                          <div className="col-span-4 rounded-xl bg-black/25 border border-white/[0.07] p-2 space-y-1.5">
                            <div className="flex items-center justify-between px-1 pb-1 border-b border-white/[0.06] text-[10px] font-bold text-white/80">
                              <span>السيرفرات</span>
                              <span
                                style={{
                                  backgroundColor: 'var(--pt-accent-12)',
                                  color: 'var(--pt-accent)',
                                }}
                                className="font-latin rounded px-1.5 py-0.5 text-[9px] font-black tabular-nums"
                              >
                                2
                              </span>
                            </div>
                            <div
                              style={{
                                backgroundColor: 'var(--pt-accent)',
                                color: 'var(--pt-accent-contrast)',
                                borderColor: 'var(--pt-accent-55)',
                              }}
                              className="flex items-center justify-between rounded-lg border px-2 py-1.5 text-[10px] font-extrabold"
                            >
                              <span>سيرفر 1</span>
                              <span className="font-latin text-[9px] opacity-85">HD</span>
                            </div>
                            <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.04] px-2 py-1.5 text-[10px] font-bold text-white/75">
                              <span>سيرفر 2</span>
                              <span className="font-latin text-[9px] text-white/50">HD</span>
                            </div>
                          </div>

                          {/* Mini Player Cinema Box */}
                          <div
                            style={{
                              backgroundColor: 'var(--pt-frame)',
                              borderColor: 'var(--pt-accent-35)',
                              borderRadius: 'var(--pt-radius)',
                              boxShadow: 'var(--pt-shadow)',
                            }}
                            className="col-span-8 flex flex-col border overflow-hidden"
                          >
                            {activePlayerTheme.showHeaderBar && (
                              <div
                                style={{ backgroundColor: 'var(--pt-frame)' }}
                                className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-white/[0.08]"
                              >
                                <div className="flex items-center gap-1.5 min-w-0">
                                  {activePlayerTheme.showBrandBadge && (
                                    <span
                                      style={{
                                        backgroundColor: 'var(--pt-accent)',
                                        color: 'var(--pt-accent-contrast)',
                                      }}
                                      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded"
                                    >
                                      <Play className="w-2.5 h-2.5 fill-current" />
                                    </span>
                                  )}
                                  <span className="text-[10px] font-extrabold text-white truncate">
                                    {activePlayerTheme.brandLabel || 'RahaL TV'}
                                  </span>
                                </div>
                                <span className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[9px] font-bold text-white/75">
                                  تكبير
                                </span>
                              </div>
                            )}

                            <div className="aspect-video w-full bg-[#03060a] flex items-center justify-center">
                              <div
                                style={{
                                  backgroundColor: 'var(--pt-accent-20)',
                                  borderColor: 'var(--pt-accent-55)',
                                  color: 'var(--pt-accent)',
                                }}
                                className="flex h-9 w-9 items-center justify-center rounded-full border"
                              >
                                <Play className="w-4 h-4 fill-current" />
                              </div>
                            </div>

                            {activePlayerTheme.showFooterBar && (
                              <div
                                style={{ backgroundColor: 'var(--pt-frame)' }}
                                className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-t border-white/[0.08]"
                              >
                                <span className="text-[9px] font-bold text-white/60 truncate">
                                  مشغل {activePlayerTheme.brandLabel || 'RahaL TV'} المحمي
                                </span>
                                <span
                                  style={{
                                    backgroundColor: 'var(--pt-accent)',
                                    color: 'var(--pt-accent-contrast)',
                                  }}
                                  className="rounded px-2 py-0.5 text-[9px] font-extrabold shrink-0"
                                >
                                  السيرفر التالي
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={busyAction}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] px-6 py-3 text-xs font-extrabold text-white shadow-lg cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{busyAction ? 'جاري الحفظ...' : 'حفظ الإعدادات في Firestore'}</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* ---------------- COMPLETE 4-TAB ADD/EDIT MEDIA MODAL ---------------- */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
          <div
            className="fixed inset-0 bg-black/82 backdrop-blur-sm"
            onClick={() => setEditingItem(null)}
          />
          <form
            onSubmit={handleSaveMedia}
            className="relative z-10 w-full max-w-4xl max-h-[92vh] flex flex-col rounded-3xl bg-[#0c1821] border border-white/15 shadow-2xl overflow-hidden"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between bg-[#1a242e] px-5 py-3.5 border-b border-white/10">
              <div className="flex items-center gap-3 min-w-0">
                <Film className="w-5 h-5 text-[#D92321] shrink-0" />
                <h3 className="font-display text-sm sm:text-base font-extrabold text-white truncate">
                  {isCreatingNew
                    ? 'إضافة فيلم / مسلسل جديد إلى RahaL TV'
                    : `تعديل: ${editingItem.title}`}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-[#D92321] cursor-pointer"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 4 Sub-tabs Strip */}
            <div className="flex flex-wrap gap-1.5 bg-[#09131b] px-5 py-2.5 border-b border-white/10">
              {(
                [
                  { id: 'basic', label: '1. البيانات الأساسية والقصة', icon: Film },
                  {
                    id: 'servers',
                    label: `2. سيرفرات المشاهدة (${editingItem.servers?.length || 0})`,
                    icon: Server,
                  },
                  {
                    id: 'downloads',
                    label: `3. روابط التحميل (${editingItem.downloads?.length || 0})`,
                    icon: Download,
                  },
                  {
                    id: 'seasons_cast',
                    label: `4. الحلقات (${editingItem.seasons?.reduce((a, s) => a + s.episodes.length, 0) || 0}) وطاقم العمل`,
                    icon: Layers,
                  },
                ] as const
              ).map((sub) => {
                const SubIcon = sub.icon;
                return (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setEditorTab(sub.id)}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-extrabold transition-colors cursor-pointer ${
                      editorTab === sub.id
                        ? 'bg-[#D92321] text-white'
                        : 'bg-[#1a242e] text-[#b7c9ef] hover:text-white'
                    }`}
                  >
                    <SubIcon className="w-3.5 h-3.5" />
                    <span>{sub.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Modal Scrollable Body */}
            <div className="overflow-y-auto p-5 sm:p-6 space-y-5 flex-1">
              {/* SUB-TAB 1: BASIC INFO */}
              {editorTab === 'basic' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-[#b7c9ef] mb-1">
                        اسم العمل (بالعربية) *
                      </label>
                      <input
                        type="text"
                        required
                        value={editingItem.title}
                        onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value })}
                        placeholder="مثال: فيلم Gladiator II 2026"
                        className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-sm text-white focus:border-[#D92321] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#b7c9ef] mb-1">
                        الاسم بالإنجليزية
                      </label>
                      <input
                        type="text"
                        dir="ltr"
                        value={editingItem.englishTitle}
                        onChange={(e) =>
                          setEditingItem({ ...editingItem, englishTitle: e.target.value })
                        }
                        placeholder="Gladiator II"
                        className="font-latin w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-sm text-white focus:border-[#D92321] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-[#b7c9ef] mb-1">النوع</label>
                      <select
                        value={editingItem.kind}
                        onChange={(e) =>
                          setEditingItem({ ...editingItem, kind: e.target.value as MediaKind })
                        }
                        className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2.5 text-xs font-bold text-white"
                      >
                        <option value="movie">فيلم</option>
                        <option value="series">مسلسل</option>
                        <option value="tv">برنامج / مسرحية</option>
                        <option value="wrestling">مصارعة حرة</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#b7c9ef] mb-1">السنة</label>
                      <input
                        type="text"
                        value={editingItem.year}
                        onChange={(e) => setEditingItem({ ...editingItem, year: e.target.value })}
                        className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2.5 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#b7c9ef] mb-1">الجودة</label>
                      <input
                        type="text"
                        value={editingItem.quality}
                        onChange={(e) =>
                          setEditingItem({ ...editingItem, quality: e.target.value })
                        }
                        className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2.5 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#b7c9ef] mb-1">
                        تقييم IMDb
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="1"
                        max="10"
                        value={editingItem.imdb}
                        onChange={(e) =>
                          setEditingItem({ ...editingItem, imdb: Number(e.target.value) || 7.5 })
                        }
                        className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2.5 text-xs text-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-[#b7c9ef] mb-1">المدة</label>
                      <input
                        type="text"
                        value={editingItem.duration}
                        onChange={(e) =>
                          setEditingItem({ ...editingItem, duration: e.target.value })
                        }
                        className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2.5 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#b7c9ef] mb-1">البلد</label>
                      <input
                        type="text"
                        value={editingItem.country}
                        onChange={(e) =>
                          setEditingItem({ ...editingItem, country: e.target.value })
                        }
                        className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2.5 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#b7c9ef] mb-1">اللغة</label>
                      <input
                        type="text"
                        value={editingItem.language}
                        onChange={(e) =>
                          setEditingItem({ ...editingItem, language: e.target.value })
                        }
                        className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2.5 text-xs text-white"
                      />
                    </div>
                  </div>

                  {/* Poster Selector + Direct URL */}
                  <div className="rounded-2xl bg-[#1a242e]/60 border border-white/[0.08] p-4 grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
                    <div className="sm:col-span-2 flex justify-center">
                      <img
                        src={editingItem.poster || ASSETS.runningMan}
                        alt="معاينة البوستر"
                        className="h-28 w-20 rounded-xl object-cover border border-white/15"
                      />
                    </div>
                    <div className="sm:col-span-10 space-y-2.5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                            اختيار سريع من البوسترات الجاهزة
                          </label>
                          <select
                            value={
                              POSTER_CHOICES.some((p) => p.url === editingItem.poster)
                                ? editingItem.poster
                                : ''
                            }
                            onChange={(e) => {
                              if (e.target.value) {
                                setEditingItem({ ...editingItem, poster: e.target.value });
                              }
                            }}
                            className="w-full rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-xs text-white"
                          >
                            <option value="">-- رابط مخصص أو اختر بوستر --</option>
                            {POSTER_CHOICES.map((p) => (
                              <option key={p.url} value={p.url}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                            رابط صورة البوستر (URL)
                          </label>
                          <input
                            type="text"
                            dir="ltr"
                            value={editingItem.poster}
                            onChange={(e) =>
                              setEditingItem({ ...editingItem, poster: e.target.value })
                            }
                            placeholder="https://..."
                            className="font-latin w-full rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-xs text-white"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                            رابط الخلفية العريضة (Backdrop URL)
                          </label>
                          <input
                            type="text"
                            dir="ltr"
                            value={editingItem.backdrop}
                            onChange={(e) =>
                              setEditingItem({ ...editingItem, backdrop: e.target.value })
                            }
                            className="font-latin w-full rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-xs text-white"
                          />
                        </div>
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <label className="block text-[11px] font-bold text-[#b7c9ef]">
                              رابط التريلر (YouTube أو MP4)
                            </label>
                            <button
                              type="button"
                              disabled={fetchingTrailer}
                              onClick={() => void handleAutoFetchTrailerForEditor()}
                              className="inline-flex items-center gap-1 rounded-md bg-[#D92321]/20 hover:bg-[#D92321] border border-[#D92321]/40 px-2 py-0.5 text-[10px] font-bold text-[#ff8a88] hover:text-white cursor-pointer"
                            >
                              {fetchingTrailer ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Wand2 className="w-3 h-3" />
                              )}
                              <span>{fetchingTrailer ? 'جاري البحث...' : 'جلب تلقائي'}</span>
                            </button>
                          </div>
                          <input
                            type="text"
                            dir="ltr"
                            value={editingItem.trailerUrl || ''}
                            onChange={(e) =>
                              setEditingItem({ ...editingItem, trailerUrl: e.target.value })
                            }
                            placeholder="https://www.youtube.com/watch?v=..."
                            className="font-latin w-full rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-xs text-white"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-[#b7c9ef] mb-1">
                        التصنيفات (افصل بفاصلة)
                      </label>
                      <input
                        type="text"
                        value={categoriesText}
                        onChange={(e) => setCategoriesText(e.target.value)}
                        placeholder="افلام، افلام اجنبية"
                        className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#b7c9ef] mb-1">
                        الأنواع الفنية (افصل بفاصلة)
                      </label>
                      <input
                        type="text"
                        value={genresText}
                        onChange={(e) => setGenresText(e.target.value)}
                        placeholder="اكشن، خيال علمي، إثارة"
                        className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-xs text-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#b7c9ef] mb-1">
                      قصة العمل *
                    </label>
                    <textarea
                      rows={3}
                      required
                      value={editingItem.story}
                      onChange={(e) => setEditingItem({ ...editingItem, story: e.target.value })}
                      placeholder="اكتب نبذة مشوقة عن أحداث الفيلم أو المسلسل..."
                      className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-sm text-white focus:border-[#D92321] focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-wrap gap-5 pt-1">
                    <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(editingItem.pinned)}
                        onChange={(e) =>
                          setEditingItem({ ...editingItem, pinned: e.target.checked })
                        }
                        className="h-4 w-4 accent-[#f9c400]"
                      />
                      <span>تثبيت في السلايدر الرئيسي</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(editingItem.isNew)}
                        onChange={(e) =>
                          setEditingItem({ ...editingItem, isNew: e.target.checked })
                        }
                        className="h-4 w-4 accent-[#4CAF50]"
                      />
                      <span>إضافة شارة جديد (أحدث الإضافات)</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(editingItem.comingSoon)}
                        onChange={(e) =>
                          setEditingItem({ ...editingItem, comingSoon: e.target.checked })
                        }
                        className="h-4 w-4 accent-[#D92321]"
                      />
                      <span>عرض في قسم قريباً</span>
                    </label>
                  </div>
                </div>
              )}

              {/* SUB-TAB 2: WATCH SERVERS (URL OR IFRAME EMBED CODE) */}
              {editorTab === 'servers' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-extrabold text-white">
                        سيرفرات المشاهدة (روابط مباشرة أو أكواد iframe)
                      </h4>
                      <p className="text-xs text-[#b7c9ef]">
                        أضف عددًا غير محدود من السيرفرات، ويتم فحص حالة كل رابط تلقائيًا (يعمل / تحذير تضمين / معطل 404).
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {(editingItem.servers || []).length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const urls = (editingItem.servers || [])
                              .map((s) => resolveWatchServerUrl(s))
                              .filter((u) => /^https?:\/\//i.test(u));
                            void checkServerUrls(urls, true);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-sky-500/20 border border-sky-400/30 px-3.5 py-2 text-xs font-extrabold text-sky-300 cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>فحص كل السيرفرات الآن</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={addServerRow}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] px-4 py-2 text-xs font-extrabold text-white cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        <span>إضافة سيرفر مشاهدة</span>
                      </button>
                    </div>
                  </div>

                  {(editingItem.servers || []).length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/15 py-10 text-center text-xs text-[#b7c9ef]">
                      لا توجد سيرفرات مشاهدة مضافة بعد. اضغط على "إضافة سيرفر مشاهدة" أعلاه.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(editingItem.servers || []).map((srv, idx) => {
                        const mode = srv.mode || (srv.embedCode ? 'embed' : 'url');
                        const detectedSrc = extractIframeSrcPreview(srv.embedCode);
                        const effectiveUrl = resolveWatchServerUrl(srv);
                        const isPortalUrl = Boolean(effectiveUrl && isLikelyNonVideoWebsiteUrl(effectiveUrl));
                        return (
                          <div
                            key={srv.id || idx}
                            className={`rounded-2xl border p-4 space-y-3 ${
                              isPortalUrl
                                ? 'bg-[#D92321]/10 border-[#D92321]/50'
                                : 'bg-[#1a242e]/85 border-white/10'
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-lg bg-[#D92321] px-2.5 py-0.5 text-[11px] font-black text-white tabular-nums">
                                  سيرفر {idx + 1}
                                </span>
                                {renderServerStatusBadge(effectiveUrl)}
                                {isPortalUrl && (
                                  <span className="rounded-md bg-[#D92321]/20 border border-[#D92321]/40 px-2 py-0.5 text-[10px] font-bold text-[#ff8a88]">
                                    تحذير: رابط موقع رئيسي وليس فيديو
                                  </span>
                                )}
                                <div className="flex rounded-lg bg-[#0c1821] p-0.5 border border-white/10">
                                  <button
                                    type="button"
                                    onClick={() => updateServerRow(idx, { mode: 'url' })}
                                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold cursor-pointer ${
                                      mode === 'url'
                                        ? 'bg-[#4CAF50] text-white'
                                        : 'text-[#b7c9ef] hover:text-white'
                                    }`}
                                  >
                                    <Link2 className="w-3 h-3" />
                                    <span>رابط (URL / MP4)</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => updateServerRow(idx, { mode: 'embed' })}
                                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold cursor-pointer ${
                                      mode === 'embed'
                                        ? 'bg-[#f9c400] text-[#06131c]'
                                        : 'text-[#b7c9ef] hover:text-white'
                                    }`}
                                  >
                                    <Code2 className="w-3 h-3" />
                                    <span>كود تضمين (Iframe)</span>
                                  </button>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => moveServerRow(idx, -1)}
                                  title="تحريك لأعلى"
                                  className="rounded-lg bg-[#0c1821] p-1.5 text-[#b7c9ef] hover:text-white disabled:opacity-30 cursor-pointer"
                                >
                                  <ArrowUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === (editingItem.servers || []).length - 1}
                                  onClick={() => moveServerRow(idx, 1)}
                                  title="تحريك لأسفل"
                                  className="rounded-lg bg-[#0c1821] p-1.5 text-[#b7c9ef] hover:text-white disabled:opacity-30 cursor-pointer"
                                >
                                  <ArrowDown className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeServerRow(idx)}
                                  className="inline-flex items-center gap-1 rounded-lg bg-[#0c1821] px-2.5 py-1.5 text-[11px] font-bold text-[#D92321] hover:bg-[#D92321] hover:text-white cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>حذف السيرفر</span>
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                              <input
                                type="text"
                                readOnly
                                value={`سيرفر ${idx + 1}`}
                                title="يُرقّم تلقائياً: سيرفر 1، سيرفر 2..."
                                className="rounded-xl bg-[#0c1821]/70 border border-[#D92321]/30 px-3 py-2 text-xs font-extrabold text-white/90"
                              />
                              <input
                                type="text"
                                value={srv.quality}
                                onChange={(e) => updateServerRow(idx, { quality: e.target.value })}
                                placeholder="الجودة (1080p)"
                                className="rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-xs text-white"
                              />
                              <input
                                type="text"
                                value={srv.speed}
                                onChange={(e) => updateServerRow(idx, { speed: e.target.value })}
                                placeholder="السرعة (فائق السرعة)"
                                className="rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-xs text-white"
                              />
                              <input
                                type="text"
                                value={srv.tag}
                                onChange={(e) => updateServerRow(idx, { tag: e.target.value })}
                                placeholder="الشارة (MP4 / Embed)"
                                className="rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-xs text-white"
                              />
                            </div>

                            {mode === 'url' ? (
                              <div>
                                <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                                  رابط المشاهدة أو ملف الفيديو المباشر (https://...)
                                </label>
                                <input
                                  type="text"
                                  dir="ltr"
                                  value={srv.url || ''}
                                  onChange={(e) => updateServerRow(idx, { url: e.target.value })}
                                  placeholder="https://example.com/embed/video123 أو https://cdn.../movie.mp4"
                                  className="font-latin w-full rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2.5 text-xs text-white focus:border-[#4CAF50] focus:outline-none"
                                />
                              </div>
                            ) : (
                              <div>
                                <label className="block text-[11px] font-bold text-[#b7c9ef] mb-1">
                                  كود التضمين (&lt;iframe src=&quot;...&quot;&gt;&lt;/iframe&gt;)
                                </label>
                                <textarea
                                  rows={2}
                                  dir="ltr"
                                  value={srv.embedCode || ''}
                                  onChange={(e) =>
                                    updateServerRow(idx, { embedCode: e.target.value })
                                  }
                                  placeholder='<iframe src="https://vidstream.example/e/abc" width="100%" height="100%" allowfullscreen></iframe>'
                                  className="font-latin w-full rounded-xl bg-[#0c1821] border border-white/10 p-2.5 text-xs text-white focus:border-[#f9c400] focus:outline-none"
                                />
                                {srv.embedCode && (
                                  <p className="mt-1 text-[11px] text-[#4CAF50] font-latin truncate">
                                    {detectedSrc
                                      ? `✓ تم استخراج رابط التضمين الآمن: ${detectedSrc}`
                                      : '⚠ تأكد من وجود src="https://..." داخل كود iframe'}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* SUB-TAB 3: DOWNLOAD MIRRORS */}
              {editorTab === 'downloads' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-extrabold text-white">روابط وسيرفرات التحميل</h4>
                      <p className="text-xs text-[#b7c9ef]">
                        أضف روابط التحميل المباشرة (MediaFire, Mega, Google Drive, GoFile وغيرها).
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={addDownloadRow}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] px-4 py-2 text-xs font-extrabold text-white cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>إضافة رابط تحميل</span>
                    </button>
                  </div>

                  {(editingItem.downloads || []).length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/15 py-10 text-center text-xs text-[#b7c9ef]">
                      لا توجد روابط تحميل مضافة بعد.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(editingItem.downloads || []).map((dl, idx) => (
                        <div
                          key={dl.id || idx}
                          className="rounded-2xl bg-[#1a242e]/85 border border-white/10 p-4 space-y-3"
                        >
                          <div className="flex items-center justify-between">
                            <span className="rounded-lg bg-[#4CAF50]/20 px-2.5 py-0.5 text-[11px] font-black text-[#4CAF50]">
                              رابط تحميل #{idx + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeDownloadRow(idx)}
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-[#D92321] hover:underline cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>حذف</span>
                            </button>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                            <input
                              type="text"
                              value={dl.host}
                              onChange={(e) => updateDownloadRow(idx, { host: e.target.value })}
                              placeholder="المضيف (MediaFire)"
                              className="rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-xs text-white"
                            />
                            <input
                              type="text"
                              value={dl.quality}
                              onChange={(e) => updateDownloadRow(idx, { quality: e.target.value })}
                              placeholder="الجودة (1080p)"
                              className="rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-xs text-white"
                            />
                            <input
                              type="text"
                              value={dl.size}
                              onChange={(e) => updateDownloadRow(idx, { size: e.target.value })}
                              placeholder="الحجم (1.8 GB)"
                              className="rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-xs text-white"
                            />
                            <input
                              type="text"
                              value={dl.format}
                              onChange={(e) => updateDownloadRow(idx, { format: e.target.value })}
                              placeholder="الصيغة (MP4 / MKV)"
                              className="rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2 text-xs text-white"
                            />
                          </div>

                          <input
                            type="text"
                            dir="ltr"
                            value={dl.url || ''}
                            onChange={(e) => updateDownloadRow(idx, { url: e.target.value })}
                            placeholder="https://download.example.com/file.mp4"
                            className="font-latin w-full rounded-xl bg-[#0c1821] border border-white/10 px-3 py-2.5 text-xs text-white focus:border-[#4CAF50] focus:outline-none"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* SUB-TAB 4: SEASONS, EPISODES & CAST */}
              {editorTab === 'seasons_cast' && (
                <div className="space-y-6">
                  {/* Seasons & Episodes Section */}
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-extrabold text-white">
                          إدارة المواسم والحلقات (للمسلسلات والبرامج)
                        </h4>
                        <p className="text-xs text-[#b7c9ef]">
                          يمكنك إضافة مواسم وتوليد حلقات تلقائيًا، مع وضع رابط أو كود iframe خاص بكل حلقة.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={addSeason}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#D92321] hover:bg-[#dc0e30] px-4 py-2 text-xs font-extrabold text-white cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        <span>إضافة موسم جديد</span>
                      </button>
                    </div>

                    {(editingItem.seasons || []).length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/15 py-6 text-center text-xs text-[#b7c9ef]">
                        لا توجد مواسم مضافة (مناسب للأفلام الفردية). اضغط "إضافة موسم جديد" إذا كان
                        العمل مسلسلًا.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {(editingItem.seasons || []).map((season, sIdx) => (
                          <div
                            key={sIdx}
                            className="rounded-2xl bg-[#1a242e]/80 border border-white/10 p-4 space-y-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/10">
                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  type="text"
                                  value={season.label}
                                  onChange={(e) => {
                                    const seasons = [...(editingItem.seasons || [])];
                                    seasons[sIdx] = { ...season, label: e.target.value };
                                    setEditingItem({ ...editingItem, seasons });
                                  }}
                                  className="rounded-lg bg-[#0c1821] border border-white/10 px-3 py-1.5 text-xs font-extrabold text-white w-36"
                                />
                                <input
                                  type="text"
                                  value={season.year}
                                  onChange={(e) => {
                                    const seasons = [...(editingItem.seasons || [])];
                                    seasons[sIdx] = { ...season, year: e.target.value };
                                    setEditingItem({ ...editingItem, seasons });
                                  }}
                                  className="rounded-lg bg-[#0c1821] border border-white/10 px-3 py-1.5 text-xs text-white w-20"
                                />
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <div className="flex items-center gap-1 rounded-lg bg-[#0c1821] border border-white/10 px-2 py-1">
                                  <input
                                    type="number"
                                    min={1}
                                    max={50}
                                    value={quickGenCount}
                                    onChange={(e) =>
                                      setQuickGenCount(Math.max(1, Number(e.target.value) || 1))
                                    }
                                    className="w-12 bg-transparent text-center text-xs font-bold text-white focus:outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => generateEpisodesForSeason(sIdx, quickGenCount)}
                                    className="rounded-md bg-[#4CAF50] px-2.5 py-1 text-[11px] font-extrabold text-white cursor-pointer"
                                  >
                                    توليد حلقات
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => addEpisodeToSeason(sIdx)}
                                  className="inline-flex items-center gap-1 rounded-lg bg-sky-500/20 text-sky-300 hover:bg-sky-500 hover:text-white px-2.5 py-1.5 text-[11px] font-bold cursor-pointer"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>حلقة</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => removeSeason(sIdx)}
                                  className="inline-flex items-center gap-1 rounded-lg bg-[#0c1821] text-[#D92321] hover:bg-[#D92321] hover:text-white px-2.5 py-1.5 text-[11px] font-bold cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>حذف الموسم</span>
                                </button>
                              </div>
                            </div>

                            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                              {season.episodes.map((ep, epIdx) => (
                                <div
                                  key={epIdx}
                                  className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center rounded-xl bg-[#0c1821] p-2.5 border border-white/[0.06]"
                                >
                                  <input
                                    type="number"
                                    min={1}
                                    value={ep.number}
                                    onChange={(e) =>
                                      updateEpisode(sIdx, epIdx, {
                                        number: Number(e.target.value) || 1,
                                      })
                                    }
                                    className="sm:col-span-1 rounded-lg bg-[#1a242e] px-2 py-1.5 text-center text-xs font-bold text-[#f9c400]"
                                    aria-label="رقم الحلقة"
                                  />
                                  <input
                                    type="text"
                                    value={ep.title}
                                    onChange={(e) =>
                                      updateEpisode(sIdx, epIdx, { title: e.target.value })
                                    }
                                    placeholder="عنوان الحلقة"
                                    className="sm:col-span-3 rounded-lg bg-[#1a242e] px-2.5 py-1.5 text-xs text-white"
                                  />
                                  <input
                                    type="text"
                                    value={ep.duration}
                                    onChange={(e) =>
                                      updateEpisode(sIdx, epIdx, { duration: e.target.value })
                                    }
                                    placeholder="المدة"
                                    className="sm:col-span-2 rounded-lg bg-[#1a242e] px-2.5 py-1.5 text-xs text-white"
                                  />
                                  <div className="sm:col-span-5 flex flex-wrap items-center gap-2">
                                    <input
                                      type="text"
                                      dir="ltr"
                                      value={ep.embedCode || ep.watchUrl || ''}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        if (val.includes('<iframe')) {
                                          updateEpisode(sIdx, epIdx, { embedCode: val, watchUrl: '' });
                                        } else {
                                          updateEpisode(sIdx, epIdx, { watchUrl: val, embedCode: '' });
                                        }
                                      }}
                                      placeholder="رابط المشاهدة أو كود <iframe> للحلقة"
                                      className="font-latin flex-1 min-w-[180px] rounded-lg bg-[#1a242e] px-2.5 py-1.5 text-xs text-white"
                                    />
                                    {resolveWatchServerUrl(ep) && renderServerStatusBadge(resolveWatchServerUrl(ep), true)}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => removeEpisode(sIdx, epIdx)}
                                    className="sm:col-span-1 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#D92321] hover:bg-[#D92321] hover:text-white cursor-pointer justify-self-end"
                                    aria-label="حذف الحلقة"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Cast Section */}
                  <div className="space-y-3 pt-4 border-t border-white/10">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-extrabold text-white">طاقم العمل والممثلون</h4>
                      <button
                        type="button"
                        onClick={addCastMember}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-white/10 px-3.5 py-2 text-xs font-extrabold text-white cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>إضافة ممثل</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {(editingItem.cast || []).map((c, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 rounded-xl bg-[#1a242e]/80 border border-white/10 p-2.5"
                        >
                          <input
                            type="text"
                            value={c.name}
                            onChange={(e) => updateCastMember(idx, { name: e.target.value })}
                            placeholder="اسم الممثل"
                            className="flex-1 rounded-lg bg-[#0c1821] px-2.5 py-1.5 text-xs text-white"
                          />
                          <input
                            type="text"
                            value={c.role}
                            onChange={(e) => updateCastMember(idx, { role: e.target.value })}
                            placeholder="الدور"
                            className="w-28 rounded-lg bg-[#0c1821] px-2.5 py-1.5 text-xs text-white"
                          />
                          <button
                            type="button"
                            onClick={() => removeCastMember(idx)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#D92321] hover:bg-[#D92321] hover:text-white cursor-pointer"
                            aria-label="إزالة ممثل"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#1a242e] px-5 py-3.5 border-t border-white/10">
              <div className="text-[11px] text-[#b7c9ef]">
                السيرفرات: <strong className="text-white">{editingItem.servers?.length || 0}</strong>{' '}
                • التحميل: <strong className="text-white">{editingItem.downloads?.length || 0}</strong>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="rounded-xl bg-white/5 hover:bg-white/10 px-4 py-2.5 text-xs font-bold text-[#b7c9ef] cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleOpenEditorPreview}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#f9c400] hover:bg-[#dfb20b] px-4 py-2.5 text-xs font-black text-[#06131c] shadow-lg cursor-pointer"
                >
                  <Eye className="w-4 h-4" />
                  <span>معاينة قبل النشر</span>
                </button>
                <button
                  type="submit"
                  disabled={busyAction}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] px-5 py-2.5 text-xs font-extrabold text-white shadow-lg cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {busyAction
                      ? 'جاري الحفظ...'
                      : isCreatingNew
                        ? 'نشر وحفظ العمل في Firestore'
                        : 'حفظ التعديلات'}
                  </span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ---------------- DELETE CONFIRMATION MODAL ---------------- */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setConfirmDeleteId(null)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-3xl bg-[#0c1821] border border-white/15 p-6 text-center space-y-4 shadow-2xl">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#D92321]/15 text-[#D92321]">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="font-display text-base font-extrabold text-white">
              تأكيد حذف العمل نهائيًا؟
            </h3>
            <p className="text-xs text-[#b7c9ef]">
              سيتم حذف هذا العمل وسيرفراته من قاعدة بيانات Firestore ولن يظهر للزوار بعد الآن.
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-xl bg-[#1a242e] px-5 py-2.5 text-xs font-bold text-white cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={busyAction}
                onClick={() => void handleDeleteMedia(confirmDeleteId)}
                className="rounded-xl bg-[#D92321] hover:bg-[#dc0e30] px-5 py-2.5 text-xs font-extrabold text-white cursor-pointer"
              >
                {busyAction ? 'جاري الحذف...' : 'نعم، احذف العمل'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- BULK DELETE CONFIRMATION MODAL ---------------- */}
      {confirmBulkDeleteMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setConfirmBulkDeleteMode(null)}
          />
          <div className="relative z-10 w-full max-w-md rounded-3xl bg-[#0c1821] border border-[#D92321]/40 p-6 text-center space-y-4 shadow-2xl">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#D92321]/20 text-[#D92321]">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="font-display text-base font-extrabold text-white">
              {confirmBulkDeleteMode === 'all'
                ? `تأكيد حذف كل المحتوى (${catalog.length} عمل)؟`
                : `تأكيد حذف الأعمال المحددة (${selectedMediaIds.length} عمل)؟`}
            </h3>
            <p className="text-xs text-[#b7c9ef] leading-relaxed">
              {confirmBulkDeleteMode === 'all'
                ? 'سيتم مسح جميع الأفلام والمسلسلات والعروض وسيرفراتها نهائيًا من قاعدة بيانات Firestore ولا يمكن التراجع عن هذا الإجراء.'
                : 'سيتم حذف جميع الأعمال التي قمت بتحديدها نهائيًا من قاعدة بيانات Firestore.'}
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmBulkDeleteMode(null)}
                className="rounded-xl bg-[#1a242e] px-5 py-2.5 text-xs font-bold text-white cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={busyAction}
                onClick={() => void handleConfirmBulkDelete()}
                className="rounded-xl bg-[#D92321] hover:bg-[#dc0e30] px-5 py-2.5 text-xs font-extrabold text-white shadow-lg cursor-pointer"
              >
                {busyAction
                  ? 'جاري الحذف الجماعي...'
                  : confirmBulkDeleteMode === 'all'
                    ? 'نعم، احذف كل المحتوى'
                    : 'نعم، احذف المحدد'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- PRE-PUBLISH LIVE MEDIA PREVIEW MODAL ---------------- */}
      <MediaPreviewModal
        item={previewModalState?.item || null}
        onClose={() => setPreviewModalState(null)}
        busy={busyAction}
        playerTheme={activePlayerTheme}
        publishLabel={
          previewModalState?.source === 'editor' && !isCreatingNew
            ? 'حفظ التعديلات في قاعدة البيانات'
            : 'تأكيد النشر في قاعدة البيانات'
        }
        onConfirmPublish={
          previewModalState?.source === 'editor'
            ? () => void commitSaveEditorMedia()
            : previewModalState?.source === 'scraper'
              ? () => {
                  setPreviewModalState(null);
                  void handlePublishScrapedDirectly();
                }
              : undefined
        }
      />
    </div>
  );
}
