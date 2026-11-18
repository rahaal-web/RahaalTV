import {
  AdapterContentTypeHint,
  AdapterStatus,
  DiscoveredApiEndpoint,
  FailedServerReport,
  MissingEpisodeReport,
  ScrapedAdapterPreviewMedia,
  ScraperAdapter,
  ScraperComparisonDiff,
  ScraperDiagnosticIssue,
  ScraperSiteAnalysisReport,
  ScraperTestResult,
} from '../types/scraperAdapter';
import {
  matchAdapterForUrl,
  normalizeAdapterDomain,
  normalizeScraperAdapter,
} from './scraperAdapterUtils';
import {
  ScrapedPayload,
  cleanTextBrowser,
  decodeBase64SafeBrowser,
  fetchViaBrowserOrCorsRelay,
  filterServersInBrowser,
  findTrailerInBrowser,
  getCustomApiBaseUrl,
  isBlockedHostBrowser,
  isLikelyNonVideoWebsiteUrl,
  normalizeArabicDigitsBrowser,
  parseHtmlToMediaWithHintsBrowser,
  resolveUrlBrowser,
} from './clientScraper';

const IGNORED_AD_OR_SOCIAL_HOSTS =
  /(facebook\.com|twitter\.com|x\.com|t\.me|telegram\.me|instagram\.com|pinterest\.com|linkedin\.com|whatsapp\.com|tiktok\.com|googlesyndication\.com|doubleclick\.net|googletagmanager\.com|google-analytics\.com|adservice\.google|yandex\.ru|histats\.com|addthis\.com|sharethis\.com|disqus\.com|cloudflareinsights\.com|popads\.net|propellerads|adsterra|juicyads|exoclick|chaturbate)/i;

const IGNORED_PAGE_CONTAINER_SELECTOR =
  'header, nav, footer, .navbar, .ads, .banner, .pm-ads-banner, .ad-box, .trailer, #trailer';

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canonicalizeCompareUrl(rawUrl?: string): string {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl.trim());
    u.hash = '';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return String(rawUrl || '').trim().replace(/\/+$/, '');
  }
}

function isYoutubeUrl(rawUrl: string): boolean {
  return /(?:^https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/|youtu\.be\/|youtube-nocookie\.com\/)/i.test(
    rawUrl
  );
}

function isInvalidServerCandidateUrl(rawUrl: string, sourceOrigin?: string): boolean {
  try {
    const u = new URL(rawUrl.trim());
    if (!['http:', 'https:'].includes(u.protocol)) return true;
    const host = u.hostname.toLowerCase();
    if (isBlockedHostBrowser(host)) return true;
    if (IGNORED_AD_OR_SOCIAL_HOSTS.test(host)) return true;
    return isLikelyNonVideoWebsiteUrl(rawUrl, sourceOrigin);
  } catch {
    return true;
  }
}

function detectProtectionChallengeBrowser(
  status: number,
  html: string
): { isProtected: boolean; reason?: string } {
  const headSlice = (html || '').slice(0, 12000);
  if (
    /<title>\s*(?:Just a moment|Attention Required|Cloudflare|Access Denied|Checking your browser)/i.test(
      headSlice
    ) ||
    /challenge-platform|cf-turnstile|g-recaptcha|hcaptcha\.com\/1\/api/i.test(headSlice)
  ) {
    return {
      isProtected: true,
      reason:
        'الصفحة تحتوي على تحقق بشري (Cloudflare Turnstile / CAPTCHA) — يمكن لصق سورس الصفحة (Ctrl+U) لتحليل بنيتها محلياً في المتصفح.',
    };
  }

  if (status === 401 || status === 403) {
    if (
      /login|sign\s*in|تسجيل الدخول/i.test(headSlice) &&
      /<input[^>]+type=["']password["']/i.test(headSlice)
    ) {
      return {
        isProtected: true,
        reason: `الموقع يطلب تسجيل دخول (HTTP ${status}) — لا يتم تجاوز صفحات تسجيل الدخول.`,
      };
    }
    return {
      isProtected: true,
      reason: `رفض الموقع الوصول برمز HTTP ${status} — استخدم لصق كود HTML أو فعّل Cloudflare Worker المجاني من الإعدادات.`,
    };
  }

  if (/widevine|fairplay|playready|eme.*requestMediaKeySystemAccess/i.test(html.slice(0, 35000))) {
    return {
      isProtected: true,
      reason: 'المحتوى محمي بنظام DRM (Widevine/FairPlay) — لا يتم تجاوز حماية DRM.',
    };
  }

  return { isProtected: false };
}

function parseEpisodeNumberFromLabel(label: string, href: string, customRegexStr?: string): number | null {
  const normLabel = normalizeArabicDigitsBrowser(cleanTextBrowser(label));
  if (!normLabel && !href) return null;
  if (/أحدث\s*الحلقات|جميع\s*الحلقات|كل\s*الحلقات|trailer|تريلر|اعلان|إعلان/i.test(normLabel)) {
    return null;
  }

  if (customRegexStr && customRegexStr.trim()) {
    try {
      const re = new RegExp(customRegexStr, 'i');
      const m = normLabel.match(re) || href.match(re);
      if (m) {
        const cap = m.slice(1).find((g) => g && /^\d{1,3}$/.test(g));
        if (cap) {
          const n = Number(cap);
          if (n > 0 && n <= 999) return n;
        }
      }
    } catch {
      // Ignore invalid regex and fall back
    }
  }

  const patterns = [
    /(?:الحلقة|حلقة|Episode|Ep\.?|E)\s*#?\s*(\d{1,3})/i,
    /^(\d{1,3})\s*(?:الحلقة|حلقة)\b/i,
    /^(\d{1,3})\s*[-–:|]\s*/,
  ];
  for (const pat of patterns) {
    const m = normLabel.match(pat);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (n > 0 && n <= 999) return n;
    }
  }

  if (/(?:vid=|ep=|episode|حلقة)/i.test(href)) {
    const numOnly = normLabel.match(/^(\d{1,3})$/);
    if (numOnly?.[1]) {
      const n = Number(numOnly[1]);
      if (n > 0 && n <= 999) return n;
    }
  }

  return null;
}

function parseSeasonNumberFromLabel(label: string, fallbackIdx: number): number {
  const norm = normalizeArabicDigitsBrowser(cleanTextBrowser(label));
  const m = norm.match(/(?:الموسم|موسم|Season|S)\s*#?(\d{1,2})/i);
  if (m?.[1]) {
    const n = Number(m[1]);
    if (n > 0 && n <= 50) return n;
  }
  if (/الأول|الاول|First/i.test(norm)) return 1;
  if (/الثاني|Second/i.test(norm)) return 2;
  if (/الثالث|Third/i.test(norm)) return 3;
  if (/الرابع|Fourth/i.test(norm)) return 4;
  if (/الخامس|Fifth/i.test(norm)) return 5;
  return fallbackIdx;
}

function cleanExtractedServerName(
  rawLabel: string,
  fallbackUrl: string,
  idx: number,
  preserveNames: boolean
): string {
  if (!preserveNames) return `سيرفر ${idx + 1}`;
  const cleaned = cleanTextBrowser(rawLabel)
    .replace(/^[•\-–|»›\s]+|[•\-–|«‹\s]+$/g, '')
    .replace(/^(?:سيرفر|مشاهدة|سيرفر\s*رقم)\s*\d*\s*[:\-–]?\s*/i, '')
    .replace(/\s*(?:HD|FHD|1080p|720p|480p|360p|WEB-DL|BluRay)\s*$/i, '')
    .trim();

  if (!cleaned || cleaned.length > 42 || /^(play|watch|server|embed|\d+)$/i.test(cleaned)) {
    try {
      const host = new URL(fallbackUrl).hostname.replace(/^www\./, '').split('.')[0];
      if (host && host.length >= 2) {
        return host.charAt(0).toUpperCase() + host.slice(1);
      }
    } catch {
      // Ignore
    }
    return `سيرفر ${idx + 1}`;
  }
  return cleaned;
}

function safeQueryAll(root: Document | Element, selector: string): Element[] {
  if (!selector || !selector.trim()) return [];
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function extractServersWithAdapterBrowser(
  doc: Document,
  sourceUrl: string,
  adapter: ScraperAdapter,
  defaultQuality = '1080p'
) {
  let sourceOrigin = '';
  try {
    if (sourceUrl) sourceOrigin = new URL(sourceUrl).origin;
  } catch {
    // ignore
  }

  const servers: ScrapedPayload['servers'] = [];
  const seenUrls = new Set<string>();
  const ajaxIds: { id: string; label: string }[] = [];
  const seenAjaxIds = new Set<string>();
  const preserveNames = adapter.serverRules.preserveServerNames;

  const pushServer = (rawUrlOrCode: string, preferredLabel?: string) => {
    let candidate = decodeBase64SafeBrowser(rawUrlOrCode);
    const iframeMatch = candidate.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (iframeMatch?.[1]) candidate = iframeMatch[1].trim();
    const resolved = resolveUrlBrowser(sourceUrl, candidate);
    if (!resolved) return;
    if (isYoutubeUrl(resolved)) return;
    if (isInvalidServerCandidateUrl(resolved, sourceOrigin)) return;
    if (seenUrls.has(resolved)) return;

    seenUrls.add(resolved);
    const idx = servers.length;
    if (idx >= (adapter.serverRules.maxServersPerEpisode || 20)) return;
    const name = cleanExtractedServerName(preferredLabel || '', resolved, idx, preserveNames);
    servers.push({
      id: `srv-adp-${idx + 1}`,
      name,
      mode: 'url',
      url: resolved,
      embedCode: '',
      quality: defaultQuality || '1080p',
      speed: idx === 0 ? 'فائق السرعة' : 'سريع',
      tag: idx === 0 ? 'رئيسي' : 'بديل',
    });
  };

  const urlAttrs =
    adapter.serverRules.urlAttributes.length > 0
      ? adapter.serverRules.urlAttributes
      : [
          'data-embed-url',
          'data-embed',
          'data-iframe',
          'data-server',
          'data-video',
          'data-url',
          'data-watch',
          'data-link',
          'data-play',
          'data-src',
          'value',
          'href',
        ];
  const nameSel = adapter.serverRules.nameSelector.trim();

  const inspectElementForServer = (el: Element) => {
    if (el.tagName.toLowerCase() === 'img') return;
    if (el.closest(IGNORED_PAGE_CONTAINER_SELECTOR)) return;

    let label = '';
    if (nameSel) {
      const matchedNameEl = safeQueryAll(el, nameSel)[0];
      if (matchedNameEl) label = cleanTextBrowser(matchedNameEl.textContent);
    }
    if (!label) {
      label = cleanTextBrowser(el.textContent) || cleanTextBrowser(el.getAttribute('title')) || '';
    }

    for (const attr of urlAttrs) {
      const val = el.getAttribute(attr);
      if (val && val.trim()) {
        if (attr === adapter.serverRules.ajaxIdAttribute && /^[0-9a-zA-Z_-]{1,24}$/.test(val.trim())) {
          if (!seenAjaxIds.has(val.trim())) {
            seenAjaxIds.add(val.trim());
            ajaxIds.push({ id: val.trim(), label });
          }
          continue;
        }
        if (/^[0-9a-zA-Z_-]{1,24}$/.test(val.trim()) && !/[./:?]/.test(val)) {
          if (!seenAjaxIds.has(val.trim())) {
            seenAjaxIds.add(val.trim());
            ajaxIds.push({ id: val.trim(), label });
          }
          continue;
        }
        pushServer(val, label);
        return;
      }
    }

    const onclickAttr = el.getAttribute('onclick') || '';
    if (onclickAttr) {
      if (adapter.serverRules.onclickUrlRegex) {
        try {
          const m = onclickAttr.match(new RegExp(adapter.serverRules.onclickUrlRegex, 'i'));
          if (m?.[1] || m?.[0]) {
            pushServer(m[1] || m[0], label);
            return;
          }
        } catch {
          // ignore bad regex
        }
      }
      const genericUrlMatch = onclickAttr.match(/['"]((?:https?:)?\/\/[^'"]+)['"]/i);
      if (genericUrlMatch?.[1]) {
        pushServer(genericUrlMatch[1], label);
      }
    }
  };

  if (adapter.serverRules.itemSelector.trim()) {
    safeQueryAll(doc, adapter.serverRules.itemSelector.trim()).forEach(inspectElementForServer);
  }

  safeQueryAll(
    doc,
    '[data-embed-url], [data-embed], [data-iframe], [data-server], [data-video], [data-url], [data-watch], [data-link], [data-play], .WatchList li, li[data-src], button[data-src], a[data-src]'
  ).forEach(inspectElementForServer);

  const activeTabLabel = cleanTextBrowser(
    doc.querySelector(
      '.WatchList li.active, .servers li.active, .nav-tabs li.active, [role="tab"][aria-selected="true"]'
    )?.textContent
  );

  doc.querySelectorAll('iframe').forEach((el) => {
    if (el.closest(IGNORED_PAGE_CONTAINER_SELECTOR)) return;
    const rawSrc =
      el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || '';
    if (!rawSrc) return;
    const titleAttr = cleanTextBrowser(el.getAttribute('title')) || activeTabLabel;
    pushServer(rawSrc, titleAttr);
  });

  doc.querySelectorAll('video source, video').forEach((el) => {
    const src = el.getAttribute('src');
    if (src) pushServer(src, 'سيرفر مباشر');
  });

  doc.querySelectorAll('script').forEach((el) => {
    const rawScript = el.textContent || '';
    if (!rawScript || rawScript.length < 15) return;
    const unescaped = rawScript
      .replace(/\\\//g, '/')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\n|\\r|\\t/g, ' ');

    if (adapter.serverRules.scriptUrlRegex) {
      try {
        const customRe = new RegExp(adapter.serverRules.scriptUrlRegex, 'gi');
        let cm: RegExpExecArray | null;
        while ((cm = customRe.exec(unescaped)) !== null) {
          pushServer(cm[1] || cm[0]);
        }
      } catch {
        // ignore invalid regex
      }
    }

    const iframeRegex = /<iframe[^>]+src=["']((?:https?:)?\/\/[^"'\s<>]+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = iframeRegex.exec(unescaped)) !== null) {
      pushServer(m[1]);
    }

    const b64Regex = /atob\(\s*["']([A-Za-z0-9+/=]{20,})["']\s*\)/gi;
    let bm: RegExpExecArray | null;
    while ((bm = b64Regex.exec(rawScript)) !== null) {
      const dec = decodeBase64SafeBrowser(bm[1]);
      if (!/<script/i.test(dec)) pushServer(dec);
    }

    const arrRegex =
      /(?:var|let|const|window\.)?\s*(?:servers|embeds|players|watchLinks|sources)\s*[:=]\s*\[([\s\S]{5,12000}?)\]/gi;
    let am: RegExpExecArray | null;
    while ((am = arrRegex.exec(unescaped)) !== null) {
      const urlsInArr = am[1].match(/https?:\/\/[^\s"'<>]+/gi) || [];
      for (const u of urlsInArr) {
        if (!IGNORED_AD_OR_SOCIAL_HOSTS.test(u)) pushServer(u);
      }
    }
  });

  return { servers, ajaxIds };
}

function extractSeasonsAndEpisodesWithAdapterBrowser(
  doc: Document,
  sourceUrl: string,
  adapter: ScraperAdapter,
  defaultYear = '2026',
  defaultQuality = '1080p'
) {
  const maxEp = adapter.episodeRules.maxEpisodes || 150;
  const customEpRegex = adapter.episodeRules.episodeNumberRegex.trim();

  type EpEntry = { number: number; title: string; watchUrl: string };
  const seasonMap = new Map<number, { label: string; episodes: Map<number, EpEntry> }>();

  const ensureSeason = (seasonNum: number, label?: string) => {
    const existing = seasonMap.get(seasonNum);
    if (existing) return existing;
    const cleanLbl = label && label.trim() ? label.trim() : `الموسم ${String(seasonNum).padStart(2, '0')}`;
    const created = { label: cleanLbl, episodes: new Map<number, EpEntry>() };
    seasonMap.set(seasonNum, created);
    return created;
  };

  let totalProcessedEps = 0;
  const addEpisodeToSeason = (
    seasonNum: number,
    seasonLabel: string,
    rawLabel: string,
    rawHref: string
  ) => {
    if (totalProcessedEps >= maxEp) return;
    const href = resolveUrlBrowser(sourceUrl, rawHref);
    if (!href) return;
    const epNum = parseEpisodeNumberFromLabel(rawLabel, href, customEpRegex);
    if (!epNum) return;

    const targetSeason = adapter.episodeRules.preserveMultiSeason ? seasonNum : 1;
    const targetLabel = adapter.episodeRules.preserveMultiSeason ? seasonLabel : 'الموسم 01';
    const sBucket = ensureSeason(targetSeason, targetLabel);
    if (!sBucket.episodes.has(epNum)) {
      const cleanEpTitle = cleanTextBrowser(rawLabel) || `الحلقة ${epNum}`;
      sBucket.episodes.set(epNum, {
        number: epNum,
        title: /^\d+\s*حلقة$/i.test(normalizeArabicDigitsBrowser(cleanEpTitle))
          ? `الحلقة ${epNum}`
          : cleanEpTitle.slice(0, 120),
        watchUrl: href,
      });
      totalProcessedEps += 1;
    }
  };

  // Strategy 1: Multi-season Tab + Panel pairs
  const tabLabelsByPanelId = new Map<string, string>();
  const seasonTabSel = adapter.episodeRules.seasonTabSelector.trim() || '.tablinks, .seasons-sec > li, [data-season]';
  safeQueryAll(doc, seasonTabSel).forEach((el, idx) => {
    const label = cleanTextBrowser(el.textContent);
    const onclick = el.getAttribute('onclick') || '';
    const onclickPanelMatch = onclick.match(/openCity\([^,]+,\s*['"]([^'"]+)['"]/i);
    const dataSeason =
      el.getAttribute('data-season') ||
      el.getAttribute('aria-controls') ||
      el.getAttribute('href')?.replace(/^#/, '');
    const key = onclickPanelMatch?.[1] || dataSeason || String(idx + 1);
    if (label) tabLabelsByPanelId.set(key, label);
  });

  const panelSel = adapter.episodeRules.seasonPanelSelector.trim() || '.tabcontent, .SeasonsEpisodes';
  let foundMultiSeasonPanels = false;
  const panels = safeQueryAll(doc, panelSel);
  if (panels.length > 0) {
    panels.forEach((panelEl, pIdx) => {
      const panelId = panelEl.getAttribute('id') || panelEl.getAttribute('data-season') || '';
      const matchedTabLabel = (panelId && tabLabelsByPanelId.get(panelId)) || panelId || `الموسم ${pIdx + 1}`;
      const seasonNum = parseSeasonNumberFromLabel(matchedTabLabel, pIdx + 1);
      const linkSel = adapter.episodeRules.linkSelector.trim() || 'a[href]';
      const links = safeQueryAll(panelEl, linkSel);
      if (links.length > 0) foundMultiSeasonPanels = true;
      links.forEach((aEl) => {
        addEpisodeToSeason(
          seasonNum,
          `الموسم ${String(seasonNum).padStart(2, '0')}`,
          cleanTextBrowser(aEl.textContent) || cleanTextBrowser(aEl.getAttribute('title')),
          aEl.getAttribute('href') || ''
        );
      });
    });
  }

  // Strategy 2: Paired Season + Episode <select> dropdowns
  if (!foundMultiSeasonPanels) {
    const seasonOptLabels = new Map<string, string>();
    const selectSeasonSel = adapter.episodeRules.selectSeasonSelector.trim() || 'select#mobileselect, .TabS select';
    safeQueryAll(doc, `${selectSeasonSel} option`).forEach((optEl) => {
      const val = (optEl.getAttribute('value') || '').trim();
      const lbl = cleanTextBrowser(optEl.textContent);
      if (val && lbl) seasonOptLabels.set(val, lbl);
    });

    const selectEpSel = adapter.episodeRules.selectEpisodeOptionSelector.trim() || 'select.episodeoption option, .TabE select option';
    const epOptions = safeQueryAll(doc, selectEpSel);
    if (epOptions.length > 0) {
      epOptions.forEach((optEl) => {
        const val = (optEl.getAttribute('value') || '').trim();
        if (!val || val === 'select-ep' || val === '#') return;
        const parentId = optEl.parentElement?.getAttribute('id') || '';
        const seasonKey = parentId.replace(/^Ep/i, '').trim();
        const sLabel =
          (seasonKey && seasonOptLabels.get(`Seas${seasonKey}`)) ||
          (seasonKey && seasonOptLabels.get(seasonKey)) ||
          (seasonKey ? `الموسم ${seasonKey}` : 'الموسم 01');
        const sNum = parseSeasonNumberFromLabel(sLabel, Number(seasonKey) || 1);
        addEpisodeToSeason(sNum, `الموسم ${String(sNum).padStart(2, '0')}`, cleanTextBrowser(optEl.textContent), val);
      });
    }
  }

  // Strategy 3: Generic container or full page episode anchor scan
  if (totalProcessedEps === 0) {
    const containerSel = adapter.episodeRules.containerSelector.trim();
    const linkSel = adapter.episodeRules.linkSelector.trim() || 'a[href]';
    let scannedContainer = false;

    if (containerSel) {
      const containers = safeQueryAll(doc, containerSel);
      if (containers.length > 0) {
        scannedContainer = true;
        containers.forEach((cEl, cIdx) => {
          const headingText =
            cleanTextBrowser(safeQueryAll(cEl, 'h2, h3, .season-title, .title')[0]?.textContent) ||
            cEl.getAttribute('id') ||
            '';
          const sNum = parseSeasonNumberFromLabel(headingText, cIdx + 1);
          safeQueryAll(cEl, linkSel).forEach((aEl) => {
            addEpisodeToSeason(
              sNum,
              `الموسم ${String(sNum).padStart(2, '0')}`,
              cleanTextBrowser(aEl.textContent) || cleanTextBrowser(aEl.getAttribute('title')),
              aEl.getAttribute('href') || ''
            );
          });
        });
      }
    }

    if (!scannedContainer || totalProcessedEps === 0) {
      doc.querySelectorAll('a[href]').forEach((aEl) => {
        if (aEl.closest(IGNORED_PAGE_CONTAINER_SELECTOR)) return;
        addEpisodeToSeason(
          1,
          'الموسم 01',
          cleanTextBrowser(aEl.textContent) || cleanTextBrowser(aEl.getAttribute('title')),
          aEl.getAttribute('href') || ''
        );
      });
    }
  }

  // Ensure current episode is included when detected in page heading
  const pageHeading = normalizeArabicDigitsBrowser(
    `${cleanTextBrowser(doc.querySelector('h1')?.textContent)} ${cleanTextBrowser(doc.querySelector('title')?.textContent)}`
  );
  const currSeasonNum = parseSeasonNumberFromLabel(pageHeading, 1);
  const currEpMatch = pageHeading.match(/(?:الحلقة|حلقة|Episode|Ep\.?)\s*#?(\d{1,3})/i);
  if (currEpMatch?.[1] && sourceUrl && seasonMap.size > 0) {
    const currEpNum = Number(currEpMatch[1]);
    const targetSeason = adapter.episodeRules.preserveMultiSeason ? currSeasonNum : 1;
    const sBucket = ensureSeason(targetSeason, `الموسم ${String(targetSeason).padStart(2, '0')}`);
    if (currEpNum > 0 && !sBucket.episodes.has(currEpNum)) {
      sBucket.episodes.set(currEpNum, {
        number: currEpNum,
        title: `الحلقة ${currEpNum}`,
        watchUrl: sourceUrl,
      });
    }
  }

  const tabPanelLinksCount = safeQueryAll(doc, `${panelSel} a[href]`).length;
  const selectOptionsCount = safeQueryAll(doc, 'select.episodeoption option, .TabE select option').filter((el) => {
    const v = el.getAttribute('value') || '';
    return Boolean(v && v !== 'select-ep');
  }).length;

  const seasons = Array.from(seasonMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([seasonNumber, data]) => ({
      seasonNumber,
      label: data.label,
      year: defaultYear,
      episodes: Array.from(data.episodes.values())
        .sort((a, b) => a.number - b.number)
        .map((ep) => ({
          number: ep.number,
          title: ep.title,
          duration: '45 دقيقة',
          quality: defaultQuality,
          watchUrl: ep.watchUrl,
          servers: [] as ScrapedPayload['servers'],
        })),
    }))
    .filter((s) => s.episodes.length > 0);

  const totalExtractedEps = seasons.reduce((acc, s) => acc + s.episodes.length, 0);
  const visibleEpisodesHint = Math.max(totalExtractedEps, tabPanelLinksCount, selectOptionsCount);

  const pagLinks: string[] = [];
  const pagSel =
    adapter.navigationRules.paginationSelector.trim() || 'a[rel="next"], .pagination a, .nav-links a.next, a.next';
  const baseOrigin = sourceUrl ? (() => { try { return new URL(sourceUrl).origin; } catch { return ''; } })() : '';
  safeQueryAll(doc, pagSel).forEach((el) => {
    const href = resolveUrlBrowser(sourceUrl, el.getAttribute('href'));
    if (!href || href === sourceUrl) return;
    if (baseOrigin && !href.startsWith(baseOrigin)) return;
    if (!pagLinks.includes(href)) pagLinks.push(href);
  });

  return {
    seasons,
    visibleEpisodesHint,
    paginationLinks: pagLinks.slice(0, 20),
  };
}

function findBestWatchSubpageUrlBrowser(
  doc: Document,
  sourceUrl: string,
  adapter: ScraperAdapter
): string {
  let sourceOrigin = '';
  try {
    sourceOrigin = new URL(sourceUrl).origin;
  } catch {
    return '';
  }

  let currentVid = '';
  try {
    currentVid = new URL(sourceUrl).searchParams.get(adapter.episodeRules.episodeIdParam || 'vid') || '';
  } catch {
    // ignore
  }

  const sel =
    adapter.pageDetection.watchSubpageSelector.trim() ||
    'a.xtgo, a.btnplay, a[href*="play.php"], a[href*="/watch/"]';

  const candidates: { href: string; score: number }[] = [];
  safeQueryAll(doc, sel).forEach((el) => {
    if (el.closest(IGNORED_PAGE_CONTAINER_SELECTOR)) return;
    if (el.classList.contains('btnDowns')) return;
    const href = resolveUrlBrowser(sourceUrl, el.getAttribute('href'));
    if (!href || href === sourceUrl) return;
    try {
      if (new URL(href).origin !== sourceOrigin) return;
    } catch {
      return;
    }

    let score = 0;
    const cls = el.getAttribute('class') || '';
    const text = cleanTextBrowser(el.textContent);
    if (/\bxtgo\b|btnplay|play-btn/i.test(cls)) score += 30;
    if (/play\.php/i.test(href)) score += 25;
    if (/\/watch\/|\/player\//i.test(href)) score += 18;
    if (currentVid && href.includes(currentVid)) score += 50;
    if (/مشاهدة|watch|play/i.test(text)) score += 10;
    if (/download|تحميل|70C19e669/i.test(href + ' ' + cls)) score -= 40;

    if (score > 0) candidates.push({ href, score });
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.href || '';
}

async function verifyServersBrowserList(
  servers: ScrapedPayload['servers'],
  sourceOrigin: string,
  verifyMode: ScraperAdapter['siteSettings']['verifyMode'],
  episodeNumber?: number
): Promise<{ kept: ScrapedPayload['servers']; failed: FailedServerReport[] }> {
  const failed: FailedServerReport[] = [];
  if (servers.length === 0) return { kept: [], failed };

  if (verifyMode === 'none') {
    const kept: ScrapedPayload['servers'] = [];
    for (const srv of servers) {
      if (!srv.url || isInvalidServerCandidateUrl(srv.url, sourceOrigin)) {
        failed.push({
          episodeNumber,
          serverName: srv.name,
          url: srv.url || '',
          reason: 'الرابط يفتح صفحة موقع أو نطاقاً محظوراً وليس مشغل فيديو',
        });
      } else {
        kept.push(srv);
      }
    }
    return { kept, failed };
  }

  const urls = servers
    .map((s) => s.url || '')
    .filter((u): u is string => Boolean(u));
  const checked = await filterServersInBrowser(urls);
  const statusMap = new Map(checked.map((c) => [c.url, c]));
  const kept: ScrapedPayload['servers'] = [];

  for (const srv of servers) {
    const res = srv.url ? statusMap.get(srv.url) : undefined;
    if (res && !res.ok) {
      failed.push({
        episodeNumber,
        serverName: srv.name,
        url: srv.url || '',
        httpStatus: res.httpStatus,
        reason: res.reason || 'تعذر التحقق من رابط السيرفر من المتصفح',
      });
    } else {
      kept.push(srv);
    }
  }

  return { kept, failed };
}

export async function analyzeSiteStructureInBrowser(params: {
  url: string;
  rawHtml?: string;
  contentTypeHint?: AdapterContentTypeHint;
  existingAdapters?: ScraperAdapter[];
}): Promise<ScraperSiteAnalysisReport> {
  const { url, rawHtml, contentTypeHint = 'auto', existingAdapters = [] } = params;
  const domain = normalizeAdapterDomain(url) || 'unknown-site';
  const analyzedAt = new Date().toISOString();
  const matchedExisting = url
    ? matchAdapterForUrl(url, existingAdapters, { includeDisabled: true })
    : null;

  let html = '';
  let httpStatus = 200;
  let finalUrl = url || '';
  let isProtected = false;
  let protectionReason: string | undefined;

  if (rawHtml && rawHtml.trim().length >= 50) {
    html = rawHtml;
    const canonicalMatch =
      html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] ||
      html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      '';
    finalUrl = url || canonicalMatch || 'https://example.com';
    const prot = detectProtectionChallengeBrowser(200, html);
    isProtected = prot.isProtected;
    protectionReason = prot.reason;
  } else if (url) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url.trim());
    } catch {
      return {
        ok: false,
        targetUrl: url,
        domain,
        contentTypeHint,
        analyzedAt,
        error: 'صيغة الرابط غير صالحة — يجب أن يبدأ بـ https://',
        signals: {
          httpStatus: 0,
          finalUrl: url,
          pageTitle: '',
          cmsFingerprint: 'unknown',
          isProtectedOrBlocked: false,
          hasTabsForServers: false,
          serverTabSelectorMatched: '',
          serverContainerCount: 0,
          hasSeasonTabs: false,
          seasonCountDetected: 0,
          hasSelectEpisodeDropdown: false,
          visibleEpisodeCount: 0,
          visibleServerCount: 0,
          hasPagination: false,
          paginationLinks: [],
          hasLoadMoreButton: false,
          hasWatchSubpage: false,
          watchSubpageUrl: '',
          hasDownloadSubpage: false,
          downloadSubpageUrl: '',
          episodeIdParamsFound: [],
          discoveredApis: [],
          sampleServerNames: [],
          sampleEpisodeLabels: [],
        },
        diagnostics: [],
        baselineCounts: { episodes: 0, servers: 0, seasons: 0 },
        proposedAdapter: normalizeScraperAdapter({
          domain,
          name: domain,
          sampleUrl: url,
          status: 'failed',
          contentTypeHint,
        }),
      };
    }

    if (isBlockedHostBrowser(parsedUrl.hostname)) {
      return {
        ok: false,
        targetUrl: url,
        domain,
        contentTypeHint,
        analyzedAt,
        error: 'لا يُسمح بالاتصال بالنطاقات الداخلية أو المحلية (SSRF guard)',
        signals: {
          httpStatus: 403,
          finalUrl: url,
          pageTitle: '',
          cmsFingerprint: 'unknown',
          isProtectedOrBlocked: true,
          protectionReason: 'نطاق داخلي محظور',
          hasTabsForServers: false,
          serverTabSelectorMatched: '',
          serverContainerCount: 0,
          hasSeasonTabs: false,
          seasonCountDetected: 0,
          hasSelectEpisodeDropdown: false,
          visibleEpisodeCount: 0,
          visibleServerCount: 0,
          hasPagination: false,
          paginationLinks: [],
          hasLoadMoreButton: false,
          hasWatchSubpage: false,
          watchSubpageUrl: '',
          hasDownloadSubpage: false,
          downloadSubpageUrl: '',
          episodeIdParamsFound: [],
          discoveredApis: [],
          sampleServerNames: [],
          sampleEpisodeLabels: [],
        },
        diagnostics: [],
        baselineCounts: { episodes: 0, servers: 0, seasons: 0 },
        proposedAdapter: normalizeScraperAdapter({
          domain,
          name: domain,
          sampleUrl: url,
          status: 'failed',
          contentTypeHint,
        }),
      };
    }

    const fetched = await fetchViaBrowserOrCorsRelay(parsedUrl.toString(), 13000);
    httpStatus = fetched.status || (fetched.ok ? 200 : 502);
    finalUrl = fetched.finalUrl || url;
    html = fetched.text || '';

    const prot = detectProtectionChallengeBrowser(httpStatus, html);
    isProtected = prot.isProtected;
    protectionReason = prot.reason;

    if (!fetched.ok || html.length < 80) {
      const hasWorker = Boolean(getCustomApiBaseUrl());
      const errMsg = hasWorker
        ? `تعذر جلب الصفحة عبر المتصفح وبروكسي Cloudflare (HTTP ${httpStatus}). يمكنك لصق سورس الصفحة (Ctrl+U) في حقل HTML البديل لتحليلها فوراً.`
        : 'رفض الموقع الجلب المباشر من المتصفح (CORS/Cloudflare) في وضع GitHub Pages. الصق كود HTML للصفحة في الحقل البديل لتحليلها فوراً، أو فعّل رابط Cloudflare Worker المجاني في الإعدادات.';

      const fallbackAdapter = matchedExisting
        ? normalizeScraperAdapter({
            ...matchedExisting,
            version: matchedExisting.version + 1,
            status: 'failed',
          })
        : normalizeScraperAdapter({
            domain,
            name: domain,
            sampleUrl: url,
            status: 'failed',
            contentTypeHint,
          });

      return {
        ok: false,
        targetUrl: url,
        domain,
        contentTypeHint,
        analyzedAt,
        matchedExistingAdapterId: matchedExisting?.id,
        error: protectionReason || errMsg,
        signals: {
          httpStatus,
          finalUrl,
          pageTitle: '',
          cmsFingerprint: 'unknown',
          isProtectedOrBlocked: isProtected,
          protectionReason: protectionReason || errMsg,
          hasTabsForServers: false,
          serverTabSelectorMatched: '',
          serverContainerCount: 0,
          hasSeasonTabs: false,
          seasonCountDetected: 0,
          hasSelectEpisodeDropdown: false,
          visibleEpisodeCount: 0,
          visibleServerCount: 0,
          hasPagination: false,
          paginationLinks: [],
          hasLoadMoreButton: false,
          hasWatchSubpage: false,
          watchSubpageUrl: '',
          hasDownloadSubpage: false,
          downloadSubpageUrl: '',
          episodeIdParamsFound: [],
          discoveredApis: [],
          sampleServerNames: [],
          sampleEpisodeLabels: [],
        },
        diagnostics: [
          {
            code: isProtected ? 'access_blocked_or_protection' : 'http_or_timeout_error',
            severity: 'critical',
            title: isProtected
              ? 'الموقع محمي أو يمنع الجلب المباشر من المتصفح'
              : 'تعذر جلب الصفحة عبر المتصفح',
            probableCause: protectionReason || errMsg,
            suggestedFix:
              'انسخ كود المصدر (Ctrl+U -> نسخ الكل) من المتصفح والصقه في حقل HTML البديل أعلاه، أو أضف رابط Cloudflare Worker المجاني في الإعدادات لتشغيل كامل المميزات من GitHub Pages.',
            evidence: `HTTP ${httpStatus} — ${finalUrl}`,
          },
        ],
        baselineCounts: { episodes: 0, servers: 0, seasons: 0 },
        proposedAdapter: fallbackAdapter,
      };
    }
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const pageTitle =
    cleanTextBrowser(doc.querySelector('title')?.textContent) ||
    cleanTextBrowser(doc.querySelector('h1')?.textContent);

  let cmsFingerprint = 'Custom HTML';
  if (/MELODYURL|pm-video|watch\.php\?vid=|play\.php\?vid=/i.test(html)) {
    cmsFingerprint = 'PHP Melody Streaming';
  } else if (/wp-content|wp-includes|wp-json/i.test(html)) {
    cmsFingerprint = 'WordPress';
  } else if (/blogger\.com|blogspot\.com|feeds\/posts\/default/i.test(html)) {
    cmsFingerprint = 'Blogger';
  } else if (doc.querySelector('script#__NEXT_DATA__')) {
    cmsFingerprint = 'Next.js';
  } else if (/window\.__NUXT__|__NUXT_DATA__/i.test(html)) {
    cmsFingerprint = 'Nuxt.js';
  }

  const baseline = parseHtmlToMediaWithHintsBrowser(html, finalUrl);
  const baselineEpisodes = baseline.media.seasons.reduce((acc, s) => acc + s.episodes.length, 0);
  const baselineServers = baseline.media.servers.length;
  const baselineSeasons = baseline.media.seasons.length;

  const serverCandidateSelectors = [
    '.WatchList li',
    '.servers-list li',
    '.servers-list button',
    '.servers li',
    '.servers button',
    '.watch-servers li',
    '.watch-servers button',
    '.nav-tabs li',
    '[role="tab"]',
    'select.servers option',
    '[data-embed-url]',
    '[data-embed]',
  ];

  let bestServerSelector = '';
  let bestServerEls: Element[] = [];
  for (const sel of serverCandidateSelectors) {
    const found = safeQueryAll(doc, sel).filter((el) => !el.closest(IGNORED_PAGE_CONTAINER_SELECTOR));
    if (found.length > bestServerEls.length) {
      bestServerEls = found;
      bestServerSelector = sel;
    }
  }

  const urlAttrsOrder = [
    'data-embed-url',
    'data-embed',
    'data-iframe',
    'data-server',
    'data-video',
    'data-url',
    'data-watch',
    'data-link',
    'data-play',
    'data-src',
    'value',
    'href',
  ];
  const detectedUrlAttrs = new Set<string>();
  const sampleServerNames: string[] = [];
  let explicitServerCount = 0;

  for (const el of bestServerEls) {
    let foundAttr = false;
    for (const attr of urlAttrsOrder) {
      const val = el.getAttribute(attr);
      if (val && val.trim() && val.trim() !== '#') {
        detectedUrlAttrs.add(attr);
        foundAttr = true;
        break;
      }
    }
    const onclickVal = el.getAttribute('onclick') || '';
    if (!foundAttr && /https?:\/\/|load_stream|openEmbed/i.test(onclickVal)) {
      foundAttr = true;
    }
    if (foundAttr || el.getAttribute('data-embed-id')) {
      explicitServerCount += 1;
      const lbl =
        cleanTextBrowser(el.querySelector('.name')?.textContent) || cleanTextBrowser(el.textContent);
      if (lbl && sampleServerNames.length < 15 && !sampleServerNames.includes(lbl)) {
        sampleServerNames.push(lbl);
      }
    }
  }

  const iframeCount = Array.from(doc.querySelectorAll('iframe')).filter(
    (el) => !el.closest(IGNORED_PAGE_CONTAINER_SELECTOR)
  ).length;
  const visibleServerCount = Math.max(explicitServerCount, iframeCount, baselineServers);
  const hasTabsForServers =
    bestServerEls.length >= 2 &&
    (/WatchList|nav-tabs|tab|server/i.test(bestServerSelector) || explicitServerCount > iframeCount);

  const seasonTabsCount = safeQueryAll(doc, '.tablinks, .seasons-sec > li, [data-season]').length;
  const seasonPanelsCount = safeQueryAll(doc, '.tabcontent, .SeasonsEpisodes').length;
  const hasSeasonTabs = seasonTabsCount >= 2 || seasonPanelsCount >= 2;
  const hasSelectEpisodeDropdown =
    safeQueryAll(doc, 'select.episodeoption option, .TabE select option').length > 0;

  const candidateSeed = normalizeScraperAdapter({
    ...(matchedExisting || {}),
    id: matchedExisting?.id || undefined,
    name: matchedExisting?.name || domain,
    domain,
    sampleUrl: url || finalUrl,
    contentTypeHint,
    version: matchedExisting ? matchedExisting.version + 1 : 1,
    pageDetection: {
      seriesUrlPattern: matchedExisting?.pageDetection.seriesUrlPattern || '',
      movieUrlPattern: matchedExisting?.pageDetection.movieUrlPattern || '',
      episodeUrlPattern: /play\.php|watch\.php/i.test(finalUrl) ? 'play\\.php|watch\\.php' : '',
      watchSubpageSelector: doc.querySelector('.xtgo')
        ? 'a.xtgo, a[href*="play.php"]'
        : 'a.xtgo, a.btnplay, a[href*="play.php"], a[href*="/watch/"]',
      watchSubpageUrlPattern: 'play\\.php\\?vid=|/watch/',
      downloadSubpageSelector: 'a[href*="download.php"], a[href*="/download"]',
    },
    episodeRules: {
      containerSelector: doc.querySelector('.tabcontent')
        ? '.tabcontent, .episodes-list, .pm-ul-playlist'
        : doc.querySelector('.SeasonsEpisodes')
          ? '.SeasonsEpisodes, .episodes-list'
          : '.episodes-list, .pm-ul-playlist, .list-episodes, .EpisodesList',
      linkSelector: 'a[href]',
      seasonTabSelector: '.tablinks, .seasons-sec > li, [data-season]',
      seasonPanelSelector: '.tabcontent, .SeasonsEpisodes',
      selectSeasonSelector: 'select#mobileselect, .TabS select',
      selectEpisodeOptionSelector: 'select.episodeoption option, .TabE select option',
      episodeNumberRegex: '(?:الحلقة|حلقة|Episode|Ep\\.?)\\s*#?(\\d{1,3})|^(\\d{1,3})\\s*(?:حلقة|الحلقة)',
      episodeIdParam: /[?&]vid=/.test(html) ? 'vid' : /[?&]ep=/.test(html) ? 'ep' : 'vid',
      preserveMultiSeason: true,
      maxEpisodes: 150,
    },
    serverRules: {
      itemSelector:
        bestServerSelector || '.WatchList li, .servers-list li, .servers button, .nav-tabs li, [role="tab"]',
      urlAttributes: Array.from(new Set([...detectedUrlAttrs, ...urlAttrsOrder])).slice(0, 20),
      nameSelector: '.name, span, a',
      preserveServerNames: true,
      onclickUrlRegex: '',
      scriptUrlRegex: '',
      ajaxEndpointPattern: '',
      ajaxMethod: 'POST',
      ajaxIdAttribute: doc.querySelector('[data-embed-id]') ? 'data-embed-id' : 'data-embed',
      maxServersPerEpisode: 20,
    },
    navigationRules: {
      paginationSelector: 'a[rel="next"], .pagination a, .nav-links a.next, .wp-pagenavi a, a.next',
      loadMoreSelector: '.load-more, [data-load-more], [data-ajax-episodes]',
      followPagination: true,
      maxPaginationPages: 8,
      followWatchSubpage: true,
      followDownloadSubpage: true,
      listingCardSelector: '.entry-box, .pm-video-thumb, .pm-li-video, article, .post, .movie, .card',
      listingLinkSelector: 'a[href]',
    },
    siteSettings: {
      requestDelayMs: 250,
      verifyMode: 'relaxed_headers',
      refererMode: 'source_url',
      cmsFingerprint,
      notes: '',
    },
  });

  const adapterEpScan = extractSeasonsAndEpisodesWithAdapterBrowser(doc, finalUrl, candidateSeed);
  const extractedAdapterEpCount = adapterEpScan.seasons.reduce((acc, s) => acc + s.episodes.length, 0);
  const visibleEpisodeCount = Math.max(
    adapterEpScan.visibleEpisodesHint,
    extractedAdapterEpCount,
    baselineEpisodes
  );

  const sampleEpisodeLabels = adapterEpScan.seasons
    .flatMap((s) => s.episodes.map((e) => `${s.label}: ${e.title}`))
    .slice(0, 12);

  const paginationLinks = adapterEpScan.paginationLinks;
  const hasPagination = paginationLinks.length > 0;
  const hasLoadMoreButton =
    safeQueryAll(doc, '.load-more, [data-load-more]').length > 0 ||
    /load[-_]?more|next[-_]?page|تحميل\s*المزيد/i.test(html);

  const watchSubpageUrl =
    findBestWatchSubpageUrlBrowser(doc, finalUrl, candidateSeed) || baseline.hints.watchSubpageUrl || '';
  const hasWatchSubpage = Boolean(
    watchSubpageUrl && canonicalizeCompareUrl(watchSubpageUrl) !== canonicalizeCompareUrl(finalUrl)
  );
  const downloadSubpageUrl = baseline.hints.downloadSubpageUrl || '';
  const hasDownloadSubpage = Boolean(downloadSubpageUrl);

  const episodeIdParamsFound: string[] = [];
  if (/[?&]vid=/i.test(html) || /vid=/i.test(finalUrl)) episodeIdParamsFound.push('vid');
  if (/[?&]ep=/i.test(html) || /ep=/i.test(finalUrl)) episodeIdParamsFound.push('ep');
  if (/[?&]episode=/i.test(html)) episodeIdParamsFound.push('episode');

  const discoveredApis: DiscoveredApiEndpoint[] = [];
  if (doc.querySelector('script[type="application/ld+json"]')) {
    discoveredApis.push({
      type: 'json_ld',
      url: finalUrl,
      method: 'GET',
      reachable: true,
      sampleNote: 'تحتوي الصفحة على بيانات Schema.org JSON-LD مضمنة',
    });
  }
  if (doc.querySelector('script#__NEXT_DATA__')) {
    discoveredApis.push({
      type: 'next_data',
      url: finalUrl,
      method: 'GET',
      reachable: true,
      sampleNote: 'تحتوي الصفحة على حزمة __NEXT_DATA__ JSON',
    });
  }
  const allScripts = Array.from(doc.querySelectorAll('script'))
    .map((el) => el.textContent || '')
    .join('\n');
  const wpAjaxMatch = allScripts.match(/https?:\/\/[^"'\s]+admin-ajax\.php/i);
  if (wpAjaxMatch?.[0]) {
    discoveredApis.push({
      type: 'admin_ajax',
      url: wpAjaxMatch[0],
      method: 'POST',
      reachable: true,
      sampleNote: 'تم رصد مرجع WordPress admin-ajax.php في سكربتات الصفحة',
    });
  }
  const wpJsonLink = doc.querySelector('link[rel="https://api.w.org/"]')?.getAttribute('href');
  if (wpJsonLink) {
    discoveredApis.push({
      type: 'wordpress_rest',
      url: wpJsonLink,
      method: 'GET',
      reachable: true,
      sampleNote: 'واجهة WordPress REST API متاحة',
    });
  }
  if (cmsFingerprint === 'Blogger') {
    try {
      const origin = new URL(finalUrl).origin;
      discoveredApis.push({
        type: 'blogger_feed',
        url: `${origin}/feeds/posts/default?alt=json`,
        method: 'GET',
        reachable: true,
        sampleNote: 'خلاصة Blogger JSON Feed متاحة للموقع',
      });
    } catch {
      // ignore
    }
  }

  const diagnostics: ScraperDiagnosticIssue[] = [];

  if (isProtected) {
    diagnostics.push({
      code: 'access_blocked_or_protection',
      severity: 'critical',
      title: 'إشارات حماية أو تحقق بشري في الصفحة',
      probableCause: protectionReason || 'تم رصد إشارات حماية أو تحقق.',
      suggestedFix: 'الصق كود HTML من المتصفح أو فعّل Cloudflare Worker المجاني من الإعدادات.',
      evidence: `HTTP ${httpStatus}`,
    });
  }

  if (visibleEpisodeCount > baselineEpisodes || baselineEpisodes >= 40) {
    diagnostics.push({
      code: 'episode_count_mismatch_or_capped',
      severity: 'critical',
      title: `نقص في عدد الحلقات المستخرجة (${baselineEpisodes} من أصل ${visibleEpisodeCount} ظاهرة)`,
      probableCause:
        hasSeasonTabs && baselineSeasons <= 1 && adapterEpScan.seasons.length > 1
          ? 'الجالب العام يدمج المواسم في موسم واحد ويحذف الحلقات المتكررة الترقيم عبر المواسم أو يتجاهل الترقيم المختصر مثل "1حلقة".'
          : baselineEpisodes >= 40
            ? 'الجالب العام يتوقف عند حد 40 حلقة فقط.'
            : 'توجد روابط حلقات لم يلتقطها التعبير القياسي أو تتطلب قراءة من قوائم التبويب/Select.',
      suggestedFix: `رفع حد الحلقات إلى ${candidateSeed.episodeRules.maxEpisodes} وتفعيل preserveMultiSeason وقراءة الحاويات (${candidateSeed.episodeRules.containerSelector}).`,
      evidence: `الأساسي: ${baselineEpisodes} حلقة / المكتشف متعدد المواسم: ${extractedAdapterEpCount} حلقة (عبر ${adapterEpScan.seasons.length} موسم)`,
    });
  }

  if (visibleServerCount > baselineServers || (visibleServerCount > 0 && baselineServers === 0)) {
    diagnostics.push({
      code: 'missing_servers_per_episode',
      severity: 'critical',
      title: `نقص في سيرفرات المشاهدة (${baselineServers} مستخرج مقابل ${visibleServerCount} ظاهر بالصفحة)`,
      probableCause: detectedUrlAttrs.has('data-embed-url')
        ? 'الموقع يخزن روابط السيرفرات داخل سمة data-embed-url أو قوائم تبويب المشغل.'
        : hasTabsForServers
          ? 'السيرفرات موزعة داخل أزرار/تبويبات ويتم تحميل Iframe واحد فقط عند فتح الصفحة.'
          : 'روابط السيرفرات موجودة في سمات مخصصة أو نصوص برمجية داخلية.',
      suggestedFix: `استخدام المحدد "${candidateSeed.serverRules.itemSelector}" مع السمات [${candidateSeed.serverRules.urlAttributes.slice(0, 5).join(', ')}].`,
      evidence: `سيرفرات أساسية: ${baselineServers} | سيرفرات مكتشفة: ${visibleServerCount}${sampleServerNames.length ? ` (${sampleServerNames.slice(0, 5).join('، ')})` : ''}`,
    });
  }

  if (hasSeasonTabs || (extractedAdapterEpCount > 0 && /watch\.php|play\.php/i.test(html))) {
    diagnostics.push({
      code: 'episodes_in_separate_pages_or_seasons',
      severity: adapterEpScan.seasons.length > baselineSeasons ? 'warning' : 'info',
      title: `توزيع الحلقات على ${adapterEpScan.seasons.length || seasonPanelsCount || 1} مواسم/صفحات منفصلة`,
      probableCause:
        'كل حلقة تقود إلى صفحة مستقلة أو تتوزع داخل تبويبات مواسم منفصلة مما يتطلب تتبع رابط كل حلقة على حدة.',
      suggestedFix:
        'تفعيل ربط تبويبات المواسم (seasonTabSelector + seasonPanelSelector) وزحف صفحة كل حلقة.',
      evidence: `المواسم المكتشفة: ${adapterEpScan.seasons.length || seasonTabsCount} | خيارات Select: ${hasSelectEpisodeDropdown ? 'نعم' : 'لا'}`,
    });
  }

  if (hasPagination || hasLoadMoreButton) {
    diagnostics.push({
      code: 'pagination_or_load_more',
      severity: 'warning',
      title: 'الموقع يستخدم تعدد الصفحات (Pagination) أو زر تحميل المزيد',
      probableCause: 'قائمة الحلقات أو الأعمال مقسمة على أكثر من صفحة.',
      suggestedFix: 'تفعيل followPagination مع تحديد paginationSelector لاستكمال الصفحات.',
      evidence: paginationLinks.length > 0 ? paginationLinks.slice(0, 2).join(' | ') : 'Load More',
    });
  }

  if (hasTabsForServers) {
    diagnostics.push({
      code: 'servers_inside_tabs',
      severity: 'warning',
      title: 'السيرفرات معروضة داخل تبويبات تفاعلية (Tabs / List)',
      probableCause:
        'واجهة المشغل تعرض سيرفراً واحداً نشطاً في Iframe وتضع بقية السيرفرات وأسماءها داخل عناصر قائمة.',
      suggestedFix: `قراءة عناصر التبويب عبر "${candidateSeed.serverRules.itemSelector}" مع حفظ الأسماء الحقيقية.`,
      evidence: `المحدد المطابق: ${bestServerSelector} (${bestServerEls.length} عنصر)`,
    });
  }

  if (discoveredApis.length > 0) {
    diagnostics.push({
      code: 'dynamic_ajax_or_json_api',
      severity: 'info',
      title: 'تتوفر بيانات ديناميكية أو واجهات JSON/AJAX عامة في الصفحة',
      probableCause: 'الموقع يحتوي على JSON-LD أو واجهات برمجية عامة مقروءة بأمان.',
      suggestedFix: 'قراءة البيانات المهيكلة مع الحفاظ على أمان المتصفح.',
      evidence: discoveredApis.map((a) => `${a.type}: ${a.sampleNote}`).join(' | '),
    });
  }

  if (hasWatchSubpage || (contentTypeHint === 'series' && /watch\.php|play\.php/i.test(finalUrl))) {
    diagnostics.push({
      code: 'episode_page_differs_from_series',
      severity: 'warning',
      title: 'اختلاف بنية صفحة الحلقة عن صفحة المشغل الفرعية أو المسلسل',
      probableCause: hasWatchSubpage
        ? 'صفحة العمل تحيل عبر رابط مشاهدة فرعي (مثل watch.php -> play.php).'
        : 'الرابط يشير لصفحة مشغل فرعية تختلف عن صفحة التفاصيل.',
      suggestedFix: 'تفعيل followWatchSubpage وتجاهل أزرار الإعلانات (.pm-ads-banner).',
      evidence: hasWatchSubpage ? `رابط المشاهدة الفرعي: ${watchSubpageUrl}` : `الصفحة الحالية: ${finalUrl}`,
    });
  }

  if (sampleServerNames.length > 0) {
    diagnostics.push({
      code: 'site_specific_server_pattern_or_names',
      severity: 'warning',
      title: 'أسماء السيرفرات الحقيقية لا يلتقطها الجالب العام',
      probableCause: 'الجالب العام يستبدل أسماء السيرفرات بأرقام عامة (سيرفر 1، سيرفر 2).',
      suggestedFix: 'تفعيل preserveServerNames واستخراج الاسم عبر nameSelector.',
      evidence: `أسماء السيرفرات الحقيقية: ${sampleServerNames.slice(0, 8).join('، ')}`,
    });
  }

  return {
    ok: true,
    targetUrl: url || finalUrl,
    domain,
    contentTypeHint,
    analyzedAt,
    matchedExistingAdapterId: matchedExisting?.id,
    signals: {
      httpStatus,
      finalUrl,
      pageTitle,
      cmsFingerprint,
      isProtectedOrBlocked: isProtected,
      protectionReason,
      hasTabsForServers,
      serverTabSelectorMatched: bestServerSelector,
      serverContainerCount: bestServerEls.length,
      hasSeasonTabs,
      seasonCountDetected: Math.max(adapterEpScan.seasons.length, seasonTabsCount),
      hasSelectEpisodeDropdown,
      visibleEpisodeCount,
      visibleServerCount,
      hasPagination,
      paginationLinks,
      hasLoadMoreButton,
      hasWatchSubpage,
      watchSubpageUrl,
      hasDownloadSubpage,
      downloadSubpageUrl,
      episodeIdParamsFound,
      discoveredApis,
      sampleServerNames,
      sampleEpisodeLabels,
    },
    diagnostics,
    baselineCounts: {
      episodes: baselineEpisodes,
      servers: baselineServers,
      seasons: baselineSeasons,
    },
    proposedAdapter: candidateSeed,
  };
}

export async function executeAdapterScrapeInBrowser(params: {
  url: string;
  rawHtml?: string;
  adapter: ScraperAdapter;
  contentTypeHint?: AdapterContentTypeHint;
  deepEpisodeCrawl?: boolean;
  maxEpisodesForCrawl?: number;
}): Promise<{
  ok: boolean;
  media: ScrapedPayload;
  visibleEpisodesHint: number;
  visibleServersHint: number;
  failedServers: FailedServerReport[];
  error?: string;
}> {
  const {
    url,
    rawHtml,
    adapter,
    contentTypeHint = adapter.contentTypeHint || 'auto',
    deepEpisodeCrawl = true,
    maxEpisodesForCrawl,
  } = params;

  let html = rawHtml || '';
  let effectiveUrl = url || '';

  if (!html || html.trim().length < 50) {
    const fetched = await fetchViaBrowserOrCorsRelay(url, 13000);
    if (!fetched.ok || !fetched.text || fetched.text.length < 100) {
      const emptyMedia = parseHtmlToMediaWithHintsBrowser('<html></html>', url || 'https://example.com').media;
      return {
        ok: false,
        media: emptyMedia,
        visibleEpisodesHint: 0,
        visibleServersHint: 0,
        failedServers: [],
        error:
          'تعذر جلب الصفحة في وضع GitHub Pages الثابت (CORS/Cloudflare). الصق كود HTML للصفحة في الحقل البديل أو أضف Cloudflare Worker المجاني من الإعدادات.',
      };
    }
    html = fetched.text;
    effectiveUrl = fetched.finalUrl || url;
  } else if (!effectiveUrl) {
    const canonicalMatch =
      html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] ||
      html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      '';
    effectiveUrl = canonicalMatch || 'https://example.com';
  }

  let sourceOrigin = '';
  try {
    sourceOrigin = new URL(effectiveUrl).origin;
  } catch {
    sourceOrigin = '';
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const baseline = parseHtmlToMediaWithHintsBrowser(html, effectiveUrl);
  const media: ScrapedPayload = {
    ...baseline.media,
    sourceUrl: effectiveUrl,
  };

  if (contentTypeHint === 'movie') media.kind = 'movie';
  else if (contentTypeHint === 'series' || contentTypeHint === 'episode') media.kind = 'series';

  // 1. Root servers
  const rootSrvExtract = extractServersWithAdapterBrowser(doc, effectiveUrl, adapter, media.quality);
  const rawRootServers = [...rootSrvExtract.servers];
  let visibleServersHint = Math.max(
    rawRootServers.length,
    Array.from(doc.querySelectorAll('iframe')).filter(
      (el) => !el.closest(IGNORED_PAGE_CONTAINER_SELECTOR)
    ).length
  );

  // 2. Follow watch subpage (watch.php -> play.php)
  const watchSubpageUrl = adapter.navigationRules.followWatchSubpage
    ? findBestWatchSubpageUrlBrowser(doc, effectiveUrl, adapter) || baseline.hints.watchSubpageUrl || ''
    : '';

  if (watchSubpageUrl && canonicalizeCompareUrl(watchSubpageUrl) !== canonicalizeCompareUrl(effectiveUrl)) {
    if (adapter.siteSettings.requestDelayMs > 0) {
      await sleepMs(Math.min(600, adapter.siteSettings.requestDelayMs));
    }
    const watchRes = await fetchViaBrowserOrCorsRelay(watchSubpageUrl, 10000);
    if (watchRes.ok && watchRes.text.length > 100) {
      const wDoc = new DOMParser().parseFromString(watchRes.text, 'text/html');
      const wExtract = extractServersWithAdapterBrowser(wDoc, watchSubpageUrl, adapter, media.quality);
      const seen = new Set(rawRootServers.map((s) => s.url));
      for (const s of wExtract.servers) {
        if (!seen.has(s.url)) {
          rawRootServers.push(s);
          seen.add(s.url);
        }
      }
      visibleServersHint = Math.max(visibleServersHint, wExtract.servers.length);
      if (media.downloads.length === 0) {
        const wBase = parseHtmlToMediaWithHintsBrowser(watchRes.text, watchSubpageUrl);
        if (wBase.media.downloads.length > 0) media.downloads = wBase.media.downloads;
      }
    }
  }

  const failedServers: FailedServerReport[] = [];
  const rootVerify = await verifyServersBrowserList(
    rawRootServers,
    sourceOrigin,
    adapter.siteSettings.verifyMode
  );
  media.servers = rootVerify.kept;
  failedServers.push(...rootVerify.failed);

  // 3. Seasons & Episodes
  if (contentTypeHint !== 'movie') {
    const epExtract = extractSeasonsAndEpisodesWithAdapterBrowser(
      doc,
      effectiveUrl,
      adapter,
      media.year,
      media.quality
    );
    const seasons = epExtract.seasons;
    let visibleEpisodesHint = epExtract.visibleEpisodesHint;

    if (
      adapter.navigationRules.followPagination &&
      epExtract.paginationLinks.length > 0 &&
      (!rawHtml || rawHtml.trim().length < 50)
    ) {
      const visitedPag = new Set<string>([canonicalizeCompareUrl(effectiveUrl)]);
      const queue = [...epExtract.paginationLinks];
      let pagesVisited = 1;
      const maxPag = Math.max(1, Math.min(20, adapter.navigationRules.maxPaginationPages || 6));

      while (queue.length > 0 && pagesVisited < maxPag) {
        const nextUrl = queue.shift()!;
        const canonNext = canonicalizeCompareUrl(nextUrl);
        if (visitedPag.has(canonNext)) continue;
        visitedPag.add(canonNext);
        pagesVisited += 1;

        const nextRes = await fetchViaBrowserOrCorsRelay(nextUrl, 9000);
        if (!nextRes.ok || nextRes.text.length < 100) continue;
        const nextDoc = new DOMParser().parseFromString(nextRes.text, 'text/html');
        const nextExtract = extractSeasonsAndEpisodesWithAdapterBrowser(
          nextDoc,
          nextUrl,
          adapter,
          media.year,
          media.quality
        );
        let newlyAddedOnPage = 0;

        for (const nextSeason of nextExtract.seasons) {
          const targetSeason = seasons.find((s) => s.seasonNumber === nextSeason.seasonNumber);
          if (!targetSeason) {
            seasons.push(nextSeason);
            newlyAddedOnPage += nextSeason.episodes.length;
          } else {
            for (const ep of nextSeason.episodes) {
              if (!targetSeason.episodes.some((e) => e.number === ep.number)) {
                targetSeason.episodes.push(ep);
                newlyAddedOnPage += 1;
              }
            }
            targetSeason.episodes.sort((a, b) => a.number - b.number);
          }
        }
        visibleEpisodesHint += newlyAddedOnPage;
        if (newlyAddedOnPage === 0) break;
        for (const moreUrl of nextExtract.paginationLinks) {
          if (!visitedPag.has(canonicalizeCompareUrl(moreUrl)) && !queue.includes(moreUrl)) {
            queue.push(moreUrl);
          }
        }
      }
      seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
    }

    if (seasons.length > 0) {
      media.seasons = seasons;
      if (media.kind !== 'wrestling') media.kind = 'series';
    }

    // 4. Per-episode server extraction
    if (deepEpisodeCrawl && media.seasons.length > 0) {
      const canonEffective = canonicalizeCompareUrl(effectiveUrl);
      const canonWatch = canonicalizeCompareUrl(watchSubpageUrl);
      const allEpisodes = media.seasons.flatMap((s) => s.episodes);
      const crawlCap = maxEpisodesForCrawl ? Math.min(allEpisodes.length, maxEpisodesForCrawl) : allEpisodes.length;

      const CONCURRENCY = getCustomApiBaseUrl() ? 4 : 2;
      for (let i = 0; i < crawlCap; i += CONCURRENCY) {
        const chunk = allEpisodes.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map(async (ep) => {
            const epUrl = ep.watchUrl || '';
            const canonEp = canonicalizeCompareUrl(epUrl);

            if (!canonEp || canonEp === canonEffective || canonEp === canonWatch) {
              ep.servers = media.servers.map((s, sIdx) => ({
                ...s,
                id: `ep-${ep.number}-srv-${sIdx + 1}`,
              }));
              ep.watchUrl = ep.servers[0]?.url || '';
              return;
            }

            if (adapter.siteSettings.requestDelayMs > 0) {
              await sleepMs(Math.min(400, adapter.siteSettings.requestDelayMs));
            }
            const epRes = await fetchViaBrowserOrCorsRelay(epUrl, 9000);
            if (!epRes.ok || epRes.text.length < 100) {
              ep.servers = [];
              return;
            }

            const epDoc = new DOMParser().parseFromString(epRes.text, 'text/html');
            const epSrvExtract = extractServersWithAdapterBrowser(epDoc, epUrl, adapter, media.quality);
            let epRawServers = [...epSrvExtract.servers];

            if (epRawServers.length === 0 && adapter.navigationRules.followWatchSubpage) {
              const epWatchUrl = findBestWatchSubpageUrlBrowser(epDoc, epUrl, adapter);
              if (epWatchUrl && canonicalizeCompareUrl(epWatchUrl) !== canonEp) {
                const subRes = await fetchViaBrowserOrCorsRelay(epWatchUrl, 9000);
                if (subRes.ok && subRes.text.length > 100) {
                  const subDoc = new DOMParser().parseFromString(subRes.text, 'text/html');
                  epRawServers = extractServersWithAdapterBrowser(
                    subDoc,
                    epWatchUrl,
                    adapter,
                    media.quality
                  ).servers;
                }
              }
            }

            const epVerified = await verifyServersBrowserList(
              epRawServers,
              sourceOrigin,
              adapter.siteSettings.verifyMode,
              ep.number
            );
            ep.servers = epVerified.kept.map((s, sIdx) => ({
              ...s,
              id: `ep-${ep.number}-srv-${sIdx + 1}`,
            }));
            failedServers.push(...epVerified.failed);
            ep.watchUrl = ep.servers[0]?.url || epUrl;
          })
        );
      }

      if (media.servers.length === 0) {
        const firstWithServers = allEpisodes.find((e) => e.servers && e.servers.length > 0);
        if (firstWithServers?.servers) {
          media.servers = firstWithServers.servers.map((s, sIdx) => ({
            ...s,
            id: `srv-adp-${sIdx + 1}`,
          }));
        }
      }
    }

    return {
      ok: true,
      media,
      visibleEpisodesHint,
      visibleServersHint,
      failedServers,
    };
  } else {
    media.seasons = [];
  }

  return {
    ok: true,
    media,
    visibleEpisodesHint: 0,
    visibleServersHint,
    failedServers,
  };
}

export async function testAdapterCandidateInBrowser(params: {
  url: string;
  rawHtml?: string;
  adapter: ScraperAdapter;
  previousAdapter?: ScraperAdapter | null;
  contentTypeHint?: AdapterContentTypeHint;
}): Promise<ScraperTestResult> {
  const startedAt = Date.now();
  const {
    url,
    rawHtml,
    adapter,
    previousAdapter,
    contentTypeHint = adapter.contentTypeHint || 'auto',
  } = params;

  const domain = normalizeAdapterDomain(url || adapter.domain) || adapter.domain;
  const testedAt = new Date().toISOString();

  const execResult = await executeAdapterScrapeInBrowser({
    url,
    rawHtml,
    adapter,
    contentTypeHint,
    deepEpisodeCrawl: true,
    maxEpisodesForCrawl: 24,
  });

  const media = execResult.media;
  const seasons = media.seasons || [];
  const episodesReport: ScraperTestResult['episodesReport'] = [];
  const missingEpisodes: MissingEpisodeReport[] = [];
  const allServerNames = new Set<string>();

  for (const srv of media.servers || []) {
    if (srv.name) allServerNames.add(srv.name);
  }

  let totalServersAcrossEpisodes = 0;
  let minSrv = Number.MAX_SAFE_INTEGER;
  let maxSrv = 0;

  for (const season of seasons) {
    const epNums = season.episodes.map((e) => e.number).sort((a, b) => a - b);
    const maxEpInSeason = epNums[epNums.length - 1] || 0;
    const epNumSet = new Set(epNums);

    for (let expected = 1; expected <= maxEpInSeason; expected++) {
      if (!epNumSet.has(expected)) {
        missingEpisodes.push({
          seasonNumber: season.seasonNumber,
          episodeNumber: expected,
          reason: `فجوة ترقيم في ${season.label}: الحلقة ${expected} غير موجودة ضمن النطاق 1-${maxEpInSeason}.`,
        });
      }
    }

    for (const ep of season.episodes) {
      const srvs = ep.servers || [];
      srvs.forEach((s) => {
        if (s.name) allServerNames.add(s.name);
      });
      const count = srvs.length;
      totalServersAcrossEpisodes += count;
      if (count < minSrv) minSrv = count;
      if (count > maxSrv) maxSrv = count;

      episodesReport.push({
        seasonNumber: season.seasonNumber,
        seasonLabel: season.label,
        episodeNumber: ep.number,
        title: ep.title,
        watchUrl: ep.watchUrl || '',
        serversCount: count,
        serverNames: srvs.map((s) => s.name),
        serverUrls: srvs.map((s) => s.url || ''),
        status:
          count >= Math.max(1, Math.min(2, execResult.visibleServersHint))
            ? 'complete'
            : count > 0
              ? 'partial'
              : 'empty',
      });
    }
  }

  if (episodesReport.length === 0) {
    minSrv = media.servers.length;
    maxSrv = media.servers.length;
  }

  const totalServersExtracted =
    episodesReport.length > 0 ? totalServersAcrossEpisodes : media.servers.length;
  const avgServersPerEpisode =
    episodesReport.length > 0
      ? Math.round((totalServersAcrossEpisodes / episodesReport.length) * 10) / 10
      : media.servers.length;

  const episodesDiscovered = episodesReport.length;
  const visibleEpisodesHint = execResult.visibleEpisodesHint;
  const visibleServersHint = execResult.visibleServersHint;

  if (visibleEpisodesHint > episodesDiscovered) {
    missingEpisodes.push({
      seasonNumber: 1,
      episodeNumber: visibleEpisodesHint,
      reason: `يظهر في الصفحة ${visibleEpisodesHint} حلقة/عنصراً بينما تم استخراج ${episodesDiscovered} فقط.`,
    });
  }

  const epCoverage =
    visibleEpisodesHint > 0
      ? Math.min(100, Math.round((episodesDiscovered / visibleEpisodesHint) * 100))
      : episodesDiscovered > 0
        ? 100
        : contentTypeHint === 'movie'
          ? 100
          : 0;
  const srvCoverage =
    visibleServersHint > 0
      ? Math.min(100, Math.round((media.servers.length / visibleServersHint) * 100))
      : media.servers.length > 0
        ? 100
        : 0;

  let completenessVerdict: 'complete' | 'partial' | 'incomplete' = 'complete';
  const comparisonNotes: string[] = [];

  if (!execResult.ok || (media.servers.length === 0 && episodesDiscovered === 0)) {
    completenessVerdict = 'incomplete';
    comparisonNotes.push(execResult.error || 'لم يتم استخراج أي سيرفرات أو حلقات صالحة.');
  } else if (
    visibleEpisodesHint > episodesDiscovered ||
    visibleServersHint > media.servers.length ||
    missingEpisodes.length > 0 ||
    execResult.failedServers.length > 0 ||
    (episodesReport.length > 0 && episodesReport.some((e) => e.serversCount === 0))
  ) {
    completenessVerdict =
      media.servers.length > 0 && srvCoverage >= 60 && epCoverage >= 70 ? 'partial' : 'incomplete';
    if (visibleEpisodesHint > episodesDiscovered) {
      comparisonNotes.push(`استُخرج ${episodesDiscovered} من أصل ${visibleEpisodesHint} حلقة ظاهرة.`);
    }
    if (visibleServersHint > media.servers.length) {
      comparisonNotes.push(`استُخرج ${media.servers.length} من أصل ${visibleServersHint} سيرفر ظاهر في الصفحة.`);
    }
    if (execResult.failedServers.length > 0) {
      comparisonNotes.push(`فشل أو استُبعد ${execResult.failedServers.length} سيرفر أثناء التحقق.`);
    }
  } else {
    comparisonNotes.push('تطابق كامل بين البيانات الظاهرة على الصفحة والنتائج المستخرجة.');
  }

  let recommendedStatus: AdapterStatus = 'supported';
  let recommendedStatusReason = 'اكتمل الاستخراج بنجاح وتطابقت السيرفرات والحلقات الممكن الوصول إليها.';

  if (!execResult.ok || (media.servers.length === 0 && episodesDiscovered === 0)) {
    recommendedStatus = 'failed';
    recommendedStatusReason = execResult.error || 'فشل الجلب: لم يتم استخراج أي سيرفر أو حلقة.';
  } else if (completenessVerdict !== 'complete') {
    recommendedStatus = 'needs_fix';
    recommendedStatusReason = comparisonNotes.join(' ');
  }

  let comparisonDiff: ScraperComparisonDiff | undefined;
  if (previousAdapter) {
    const prevSummary = previousAdapter.lastTestSummary;
    let prevEps = prevSummary?.episodesDiscovered ?? 0;
    let prevSrvs = prevSummary?.totalServersExtracted ?? 0;

    if (!prevSummary) {
      const prevRun = await executeAdapterScrapeInBrowser({
        url,
        rawHtml,
        adapter: previousAdapter,
        contentTypeHint,
        deepEpisodeCrawl: false,
      });
      prevEps = (prevRun.media.seasons || []).reduce((acc, s) => acc + s.episodes.length, 0);
      prevSrvs = prevRun.media.servers.length;
    }

    const epDelta = episodesDiscovered - prevEps;
    const srvDelta = totalServersExtracted - prevSrvs;
    comparisonDiff = {
      previousVersion: previousAdapter.version,
      candidateVersion: adapter.version,
      previousEpisodes: prevEps,
      candidateEpisodes: episodesDiscovered,
      episodesDelta: epDelta,
      previousServers: prevSrvs,
      candidateServers: totalServersExtracted,
      serversDelta: srvDelta,
      newlyDiscoveredServerNames: Array.from(allServerNames),
      resolvedDiagnosticCodes: [],
      summary: `المقارنة مع v${previousAdapter.version}: الحلقات ${prevEps} ← ${episodesDiscovered} (${epDelta >= 0 ? '+' : ''}${epDelta}) | إجمالي السيرفرات ${prevSrvs} ← ${totalServersExtracted} (${srvDelta >= 0 ? '+' : ''}${srvDelta})`,
    };
  }

  const diagnostics: ScraperDiagnosticIssue[] = [];
  if (missingEpisodes.length > 0) {
    diagnostics.push({
      code: 'episode_count_mismatch_or_capped',
      severity: 'warning',
      title: `تم رصد ${missingEpisodes.length} حلقة مفقودة أو غير مستخرجة`,
      probableCause: missingEpisodes[0].reason,
      suggestedFix: 'تحقق من regex رقم الحلقة أو محدد الحاوية (containerSelector) أو تتبع الصفحات.',
      evidence: `حلقات مستخرجة: ${episodesDiscovered} / ظاهر: ${visibleEpisodesHint}`,
    });
  }
  if (execResult.failedServers.length > 0) {
    diagnostics.push({
      code: 'missing_servers_per_episode',
      severity: 'warning',
      title: `فشل أو استُبعد ${execResult.failedServers.length} سيرفر أثناء التحقق`,
      probableCause: execResult.failedServers[0].reason,
      suggestedFix: 'جرّب تغيير وضع التحقق (verifyMode) إلى relaxed_headers أو none في وضع المتصفح.',
      evidence: execResult.failedServers
        .slice(0, 3)
        .map((f) => `${f.serverName}: ${f.reason}`)
        .join(' | '),
    });
  }

  const extractedPreview: ScrapedAdapterPreviewMedia = {
    title: media.title,
    englishTitle: media.englishTitle,
    kind: media.kind,
    categories: media.categories,
    genres: media.genres,
    year: media.year,
    country: media.country,
    language: media.language,
    quality: media.quality,
    duration: media.duration,
    imdb: media.imdb,
    poster: media.poster,
    backdrop: media.backdrop,
    story: media.story,
    sourceUrl: media.sourceUrl || url,
    trailerUrl: media.trailerUrl,
    servers: media.servers.map((s) => ({
      id: s.id,
      name: s.name,
      mode: s.mode === 'embed' ? 'embed' : 'url',
      url: s.url || '',
      embedCode: s.embedCode || '',
      quality: s.quality || '1080p',
      speed: s.speed || 'سريع',
      tag: s.tag || 'بديل',
    })),
    downloads: media.downloads.map((d) => ({
      id: d.id,
      host: d.host,
      quality: d.quality || '1080p',
      size: d.size || '',
      format: d.format || 'MP4',
      url: d.url || '',
    })),
    seasons: media.seasons.map((se) => ({
      seasonNumber: se.seasonNumber,
      label: se.label,
      year: se.year,
      episodes: se.episodes.map((ep) => ({
        number: ep.number,
        title: ep.title,
        duration: ep.duration,
        quality: ep.quality,
        watchUrl: ep.watchUrl,
        servers: ep.servers?.map((es) => ({
          id: es.id,
          name: es.name,
          mode: es.mode === 'embed' ? 'embed' : 'url',
          url: es.url || '',
          embedCode: es.embedCode || '',
          quality: es.quality || '1080p',
          speed: es.speed || 'سريع',
          tag: es.tag || 'بديل',
        })),
      })),
    })),
  };

  return {
    ok: execResult.ok,
    testedUrl: url,
    domain,
    adapterId: adapter.id,
    adapterVersion: adapter.version,
    contentTypeHint,
    testedAt,
    durationMs: Date.now() - startedAt,
    episodesDiscovered,
    seasonsDiscovered: seasons.length,
    totalServersExtracted,
    rootServersCount: media.servers.length,
    avgServersPerEpisode,
    minServersPerEpisode: minSrv === Number.MAX_SAFE_INTEGER ? 0 : minSrv,
    maxServersPerEpisode: maxSrv,
    extractedServerNames: Array.from(allServerNames),
    episodesReport,
    missingEpisodes,
    failedServers: execResult.failedServers,
    visibleComparison: {
      visibleEpisodesHint,
      extractedEpisodes: episodesDiscovered,
      episodesCoveragePct: epCoverage,
      visibleServersHint,
      extractedRootServers: media.servers.length,
      serversCoveragePct: srvCoverage,
      completenessVerdict,
      notes: comparisonNotes,
    },
    diagnostics,
    recommendedStatus,
    recommendedStatusReason,
    extractedPreview,
    ...(comparisonDiff ? { comparisonDiff } : {}),
    ...(execResult.error ? { error: execResult.error } : {}),
  };
}

export async function scrapeSingleWithAdapterInBrowser(params: {
  url?: string;
  rawHtml?: string;
  adapter: ScraperAdapter;
}): Promise<{
  ok: boolean;
  error?: string;
  extracted?: ScrapedPayload;
  adapterUsed?: { id: string; name: string; version: number };
}> {
  const result = await executeAdapterScrapeInBrowser({
    url: params.url || '',
    rawHtml: params.rawHtml,
    adapter: params.adapter,
    deepEpisodeCrawl: true,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const extracted = result.media;
  const [fallbackTrailer, resolvedImgs] = await Promise.all([
    extracted.trailerUrl
      ? Promise.resolve(extracted.trailerUrl)
      : findTrailerInBrowser({
          title: extracted.title,
          englishTitle: extracted.englishTitle,
          year: extracted.year,
          kind: extracted.kind,
        }),
    import('./mediaImages')
      .then(({ resolveHighResImagesClient }) =>
        resolveHighResImagesClient({
          title: extracted.title,
          englishTitle: extracted.englishTitle,
          year: extracted.year,
          kind: extracted.kind,
          imdbId: extracted.imdbId,
          currentPoster: extracted.poster,
          currentBackdrop: extracted.backdrop,
          preferOfficial: true,
        })
      )
      .catch(() => null),
  ]);

  extracted.trailerUrl = fallbackTrailer || '';
  if (resolvedImgs) {
    if (resolvedImgs.poster_url) {
      extracted.poster = resolvedImgs.poster_url;
      extracted.poster_url = resolvedImgs.poster_url;
    }
    extracted.poster_width = resolvedImgs.poster_width;
    extracted.poster_height = resolvedImgs.poster_height;
    extracted.backdrop = resolvedImgs.backdrop_url;
    extracted.backdrop_url = resolvedImgs.backdrop_url;
    extracted.backdrop_width = resolvedImgs.backdrop_width;
    extracted.backdrop_height = resolvedImgs.backdrop_height;
    extracted.image_source = resolvedImgs.image_source;
    extracted.image_quality_status = resolvedImgs.image_quality_status;
  }

  return {
    ok: true,
    extracted,
    adapterUsed: {
      id: params.adapter.id,
      name: params.adapter.name,
      version: params.adapter.version,
    },
  };
}
