export type AdapterContentTypeHint = 'series' | 'movie' | 'episode' | 'auto';
export type AdapterStatus = 'supported' | 'needs_fix' | 'failed';
export type AdapterVerifyMode = 'strict' | 'relaxed_headers' | 'none';

export type AdapterDiagnosticCode =
  | 'episode_count_mismatch_or_capped'
  | 'missing_servers_per_episode'
  | 'episodes_in_separate_pages_or_seasons'
  | 'pagination_or_load_more'
  | 'servers_inside_tabs'
  | 'dynamic_ajax_or_json_api'
  | 'episode_page_differs_from_series'
  | 'site_specific_server_pattern_or_names'
  | 'access_blocked_or_protection'
  | 'http_or_timeout_error';

export type DiagnosticSeverity = 'critical' | 'warning' | 'info';

export interface ScraperDiagnosticIssue {
  code: AdapterDiagnosticCode;
  severity: DiagnosticSeverity;
  title: string;
  probableCause: string;
  suggestedFix: string;
  evidence: string;
}

export interface ScraperAdapterPageDetection {
  seriesUrlPattern: string;
  movieUrlPattern: string;
  episodeUrlPattern: string;
  watchSubpageSelector: string;
  watchSubpageUrlPattern: string;
  downloadSubpageSelector: string;
}

export interface ScraperAdapterEpisodeRules {
  containerSelector: string;
  linkSelector: string;
  seasonTabSelector: string;
  seasonPanelSelector: string;
  selectSeasonSelector: string;
  selectEpisodeOptionSelector: string;
  episodeNumberRegex: string;
  episodeIdParam: string;
  preserveMultiSeason: boolean;
  maxEpisodes: number;
}

export interface ScraperAdapterServerRules {
  itemSelector: string;
  urlAttributes: string[];
  nameSelector: string;
  preserveServerNames: boolean;
  onclickUrlRegex: string;
  scriptUrlRegex: string;
  ajaxEndpointPattern: string;
  ajaxMethod: 'GET' | 'POST';
  ajaxIdAttribute: string;
  maxServersPerEpisode: number;
}

export interface ScraperAdapterNavigationRules {
  paginationSelector: string;
  loadMoreSelector: string;
  followPagination: boolean;
  maxPaginationPages: number;
  followWatchSubpage: boolean;
  followDownloadSubpage: boolean;
  listingCardSelector: string;
  listingLinkSelector: string;
}

export interface ScraperAdapterSiteSettings {
  requestDelayMs: number;
  verifyMode: AdapterVerifyMode;
  refererMode: 'source_url' | 'origin' | 'none';
  cmsFingerprint: string;
  notes: string;
}

export interface ScraperAdapterTestSummary {
  testedUrl: string;
  contentTypeTested: AdapterContentTypeHint;
  episodesDiscovered: number;
  totalServersExtracted: number;
  avgServersPerEpisode: number;
  minServersPerEpisode: number;
  maxServersPerEpisode: number;
  missingEpisodesCount: number;
  failedServersCount: number;
  visibleEpisodesHint: number;
  visibleServersHint: number;
  recommendedStatus: AdapterStatus;
  summaryText: string;
  testedAt: string;
}

export interface ScraperAdapter {
  id: string;
  name: string;
  domain: string;
  domainAliases: string[];
  enabled: boolean;
  status: AdapterStatus;
  contentTypeHint: AdapterContentTypeHint;
  sampleUrl: string;
  version: number;
  pageDetection: ScraperAdapterPageDetection;
  episodeRules: ScraperAdapterEpisodeRules;
  serverRules: ScraperAdapterServerRules;
  navigationRules: ScraperAdapterNavigationRules;
  siteSettings: ScraperAdapterSiteSettings;
  lastTestSummary?: ScraperAdapterTestSummary;
  updatedBy?: string;
  createdAtMs?: number;
  updatedAtMs?: number;
}

export interface ScraperAdapterVersionRecord {
  versionId: string;
  adapterId: string;
  version: number;
  changeNote: string;
  snapshot: ScraperAdapter;
  savedBy: string;
  createdAtMs?: number;
}

export interface DiscoveredApiEndpoint {
  type: 'wordpress_rest' | 'blogger_feed' | 'ajax_embed' | 'admin_ajax' | 'json_ld' | 'next_data' | 'custom_json';
  url: string;
  method: 'GET' | 'POST';
  reachable: boolean;
  sampleNote: string;
}

export interface SiteStructureSignals {
  httpStatus: number;
  finalUrl: string;
  pageTitle: string;
  cmsFingerprint: string;
  isProtectedOrBlocked: boolean;
  protectionReason?: string;
  hasTabsForServers: boolean;
  serverTabSelectorMatched: string;
  serverContainerCount: number;
  hasSeasonTabs: boolean;
  seasonCountDetected: number;
  hasSelectEpisodeDropdown: boolean;
  visibleEpisodeCount: number;
  visibleServerCount: number;
  hasPagination: boolean;
  paginationLinks: string[];
  hasLoadMoreButton: boolean;
  hasWatchSubpage: boolean;
  watchSubpageUrl: string;
  hasDownloadSubpage: boolean;
  downloadSubpageUrl: string;
  episodeIdParamsFound: string[];
  discoveredApis: DiscoveredApiEndpoint[];
  sampleServerNames: string[];
  sampleEpisodeLabels: string[];
}

export interface ScraperSiteAnalysisReport {
  ok: boolean;
  targetUrl: string;
  domain: string;
  contentTypeHint: AdapterContentTypeHint;
  analyzedAt: string;
  signals: SiteStructureSignals;
  diagnostics: ScraperDiagnosticIssue[];
  baselineCounts: {
    episodes: number;
    servers: number;
    seasons: number;
  };
  proposedAdapter: ScraperAdapter;
  matchedExistingAdapterId?: string;
  error?: string;
}

export interface TestedEpisodeReport {
  seasonNumber: number;
  seasonLabel: string;
  episodeNumber: number;
  title: string;
  watchUrl: string;
  sourceUrl?: string;
  watchSubpageUrl?: string;
  serverBindingValid?: boolean;
  validationNote?: string;
  serversCount: number;
  serverNames: string[];
  serverUrls: string[];
  status: 'complete' | 'partial' | 'empty';
}

export interface FailedServerReport {
  episodeNumber?: number;
  serverName: string;
  url: string;
  httpStatus?: number;
  reason: string;
}

export interface MissingEpisodeReport {
  seasonNumber: number;
  episodeNumber: number;
  reason: string;
}

export interface ScraperComparisonDiff {
  previousVersion: number;
  candidateVersion: number;
  previousEpisodes: number;
  candidateEpisodes: number;
  episodesDelta: number;
  previousServers: number;
  candidateServers: number;
  serversDelta: number;
  newlyDiscoveredServerNames: string[];
  resolvedDiagnosticCodes: AdapterDiagnosticCode[];
  summary: string;
}

export interface ScrapedAdapterPreviewMedia {
  title: string;
  englishTitle: string;
  kind: 'movie' | 'series' | 'tv' | 'wrestling';
  categories: string[];
  genres: string[];
  year: string;
  country: string;
  language: string;
  quality: string;
  duration: string;
  imdb: number;
  poster: string;
  backdrop: string;
  story: string;
  sourceUrl: string;
  trailerUrl: string;
  servers: {
    id: string;
    name: string;
    mode: 'url' | 'embed';
    url: string;
    embedCode: string;
    quality: string;
    speed: string;
    tag: string;
  }[];
  downloads: {
    id: string;
    host: string;
    quality: string;
    size: string;
    format: string;
    url: string;
  }[];
  seasons: {
    seasonNumber: number;
    label: string;
    year: string;
    episodes: {
      number: number;
      title: string;
      duration: string;
      quality: string;
      watchUrl?: string;
      sourceUrl?: string;
      watchSubpageUrl?: string;
      servers?: {
        id: string;
        name: string;
        mode: 'url' | 'embed';
        url: string;
        embedCode: string;
        quality: string;
        speed: string;
        tag: string;
      }[];
    }[];
  }[];
}

export interface ScraperTestResult {
  ok: boolean;
  testedUrl: string;
  domain: string;
  adapterId: string;
  adapterVersion: number;
  contentTypeHint: AdapterContentTypeHint;
  testedAt: string;
  durationMs: number;
  episodesDiscovered: number;
  seasonsDiscovered: number;
  totalServersExtracted: number;
  rootServersCount: number;
  avgServersPerEpisode: number;
  minServersPerEpisode: number;
  maxServersPerEpisode: number;
  extractedServerNames: string[];
  episodesReport: TestedEpisodeReport[];
  missingEpisodes: MissingEpisodeReport[];
  failedServers: FailedServerReport[];
  visibleComparison: {
    visibleEpisodesHint: number;
    extractedEpisodes: number;
    episodesCoveragePct: number;
    visibleServersHint: number;
    extractedRootServers: number;
    serversCoveragePct: number;
    completenessVerdict: 'complete' | 'partial' | 'incomplete';
    notes: string[];
  };
  diagnostics: ScraperDiagnosticIssue[];
  recommendedStatus: AdapterStatus;
  recommendedStatusReason: string;
  extractedPreview: ScrapedAdapterPreviewMedia;
  validationSummary?: {
    validEpisodes: number;
    invalidEpisodes: number;
    duplicateServerSetsCount: number;
    crossEpisodeContaminationDetected: boolean;
    notes: string[];
  };
  comparisonDiff?: ScraperComparisonDiff;
  error?: string;
}
