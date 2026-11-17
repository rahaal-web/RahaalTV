export type MediaKind = 'movie' | 'series' | 'tv' | 'wrestling';

export interface CastMember {
  name: string;
  role: string;
  initials: string;
}

export interface EpisodeItem {
  number: number;
  title: string;
  duration: string;
  quality: string;
  watchUrl?: string;
  embedCode?: string;
  servers?: StreamServer[];
}

export interface SeasonItem {
  seasonNumber: number;
  label: string;
  year: string;
  episodes: EpisodeItem[];
}

export interface StreamServer {
  id: string;
  name: string;
  mode?: 'url' | 'embed';
  url?: string;
  embedCode?: string;
  quality: string;
  speed: string;
  tag: string;
}

export interface DownloadMirror {
  id: string;
  host: string;
  quality: string;
  size: string;
  format: string;
  url?: string;
}

export interface MediaItem {
  id: string;
  slug: string;
  title: string;
  englishTitle: string;
  kind: MediaKind;
  categories: string[];
  genres: string[];
  year: string;
  country: string;
  language: string;
  quality: string;
  duration: string;
  imdb: number;
  votes: string;
  views: number;
  likes: number;
  pinned?: boolean;
  isNew?: boolean;
  comingSoon?: boolean;
  poster: string;
  backdrop: string;
  tagline: string;
  story: string;
  shortUrl: string;
  trailerUrl?: string;
  trailerLabel: string;
  trailerDuration: string;
  cast: CastMember[];
  seasons?: SeasonItem[];
  franchiseIds?: string[];
  servers: StreamServer[];
  downloads: DownloadMirror[];
  createdAtMs?: number;
  updatedAtMs?: number;
}

export interface CatalogFilterState {
  query: string;
  category: string;
  genre: string;
  year: string;
  country: string;
  language: string;
  quality: string;
  minImdb: number;
  preset: 'latest' | 'pinned' | 'views' | 'rating' | 'likes' | '';
}

export interface NavSubItem {
  label: string;
  category: string;
}

export interface NavMenuItem {
  id: string;
  label: string;
  category?: string;
  subItems?: NavSubItem[];
}

export type RequestStatus = 'pending' | 'approved' | 'completed' | 'rejected';

export interface VisitorRequest {
  id: string;
  userId?: string;
  requesterName?: string;
  title: string;
  type: 'فيلم' | 'مسلسل' | 'عرض مصارعة' | 'مسرحية';
  notes: string;
  status: RequestStatus;
  adminNote: string;
  createdAt: string;
}

export type PlayerThemePresetId =
  | 'rahaltv-crimson'
  | 'cinema-gold'
  | 'midnight-blue'
  | 'emerald-neon'
  | 'custom';

export interface PlayerThemeConfig {
  presetId: PlayerThemePresetId;
  brandLabel: string;
  accentColor: string;
  frameBgColor: string;
  modalBgColor: string;
  borderRadius: 'sharp' | 'rounded' | 'cinema';
  glowIntensity: 'none' | 'soft' | 'strong';
  showHeaderBar: boolean;
  showFooterBar: boolean;
  showBrandBadge: boolean;
}

export type HomeHeroMode = 'auto' | 'manual' | 'brand';

export type HomeSectionSource =
  | 'latest'
  | 'movies'
  | 'series'
  | 'top_rated'
  | 'trending'
  | 'ramadan'
  | 'wrestling'
  | 'category'
  | 'custom';

export interface HomeSectionConfig {
  id: string;
  title: string;
  subtitle: string;
  enabled: boolean;
  source: HomeSectionSource;
  categoryFilter?: string;
  customMediaIds?: string[];
  limit: number;
  layout: 'grid' | 'row';
}

export interface HomeLayoutConfig {
  showHero: boolean;
  heroMode: HomeHeroMode;
  heroMediaId: string;
  heroBadgeText: string;
  heroHeadline: string;
  heroDescription: string;
  heroPrimaryCta: string;
  heroShowHighlights: boolean;
  showQuickFilters: boolean;
  showCategoryBar: boolean;
  showFullLibrary: boolean;
  showRequestBanner: boolean;
  cardsPerRow: 4 | 5 | 6;
  cardStyle: 'clean' | 'classic';
  sections: HomeSectionConfig[];
}

export interface SiteSettings {
  siteName: string;
  tagline: string;
  announcementText: string;
  tickerEnabled: boolean;
  featuredLimit: number;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  playerTheme?: PlayerThemeConfig;
  homeConfig?: HomeLayoutConfig;
}

export interface UserProfileRecord {
  uid: string;
  displayName: string;
  photoURL: string;
  watchlistIds: string[];
  role: 'member' | 'admin';
}

export interface AdminRoleRecord {
  uid: string;
  displayName: string;
  addedBy: string;
}
