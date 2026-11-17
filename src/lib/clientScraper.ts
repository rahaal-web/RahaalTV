import {
  CastMember,
  DownloadMirror,
  EpisodeItem,
  MediaKind,
  SeasonItem,
  StreamServer,
} from '../types/media';

export interface ScrapedPayload {
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
  poster: string;
  backdrop: string;
  tagline: string;
  story: string;
  shortUrl: string;
  cast: CastMember[];
  servers: StreamServer[];
  downloads: DownloadMirror[];
  seasons: SeasonItem[];
}

const STORAGE_API_BASE_URL = 'rahaltv_api_base_url';

export function getCustomApiBaseUrl(): string {
  try {
    const saved = localStorage.getItem(STORAGE_API_BASE_URL) || '';
    if (saved.trim()) return saved.trim().replace(/\/+$/, '');
  } catch {
    // Ignore storage access issues
  }
  const envBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';
  return envBase.trim().replace(/\/+$/, '');
}

export function setCustomApiBaseUrl(url: string): string {
  const cleaned = url.trim().replace(/\/+$/, '');
  try {
    if (cleaned) {
      localStorage.setItem(STORAGE_API_BASE_URL, cleaned);
    } else {
      localStorage.removeItem(STORAGE_API_BASE_URL);
    }
  } catch {
    // Ignore storage access issues
  }
  return cleaned;
}

export function resolveApiEndpoint(endpointPath: string): string {
  const base = getCustomApiBaseUrl();
  const normalized = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
  return base ? `${base}${normalized}` : normalized;
}

export const CLOUDFLARE_WORKER_SOURCE = `// RahaL TV — Free Cloudflare Worker CORS Proxy
// Deploy for free at https://dash.cloudflare.com (Workers & Pages -> Create Worker)
// Free tier: 100,000 requests/day, zero sleep/cold-start, works permanently with GitHub Pages.

function isBlockedHost(hostname) {
  const h = (hostname || '').toLowerCase();
  if (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h.endsWith('.local') ||
    h.startsWith('10.') ||
    h.startsWith('192.168.') ||
    h.startsWith('169.254.')
  ) {
    return true;
  }
  const m172 = h.match(/^172\\.(\\d+)\\./);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');

    if (!target) {
      return new Response(
        JSON.stringify({ ok: true, service: 'RahaL TV Proxy Worker', usage: '?url=https://...' }),
        { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    let parsedTarget;
    try {
      parsedTarget = new URL(target);
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid target url' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    if (!['http:', 'https:'].includes(parsedTarget.protocol) || isBlockedHost(parsedTarget.hostname)) {
      return new Response(JSON.stringify({ ok: false, error: 'Blocked host or protocol' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    try {
      const upstream = await fetch(parsedTarget.toString(), {
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
          'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
          Referer: \`\${parsedTarget.origin}/\`,
        },
      });

      const body = await upstream.arrayBuffer();
      const contentType = upstream.headers.get('content-type') || 'text/html; charset=utf-8';
      return new Response(body, {
        status: upstream.status,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': contentType,
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: String(err) }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
  },
};`;

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h.endsWith('.local') ||
    h.startsWith('10.') ||
    h.startsWith('192.168.') ||
    h.startsWith('169.254.')
  ) {
    return true;
  }
  const m172 = h.match(/^172\.(\d+)\./);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function cleanText(val: string | undefined | null): string {
  return (val || '').replace(/\s+/g, ' ').trim();
}

function resolveUrl(baseUrl: string, maybeRelative: string | undefined | null): string {
  if (!maybeRelative) return '';
  const trimmed = maybeRelative.trim();
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('data:')
  ) {
    return '';
  }
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (!baseUrl) return '';
  try {
    const resolved = new URL(trimmed, baseUrl).toString();
    if (new URL(resolved).hostname === 'example.com') return '';
    return resolved;
  } catch {
    return '';
  }
}

function decodeBase64Safe(val: string): string {
  const trimmed = val.trim();
  if (/^(https?:)?\/\//i.test(trimmed) || /<iframe/i.test(trimmed)) return trimmed;
  if (/^[A-Za-z0-9+/=]{16,}$/.test(trimmed)) {
    try {
      const binary = atob(trimmed);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const decoded = new TextDecoder('utf-8').decode(bytes).trim();
      if (/https?:\/\/|<iframe/i.test(decoded)) return decoded;
    } catch {
      // Not valid base64 text
    }
  }
  return trimmed;
}

interface SubpageHints {
  watchSubpageUrl?: string;
  downloadSubpageUrl?: string;
}

function parseHtmlToMediaWithHintsBrowser(
  html: string,
  sourceUrl: string,
  options?: { isDownloadPage?: boolean }
): { media: ScrapedPayload; hints: SubpageHints } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // 1. JSON-LD extraction
  let jsonLdTitle = '';
  let jsonLdDesc = '';
  let jsonLdImage = '';
  let jsonLdImdb = 0;
  let jsonLdType = '';
  const jsonLdCast: CastMember[] = [];

  doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    try {
      const parsed = JSON.parse(el.textContent || '');
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const obj of items) {
        if (!obj || typeof obj !== 'object') continue;
        if (obj['@type'] === 'Movie' || obj['@type'] === 'TVSeries') {
          jsonLdType = String(obj['@type']);
          if (obj.name && !jsonLdTitle) jsonLdTitle = cleanText(String(obj.name));
          if (obj.description && !jsonLdDesc) jsonLdDesc = cleanText(String(obj.description));
          if (obj.image && !jsonLdImage) {
            jsonLdImage =
              typeof obj.image === 'string'
                ? obj.image
                : Array.isArray(obj.image)
                  ? String(obj.image[0] || '')
                  : String(obj.image?.url || '');
          }
          if (obj.aggregateRating?.ratingValue) {
            const val = parseFloat(String(obj.aggregateRating.ratingValue));
            if (!Number.isNaN(val) && val > 0 && val <= 10) jsonLdImdb = val;
          }
          if (Array.isArray(obj.actor)) {
            for (const act of obj.actor.slice(0, 10)) {
              const nm = cleanText(act?.name || (typeof act === 'string' ? act : ''));
              if (nm) {
                jsonLdCast.push({
                  name: nm,
                  role: 'ممثل',
                  initials: nm.slice(0, 2).toUpperCase(),
                });
              }
            }
          }
        }
      }
    } catch {
      // Ignore invalid JSON-LD
    }
  });

  // 2. Title
  const ogTitle = cleanText(doc.querySelector('meta[property="og:title"]')?.getAttribute('content'));
  const h1Title = cleanText(doc.querySelector('h1')?.textContent);
  const docTitle = cleanText(doc.querySelector('title')?.textContent);
  const rawTitle = jsonLdTitle || h1Title || ogTitle || docTitle || 'عمل مستورد جديد';
  const title = rawTitle
    .replace(/\s*[-|–]\s*(مشاهدة|تحميل|أون لاين|اون لاين|بجودة عالية|مترجم).*$/i, '')
    .trim()
    .slice(0, 200);

  const englishMatch = rawTitle.match(/[A-Za-z][A-Za-z0-9\s:'\-&]{2,}/);
  const englishTitle = englishMatch ? cleanText(englishMatch[0]) : title;

  // 3. Poster & Backdrop
  const ogImage = resolveUrl(
    sourceUrl,
    doc.querySelector('meta[property="og:image"]')?.getAttribute('content')
  );
  const posterImgEl = doc.querySelector(
    '.single-right img, .poster img, .movie-poster img, .pm-video-thumb img, .video-thumb img, article img'
  );
  const singlePoster = resolveUrl(
    sourceUrl,
    posterImgEl?.getAttribute('data-echo') ||
      posterImgEl?.getAttribute('data-src') ||
      posterImgEl?.getAttribute('data-lazy-src') ||
      posterImgEl?.getAttribute('src')
  );
  const poster = ogImage || singlePoster || jsonLdImage || '';
  const backdrop = ogImage || poster;

  // 4. Story
  const storySelector = cleanText(
    doc.querySelector('.single-story, .story, .post-story, .description, [itemprop="description"]')
      ?.textContent
  );
  const ogDesc = cleanText(
    doc.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
      doc.querySelector('meta[name="description"]')?.getAttribute('content')
  );
  const story = (storySelector || jsonLdDesc || ogDesc || title).slice(0, 2500);

  // 5. Taxonomy & Metadata
  const categories: string[] = [];
  const genres: string[] = [];
  let year = '';
  let country = '';
  let language = '';
  let quality = '';
  let duration = '';

  const allTagsText: string[] = [];
  doc
    .querySelectorAll('a[rel="tag"], .labels a, .single-details a, .single-info a, .tags a')
    .forEach((el) => {
      const t = cleanText(el.textContent);
      if (t) allTagsText.push(t);
    });

  for (const tag of allTagsText) {
    if (tag.startsWith('categories:')) {
      categories.push(tag.replace('categories:', '').trim());
    } else if (tag.startsWith('type:')) {
      genres.push(tag.replace('type:', '').trim());
    } else if (tag.startsWith('year:')) {
      year = tag.replace('year:', '').trim();
    } else if (tag.startsWith('country:')) {
      country = tag.replace('country:', '').trim();
    } else if (tag.startsWith('language:')) {
      language = tag.replace('language:', '').trim();
    } else if (tag.startsWith('quality:')) {
      quality = tag.replace('quality:', '').trim();
    } else if (
      /^(افلام|مسلسلات|رمضان|مصارعة|عروض|برامج|المسرحيات)/.test(tag) &&
      !categories.includes(tag)
    ) {
      categories.push(tag);
    } else if (
      /^(اكشن|دراما|كوميديا|رعب|خيال|مغامرة|فانتازيا|جريمة|غموض|إثارة|تشويق|تاريخي|رومانسي)/.test(
        tag
      ) &&
      !genres.includes(tag)
    ) {
      genres.push(tag);
    }
  }

  const allScriptsText = Array.from(doc.querySelectorAll('script'))
    .map((el) => el.textContent || '')
    .join('\n');

  const pmDurationMatch = allScriptsText.match(/duration_str\s*:\s*["']([^"']+)["']/i);
  if (pmDurationMatch) {
    const parts = pmDurationMatch[1].split(':').map((n) => parseInt(n, 10));
    if (parts.length === 3 && !parts.some(Number.isNaN)) {
      const mins = parts[0] * 60 + parts[1];
      if (mins > 0) duration = `${mins} دقيقة`;
    } else if (parts.length === 2 && !parts.some(Number.isNaN) && parts[0] > 0) {
      duration = `${parts[0]} دقيقة`;
    }
  }

  const bodyText = cleanText(doc.body?.textContent || '');
  if (!year) {
    const yMatch = (rawTitle + ' ' + bodyText.slice(0, 2500)).match(/\b(20[1-3]\d|19\d\d)\b/);
    year = yMatch ? yMatch[1] : '2026';
  }
  if (!quality) {
    const qMatch = (rawTitle + ' ' + bodyText.slice(0, 2500)).match(
      /\b(4K UHD|4K|2160p|BluRay|WEB-DL|WEBRip|HDTV|Full HD|1080p|720p|HDCAM|HD)\b/i
    );
    quality = qMatch ? qMatch[1].toUpperCase() : 'WEB-DL';
  }
  if (!duration) {
    const dMatch = bodyText.match(/(\d{2,3})\s*(?:دقيقة|min|m\b)/i);
    duration = dMatch ? `${dMatch[1]} دقيقة` : '120 دقيقة';
  }

  let imdb = jsonLdImdb;
  if (!imdb) {
    const imdbText = cleanText(
      doc.querySelector('.single-imdb, .imdb, [class*="imdb"]')?.textContent
    );
    const m = (imdbText + ' ' + bodyText.slice(0, 3000)).match(
      /(?:IMDb[^\d]{0,15}|تقييم[^\d]{0,15})([1-9](?:\.\d)?)/i
    );
    if (m) imdb = parseFloat(m[1]);
  }
  if (!imdb || imdb > 10) imdb = 7.8;

  let kind: MediaKind = 'movie';
  if (/مصارعة|wwe|wrestlemania|raw|smackdown/i.test(rawTitle + ' ' + categories.join(' '))) {
    kind = 'wrestling';
  } else if (
    jsonLdType === 'TVSeries' ||
    /مسلسل|الموسم|الحلقة|حلقات/.test(rawTitle + ' ' + categories.join(' '))
  ) {
    kind = 'series';
  } else if (/مسرحية|برنامج/.test(rawTitle + ' ' + categories.join(' '))) {
    kind = 'tv';
  }

  if (categories.length === 0) {
    categories.push(
      kind === 'series'
        ? 'مسلسلات'
        : kind === 'wrestling'
          ? 'مصارعة حرة'
          : kind === 'tv'
            ? 'عروض تلفزيونية'
            : 'افلام'
    );
  }
  const combinedHints = `${rawTitle} ${sourceUrl} ${categories.join(' ')} ${genres.join(' ')} ${country} ${language}`;
  if (kind === 'movie') {
    if (!categories.some((c) => /افلام|أفلام/.test(c))) categories.unshift('افلام');
    if (/كرتون|انمي|انيميشن|animation|anime/i.test(combinedHints)) {
      if (!categories.includes('افلام كرتون')) categories.push('افلام كرتون');
    } else if (/عربي|مصري|سعودي|خليجي/i.test(combinedHints)) {
      if (!categories.includes('افلام عربية')) categories.push('افلام عربية');
    } else if (/هند|بوليوود|hindi/i.test(combinedHints)) {
      if (!categories.includes('افلام هندية')) categories.push('افلام هندية');
    } else if (/ترك|turk/i.test(combinedHints)) {
      if (!categories.includes('افلام تركية')) categories.push('افلام تركية');
    } else if (!categories.some((c) => /اجنبي|أجنبي/.test(c))) {
      categories.push('افلام اجنبية');
    }
  } else if (kind === 'series') {
    if (!categories.some((c) => /مسلسلات/.test(c))) categories.unshift('مسلسلات');
    if (/رمضان/.test(combinedHints) && !categories.includes('رمضان 2026')) {
      categories.push('رمضان 2026');
    } else if (/عربي|مصري|سعودي|خليجي/i.test(combinedHints)) {
      if (!categories.includes('مسلسلات عربية')) categories.push('مسلسلات عربية');
    } else if (/ترك|turk/i.test(combinedHints)) {
      if (!categories.includes('مسلسلات تركية')) categories.push('مسلسلات تركية');
    } else if (!categories.some((c) => /اجنبي|أجنبي/.test(c))) {
      categories.push('مسلسلات اجنبية');
    }
  }
  if (genres.length === 0) {
    genres.push('دراما', 'إثارة');
  }

  // 6. Watch Servers
  const serversMap = new Map<string, StreamServer>();
  const ignoredEmbeds =
    /googlesyndication|doubleclick|googletagmanager|facebook\.com\/plugins|recaptcha|cloudflare|ads|histats|yandex|analytics/i;

  const pushEmbedServer = (rawCandidate: string, preferredName?: string) => {
    const src = resolveUrl(sourceUrl, rawCandidate);
    if (!src || ignoredEmbeds.test(src) || serversMap.has(src)) return;
    try {
      const parsed = new URL(src);
      if (parsed.hostname === 'example.com' || isBlockedHost(parsed.hostname)) return;
    } catch {
      return;
    }

    const numLabel = `سيرفر ${serversMap.size + 1}`;
    serversMap.set(src, {
      id: `srv-ext-${serversMap.size + 1}`,
      name: preferredName
        ? preferredName.replace(/مستورد|embed/gi, '').trim().slice(0, 40) || numLabel
        : numLabel,
      mode: 'embed',
      url: src,
      embedCode: `<iframe src="${src}" frameborder="0" allowfullscreen></iframe>`,
      quality,
      speed: 'سريع',
      tag: quality,
    });
  };

  doc.querySelectorAll('iframe').forEach((el) => {
    const rawSrc =
      el.getAttribute('src') ||
      el.getAttribute('data-src') ||
      el.getAttribute('data-lazy-src') ||
      '';
    pushEmbedServer(rawSrc);
  });

  doc
    .querySelectorAll(
      '[data-embed], [data-iframe], [data-server], [data-video], [data-url], [data-watch], [data-link], [data-play], li[data-src], button[data-src], a[data-src]'
    )
    .forEach((el) => {
      if (el.tagName.toLowerCase() === 'img') return;
      const attrVal =
        el.getAttribute('data-embed') ||
        el.getAttribute('data-iframe') ||
        el.getAttribute('data-server') ||
        el.getAttribute('data-video') ||
        el.getAttribute('data-url') ||
        el.getAttribute('data-watch') ||
        el.getAttribute('data-link') ||
        el.getAttribute('data-play') ||
        el.getAttribute('data-src');
      if (!attrVal) return;

      let candidateUrl = decodeBase64Safe(attrVal);
      const iframeMatch = candidateUrl.match(/src=["']([^"']+)["']/i);
      if (iframeMatch) candidateUrl = iframeMatch[1];

      const btnText =
        cleanText(el.querySelector('.name')?.textContent) || cleanText(el.textContent);

      if (/^[0-9a-zA-Z_-]{1,24}$/.test(candidateUrl) && !/[./:?]/.test(candidateUrl)) {
        return;
      }
      pushEmbedServer(candidateUrl, btnText || undefined);
    });

  const serverButtonLabels = Array.from(
    doc.querySelectorAll(
      '.server-btn, .servers li, .watch-servers button, .servers-list button, .server-item, .btn-service'
    )
  )
    .map((el) => cleanText(el.querySelector('.name')?.textContent) || cleanText(el.textContent))
    .filter(Boolean);

  doc.querySelectorAll('script').forEach((el) => {
    const scriptText = el.textContent || '';
    if (!scriptText || scriptText.length < 15) return;

    const unescaped = scriptText
      .replace(/\\\//g, '/')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\n|\\r|\\t/g, ' ');

    const iframeSrcRegex = /<iframe[^>]+src=["'](https?:\/\/[^"'\s<>]+)["']/gi;
    let match: RegExpExecArray | null;
    let scriptServerIdx = 0;
    while ((match = iframeSrcRegex.exec(unescaped)) !== null) {
      const label = serverButtonLabels[scriptServerIdx] || undefined;
      pushEmbedServer(match[1], label);
      scriptServerIdx++;
    }

    const atobRegex = /atob\(\s*["']([A-Za-z0-9+/=]{20,})["']\s*\)/gi;
    let b64Match: RegExpExecArray | null;
    while ((b64Match = atobRegex.exec(scriptText)) !== null) {
      const decoded = decodeBase64Safe(b64Match[1]);
      if (/<script/i.test(decoded)) continue;
      const srcInDecoded = decoded.match(/src=["'](https?:\/\/[^"'\s<>]+)["']/i)?.[1] || decoded;
      if (/^https?:\/\//i.test(srcInDecoded) && !ignoredEmbeds.test(srcInDecoded)) {
        pushEmbedServer(srcInDecoded);
      }
    }

    const jsArrayVarRegex =
      /(?:var|let|const)\s+(?:servers|embeds|players|watchLinks)\s*=\s*\[([\s\S]{5,8000}?)\]/gi;
    let arrMatch: RegExpExecArray | null;
    while ((arrMatch = jsArrayVarRegex.exec(unescaped)) !== null) {
      const urlRegex = /https?:\/\/[^\s"'<>]+/gi;
      let uMatch: RegExpExecArray | null;
      let arrIdx = 0;
      while ((uMatch = urlRegex.exec(arrMatch[1])) !== null) {
        if (!ignoredEmbeds.test(uMatch[0])) {
          const label = serverButtonLabels[arrIdx] || undefined;
          pushEmbedServer(uMatch[0], label);
          arrIdx++;
        }
      }
    }
  });

  doc.querySelectorAll('video source, video').forEach((el, idx) => {
    const src = resolveUrl(sourceUrl, el.getAttribute('src'));
    if (!src || serversMap.has(src)) return;
    serversMap.set(src, {
      id: `srv-vid-${idx + 1}`,
      name: `مشغل مباشر MP4 #${idx + 1}`,
      mode: 'url',
      url: src,
      embedCode: '',
      quality,
      speed: 'فائق',
      tag: 'MP4',
    });
  });

  // 7. Downloads & Subpage Hints
  const downloadsMap = new Map<string, DownloadMirror>();
  const hints: SubpageHints = {};
  let sourceOrigin = '';
  try {
    sourceOrigin = new URL(sourceUrl).origin;
  } catch {
    // ignore
  }

  const ignoredDownloadHosts =
    /facebook\.com|twitter\.com|x\.com|t\.me|telegram|whatsapp|instagram|youtube\.com|tiktok\.com|pinterest|linkedin|plus\.google\.com|google\.com\/search|sharer\.php|\/share\?/i;
  const knownMirrorRegex =
    /(mediafire|mega\.nz|drive\.google|gofile|1fichier|pixeldrain|uqload|streamtape|dood|filemoon|liiivideo|vidmoly|vidspeed|anafast|vidoba|abyssplayer|mp4plus|bysetayico|filelions|streamwish|earnvids|voe\.sx|mixdrop|krakenfiles|turbobit|rapidgator|nitroflare)/i;

  doc.querySelectorAll('a[href]').forEach((el, idx) => {
    const rawHref = el.getAttribute('href');
    const href = resolveUrl(sourceUrl, rawHref);
    const text = cleanText(el.textContent);
    const cls = cleanText(el.getAttribute('class'));
    if (!href || href === sourceUrl) return;

    let hrefOrigin = '';
    try {
      hrefOrigin = new URL(href).origin;
    } catch {
      return;
    }

    const sameOrigin = Boolean(sourceOrigin && hrefOrigin === sourceOrigin);

    if (
      sameOrigin &&
      !hints.watchSubpageUrl &&
      (/play\.php|\/watch\/|\/player\/|\/embed\//i.test(href) ||
        /\bxtgo\b/i.test(cls) ||
        (/مشاهدة/i.test(text) && /\b(play|watch|vid=)\b/i.test(href)))
    ) {
      hints.watchSubpageUrl = href;
    }

    if (
      sameOrigin &&
      !hints.downloadSubpageUrl &&
      (/download\.php|\/downloads?\//i.test(href) ||
        (/تحميل/i.test(text) && /vid=|download/i.test(href)))
    ) {
      hints.downloadSubpageUrl = href;
    }

    if (downloadsMap.has(href)) return;

    const isFileOrMirrorPath =
      /\.(mp4|mkv|avi|zip)(\?|$)/i.test(href) ||
      /\/(d|dl|download)\/[a-z0-9_-]+/i.test(href) ||
      /op=download/i.test(href);

    const looksLikeExternalMirror =
      !sameOrigin &&
      !ignoredDownloadHosts.test(href) &&
      (knownMirrorRegex.test(href) ||
        isFileOrMirrorPath ||
        Boolean(
          options?.isDownloadPage && !el.closest('header, nav, footer, .navbar, .menu')
        ));

    const looksLikeDirectButton =
      !sameOrigin && !ignoredDownloadHosts.test(href) && /تحميل|download|سيرفر/i.test(text);

    if (
      !looksLikeExternalMirror &&
      !looksLikeDirectButton &&
      !(sameOrigin && /\.(mp4|mkv|avi|zip)(\?|$)/i.test(href))
    ) {
      return;
    }

    let host = 'رابط تحميل';
    try {
      host = new URL(href).hostname.replace(/^www\./, '');
    } catch {
      // ignore
    }

    const qMatch = (text + ' ' + href).match(/\b(4K|2160p|1080p|720p|480p|360p)\b/i);
    downloadsMap.set(href, {
      id: `dl-ext-${idx + 1}`,
      host:
        text && text.length < 40 && !/^(download|تحميل)$/i.test(text)
          ? `${text} (${host})`
          : host,
      quality: qMatch ? qMatch[1] : quality,
      size: 'حسب السيرفر',
      format: /\.mkv/i.test(href) ? 'MKV' : 'MP4',
      url: href,
    });
  });

  if (!hints.watchSubpageUrl && allScriptsText) {
    const jsWatchMatch = allScriptsText.match(
      /["'](https?:\/\/[^"'\s<>]+\/+(?:watch|play|player)\/?)["']/i
    );
    if (jsWatchMatch?.[1]) hints.watchSubpageUrl = jsWatchMatch[1];
  }
  if (!hints.downloadSubpageUrl && allScriptsText) {
    const jsDlMatch = allScriptsText.match(/["'](https?:\/\/[^"'\s<>]+\/+download\/?)["']/i);
    if (jsDlMatch?.[1]) hints.downloadSubpageUrl = jsDlMatch[1];
  }

  // 8. Episodes
  const episodes: EpisodeItem[] = [];
  doc.querySelectorAll('a[href]').forEach((el) => {
    const text = cleanText(el.textContent);
    const epMatch = text.match(/(?:الحلقة|Episode|Ep)\s*(\d{1,3})/i);
    if (epMatch && episodes.length < 40) {
      const num = Number(epMatch[1]);
      if (!episodes.some((e) => e.number === num)) {
        episodes.push({
          number: num,
          title: text.slice(0, 80),
          duration: '45 دقيقة',
          quality,
          watchUrl: resolveUrl(sourceUrl, el.getAttribute('href')),
        });
      }
    }
  });
  episodes.sort((a, b) => a.number - b.number);

  // 9. Cast fallback
  if (jsonLdCast.length === 0) {
    doc
      .querySelectorAll('.single-actor-name, [itemprop="actor"] [itemprop="name"]')
      .forEach((el) => {
        const nm = cleanText(el.textContent);
        if (nm && jsonLdCast.length < 10) {
          jsonLdCast.push({
            name: nm,
            role: 'فريق العمل',
            initials: nm.slice(0, 2).toUpperCase(),
          });
        }
      });
  }

  return {
    media: {
      title,
      englishTitle,
      kind,
      categories: categories.slice(0, 8),
      genres: genres.slice(0, 8),
      year,
      country: country || 'الولايات المتحدة',
      language: language || 'مترجم للعربية',
      quality,
      duration,
      imdb,
      votes: '10,500',
      poster,
      backdrop,
      tagline: story.slice(0, 140),
      story,
      shortUrl: sourceUrl || '',
      cast: jsonLdCast,
      servers: Array.from(serversMap.values()).slice(0, 12),
      downloads: Array.from(downloadsMap.values()).slice(0, 12),
      seasons:
        kind === 'series' && episodes.length > 0
          ? [{ seasonNumber: 1, label: 'الموسم 01', year, episodes }]
          : [],
    },
    hints,
  };
}

function isLikelyContentUrl(candidateUrl: string, allowedOrigins: string[]): boolean {
  try {
    const u = new URL(candidateUrl);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    if (!allowedOrigins.includes(u.origin)) return false;
    const p = u.pathname.toLowerCase();
    if (
      p === '/' ||
      p === '' ||
      /\.(jpg|jpeg|png|gif|webp|svg|css|js|ico|xml|pdf|zip|mp4|mkv)$/i.test(p) ||
      /^\/(movies|series|recent|trends|discovery|actors|tv-channels|collections|requests|modal)\/?$/i.test(
        p
      ) ||
      /\/(index|rss|feed|tag|tags|label|category|categories|genre|search|author|page|login|register|admin|wp-admin|wp-content|comments|contact|about|privacy|terms|play|download|actor|collection|modal)(\.php)?(\/|$)/i.test(
        p
      ) ||
      p.includes('/cdn-cgi/') ||
      u.search.includes('cat=') ||
      u.search.includes('q=') ||
      u.search.includes('updated-max=')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function extractListingLinksAndPaginationBrowser(html: string, pageUrl: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const baseOrigin = new URL(pageUrl).origin;
  const canonicalHref =
    doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ||
    doc.querySelector('meta[property="og:url"]')?.getAttribute('content') ||
    '';
  const allowedOrigins = [baseOrigin];
  try {
    if (canonicalHref) {
      const co = new URL(canonicalHref).origin;
      if (!allowedOrigins.includes(co)) allowedOrigins.push(co);
    }
  } catch {
    // ignore
  }
  const siteTitle = cleanText(doc.querySelector('title')?.textContent) || new URL(pageUrl).hostname;

  const cards = new Map<string, { url: string; title: string; poster: string }>();
  const cardSelectors = [
    '.cinema-poster-slide a[href]',
    '.cinema-card a[href]',
    '.pm-video-thumb a[href]',
    '.pm-li-video a[href]',
    'a[href*="watch.php?vid="]',
    'article a[href]',
    '.post a[href]',
    '.movie a[href]',
    '.card a[href]',
    '.item a[href]',
    '.block a[href]',
    '.grid a[href]',
    'a[href]',
  ];

  for (const selector of cardSelectors) {
    doc.querySelectorAll(selector).forEach((el) => {
      if (el.closest('header, nav, footer, .navbar, .cinema-topbar')) return;
      const href = resolveUrl(pageUrl, el.getAttribute('href'));
      if (!href || !isLikelyContentUrl(href, allowedOrigins)) return;

      const cleanHref = href.split('#')[0];
      if (cards.has(cleanHref)) return;

      const parentCard = el.closest(
        '.cinema-poster-slide, .cinema-card, .pm-li-video, .pm-video-thumb, article, .post, .movie, .card, .item, .block'
      );
      const imgEl = el.querySelector('img') || parentCard?.querySelector('img') || null;
      const rawPoster =
        imgEl?.getAttribute('data-echo') ||
        imgEl?.getAttribute('data-src') ||
        imgEl?.getAttribute('data-lazy-src') ||
        imgEl?.getAttribute('src') ||
        '';
      const poster = resolveUrl(pageUrl, rawPoster);

      const cardTitle =
        cleanText(el.getAttribute('title')) ||
        cleanText(el.querySelector('h2, h3, h4, .title')?.textContent) ||
        cleanText(parentCard?.querySelector('h2, h3, h4, .title, .ellipsis')?.textContent) ||
        cleanText(imgEl?.getAttribute('alt')) ||
        cleanText(el.textContent);

      const looksLikeCard =
        selector !== 'a[href]' || Boolean(poster) || (cardTitle.length >= 4 && cardTitle.length <= 160);
      if (!looksLikeCard) return;

      cards.set(cleanHref, {
        url: cleanHref,
        title: (cardTitle || 'عمل مستورد').slice(0, 180),
        poster,
      });
    });

    if (cards.size >= 40 && selector !== 'a[href]') {
      break;
    }
  }

  const nextUrls: string[] = [];
  doc
    .querySelectorAll(
      'a[rel="next"], .next a, a.next, .pagination a, a.blog-pager-older-link, .nav-previous a'
    )
    .forEach((el) => {
      const nextHref = resolveUrl(pageUrl, el.getAttribute('href'));
      if (nextHref && nextHref.startsWith(baseOrigin) && !nextUrls.includes(nextHref)) {
        nextUrls.push(nextHref);
      }
    });

  return { siteTitle, cards: Array.from(cards.values()), nextUrls };
}

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isChallengeOrErrorHtml(text: string): boolean {
  if (!text || text.length < 40) return true;
  if (
    text.length < 25000 &&
    /<title>\s*(?:Just a moment\.\.\.|Attention Required!\s*\|\s*Cloudflare|Access denied|403 Forbidden|429 Too Many Requests)/i.test(
      text
    )
  ) {
    return true;
  }
  if (
    text.length < 25000 &&
    /cf-browser-verification|challenge-platform|__cf_chl_opt|cf_chl_prog/i.test(text)
  ) {
    return true;
  }
  return false;
}

async function fetchViaBrowserOrCorsRelay(
  targetUrl: string,
  timeoutMs = 11000
): Promise<{ ok: boolean; status: number; text: string }> {
  const customBase = getCustomApiBaseUrl();
  if (customBase) {
    try {
      const workerUrl = `${customBase}/?url=${encodeURIComponent(targetUrl)}`;
      const res = await fetchWithTimeout(workerUrl, timeoutMs);
      if (res.ok) {
        const text = await res.text();
        if (!isChallengeOrErrorHtml(text)) {
          return { ok: true, status: res.status, text };
        }
      }
    } catch {
      // Fall back to direct/public relays if custom proxy did not answer
    }
  }

  const isMixedContent =
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    targetUrl.startsWith('http://');

  if (!isMixedContent) {
    try {
      const directRes = await fetchWithTimeout(targetUrl, Math.min(timeoutMs, 6500));
      if (directRes.ok) {
        const text = await directRes.text();
        if (!isChallengeOrErrorHtml(text)) {
          return { ok: true, status: directRes.status, text };
        }
      }
    } catch {
      // Expected for cross-origin targets without CORS headers; continue to CORS relays
    }
  }

  const relays: { kind: 'raw' | 'allorigins_json'; build: (u: string) => string }[] = [
    {
      kind: 'allorigins_json',
      build: (u: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    },
    {
      kind: 'raw',
      build: (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    },
    {
      kind: 'raw',
      build: (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    },
  ];

  let lastStatus = 0;
  for (const relay of relays) {
    try {
      const relayUrl = relay.build(targetUrl);
      const res = await fetchWithTimeout(relayUrl, timeoutMs);
      lastStatus = res.status;
      if (!res.ok) continue;

      if (relay.kind === 'allorigins_json') {
        const json = (await res.json()) as {
          contents?: string;
          status?: { http_code?: number };
        };
        const contents = json?.contents || '';
        const upstreamCode = Number(json?.status?.http_code || 200);
        if (upstreamCode < 400 && !isChallengeOrErrorHtml(contents)) {
          return { ok: true, status: upstreamCode, text: contents };
        }
        continue;
      }

      const text = await res.text();
      if (!isChallengeOrErrorHtml(text)) {
        return { ok: true, status: res.status, text };
      }
    } catch {
      // Try next relay
    }
  }

  return { ok: false, status: lastStatus || 502, text: '' };
}

interface BloggerFeedJson {
  feed?: {
    title?: { $t?: string };
    entry?: {
      title?: { $t?: string };
      content?: { $t?: string };
      summary?: { $t?: string };
      category?: { term?: string }[];
      media$thumbnail?: { url?: string };
      link?: { rel?: string; href?: string }[];
    }[];
  };
}

function parseBloggerJsonEntries(json: BloggerFeedJson, origin: string, maxItems: number) {
  const entries = json.feed?.entry;
  if (!Array.isArray(entries) || entries.length === 0) return null;

  const siteTitle = cleanText(json.feed?.title?.$t) || new URL(origin).hostname;
  const items: ScrapedPayload[] = entries.slice(0, maxItems).map((entry) => {
    const altLink = entry.link?.find((l) => l.rel === 'alternate')?.href || origin;
    const contentHtml = entry.content?.$t || entry.summary?.$t || '';
    const parsed = parseHtmlToMediaWithHintsBrowser(contentHtml, altLink).media;

    const rawTitle = cleanText(entry.title?.$t);
    if (rawTitle) {
      parsed.title = rawTitle
        .replace(/\s*[-|–]\s*(مشاهدة|تحميل|أون لاين|اون لاين|بجودة عالية|مترجم).*$/i, '')
        .trim()
        .slice(0, 200);
    }

    if (!parsed.poster && entry.media$thumbnail?.url) {
      parsed.poster = entry.media$thumbnail.url.replace(/\/s\d+(-c)?\//, '/s640/');
      parsed.backdrop = parsed.poster;
    }

    const categories: string[] = [];
    const genres: string[] = [];
    for (const cat of entry.category || []) {
      const term = cleanText(cat.term);
      if (!term) continue;
      if (term.startsWith('categories:')) categories.push(term.replace('categories:', '').trim());
      else if (term.startsWith('type:')) genres.push(term.replace('type:', '').trim());
      else if (term.startsWith('year:')) parsed.year = term.replace('year:', '').trim();
      else if (term.startsWith('quality:')) parsed.quality = term.replace('quality:', '').trim();
      else if (term.startsWith('country:')) parsed.country = term.replace('country:', '').trim();
      else if (term.startsWith('language:')) parsed.language = term.replace('language:', '').trim();
    }
    if (categories.length) parsed.categories = categories.slice(0, 8);
    if (genres.length) parsed.genres = genres.slice(0, 8);

    return parsed;
  });

  return { siteTitle, items };
}

async function tryBloggerFeedBrowser(
  origin: string,
  maxItems: number
): Promise<{ siteTitle: string; items: ScrapedPayload[] } | null> {
  // 1. JSONP (zero CORS issues directly in browser)
  const jsonpResult = await new Promise<BloggerFeedJson | null>((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }
    const cbName = `__rahaltv_blogger_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const script = document.createElement('script');
    let settled = false;

    const cleanup = () => {
      try {
        delete (window as unknown as Record<string, unknown>)[cbName];
      } catch {
        // ignore
      }
      script.remove();
    };

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(null);
      }
    }, 6000);

    (window as unknown as Record<string, unknown>)[cbName] = (data: BloggerFeedJson) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve(data);
      }
    };

    script.src = `${origin}/feeds/posts/default?alt=json-in-script&max-results=${maxItems}&callback=${cbName}`;
    script.async = true;
    script.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve(null);
      }
    };
    document.head.appendChild(script);
  });

  if (jsonpResult) {
    const parsed = parseBloggerJsonEntries(jsonpResult, origin, maxItems);
    if (parsed && parsed.items.length > 0) return parsed;
  }

  // 2. Fallback via CORS relay
  try {
    const res = await fetchViaBrowserOrCorsRelay(
      `${origin}/feeds/posts/default?alt=json&max-results=${maxItems}`,
      9000
    );
    if (res.ok && res.text.trim().startsWith('{')) {
      const json = JSON.parse(res.text) as BloggerFeedJson;
      return parseBloggerJsonEntries(json, origin, maxItems);
    }
  } catch {
    // ignore
  }
  return null;
}

async function tryWordPressApiBrowser(
  origin: string,
  maxItems: number
): Promise<{ siteTitle: string; items: ScrapedPayload[] } | null> {
  try {
    const wpUrl = `${origin}/wp-json/wp/v2/posts?per_page=${Math.min(maxItems, 50)}&_embed`;
    const res = await fetchViaBrowserOrCorsRelay(wpUrl, 9000);
    if (!res.ok || !res.text.trim().startsWith('[')) return null;

    const posts = JSON.parse(res.text) as {
      link?: string;
      title?: { rendered?: string };
      content?: { rendered?: string };
      excerpt?: { rendered?: string };
      _embedded?: {
        'wp:featuredmedia'?: { source_url?: string }[];
      };
    }[];

    if (!Array.isArray(posts) || posts.length === 0) return null;

    const items: ScrapedPayload[] = posts.slice(0, maxItems).map((post) => {
      const postUrl = post.link || origin;
      const htmlBody = `${post.content?.rendered || ''} ${post.excerpt?.rendered || ''}`;
      const parsed = parseHtmlToMediaWithHintsBrowser(htmlBody, postUrl).media;
      const tmpDoc = new DOMParser().parseFromString(post.title?.rendered || '', 'text/html');
      const rawTitle = cleanText(tmpDoc.body?.textContent);
      if (rawTitle) parsed.title = rawTitle.slice(0, 200);
      const featured = post._embedded?.['wp:featuredmedia']?.[0]?.source_url;
      if (featured && !parsed.poster) {
        parsed.poster = featured;
        parsed.backdrop = featured;
      }
      return parsed;
    });

    return { siteTitle: new URL(origin).hostname, items };
  } catch {
    return null;
  }
}

async function trySitemapDiscoveryBrowser(origin: string, maxItems: number): Promise<string[]> {
  const candidates = [`${origin}/sitemap.xml`, `${origin}/post-sitemap.xml`];
  const discovered: string[] = [];

  for (const smUrl of candidates) {
    try {
      const res = await fetchViaBrowserOrCorsRelay(smUrl, 8000);
      if (!res.ok || !res.text.includes('<loc>')) continue;
      const xmlDoc = new DOMParser().parseFromString(res.text, 'text/xml');
      const nestedSitemaps: string[] = [];

      xmlDoc.querySelectorAll('sitemap loc').forEach((el) => {
        const loc = cleanText(el.textContent);
        if (loc && !loc.includes('page-sitemap') && !loc.includes('category-sitemap')) {
          nestedSitemaps.push(loc);
        }
      });

      xmlDoc.querySelectorAll('url loc').forEach((el) => {
        const loc = cleanText(el.textContent);
        if (loc && isLikelyContentUrl(loc, [origin]) && !discovered.includes(loc)) {
          discovered.push(loc);
        }
      });

      for (const childSm of nestedSitemaps.slice(0, 2)) {
        if (discovered.length >= maxItems) break;
        const subRes = await fetchViaBrowserOrCorsRelay(childSm, 8000);
        if (!subRes.ok) continue;
        const subXml = new DOMParser().parseFromString(subRes.text, 'text/xml');
        subXml.querySelectorAll('url loc').forEach((el) => {
          const loc = cleanText(el.textContent);
          if (loc && isLikelyContentUrl(loc, [origin]) && !discovered.includes(loc)) {
            discovered.push(loc);
          }
        });
      }

      if (discovered.length > 0) break;
    } catch {
      // ignore
    }
  }

  return discovered.slice(0, maxItems);
}

async function scrapeFullItemInBrowser(mainUrl: string, mainHtml: string): Promise<ScrapedPayload> {
  const { media, hints } = parseHtmlToMediaWithHintsBrowser(mainHtml, mainUrl);

  let watchUrl = hints.watchSubpageUrl;
  let downloadUrl = hints.downloadSubpageUrl;

  if (watchUrl && watchUrl !== mainUrl) {
    try {
      const u = new URL(watchUrl);
      if (!isBlockedHost(u.hostname)) {
        const watchRes = await fetchViaBrowserOrCorsRelay(watchUrl, 8000);
        if (watchRes.ok && watchRes.text.length > 100) {
          const watchParsed = parseHtmlToMediaWithHintsBrowser(watchRes.text, watchUrl);
          if (watchParsed.media.servers.length > 0) {
            const seen = new Set(media.servers.map((s) => s.url));
            for (const srv of watchParsed.media.servers) {
              if (srv.url && !seen.has(srv.url)) {
                media.servers.push(srv);
                seen.add(srv.url);
              }
            }
          }
          if (watchParsed.media.downloads.length > 0) {
            const seenDl = new Set(media.downloads.map((d) => d.url));
            for (const dl of watchParsed.media.downloads) {
              if (dl.url && !seenDl.has(dl.url)) {
                media.downloads.push(dl);
                seenDl.add(dl.url);
              }
            }
          }
          if (!downloadUrl && watchParsed.hints.downloadSubpageUrl) {
            downloadUrl = watchParsed.hints.downloadSubpageUrl;
          }
        }
      }
    } catch {
      // non-fatal
    }
  }

  if (downloadUrl && downloadUrl !== mainUrl && downloadUrl !== watchUrl) {
    try {
      const u = new URL(downloadUrl);
      if (!isBlockedHost(u.hostname)) {
        const dlRes = await fetchViaBrowserOrCorsRelay(downloadUrl, 8000);
        if (dlRes.ok && dlRes.text.length > 100) {
          const dlParsed = parseHtmlToMediaWithHintsBrowser(dlRes.text, downloadUrl, {
            isDownloadPage: true,
          });
          if (dlParsed.media.downloads.length > 0) {
            const seenDl = new Set(media.downloads.map((d) => d.url));
            for (const dl of dlParsed.media.downloads) {
              if (dl.url && !seenDl.has(dl.url)) {
                media.downloads.push(dl);
                seenDl.add(dl.url);
              }
            }
          }
        }
      }
    } catch {
      // non-fatal
    }
  }

  media.servers = media.servers.slice(0, 12);
  media.downloads = media.downloads.slice(0, 12);
  return media;
}

async function tryWordPressSinglePostBrowser(
  parsedUrl: URL
): Promise<ScrapedPayload | null> {
  try {
    const rawSeg = parsedUrl.pathname.replace(/^\/+|\/+$/g, '').split('/').pop() || '';
    if (!rawSeg) return null;
    const decodedSlug = decodeURIComponent(rawSeg);
    const wpEndpoint = `${parsedUrl.origin}/wp-json/wp/v2/posts?slug=${encodeURIComponent(decodedSlug)}&_embed`;

    const res = await fetchWithTimeout(wpEndpoint, 8000);
    if (!res.ok) return null;
    const posts = (await res.json()) as {
      link?: string;
      title?: { rendered?: string };
      content?: { rendered?: string };
      excerpt?: { rendered?: string };
      _embedded?: {
        'wp:featuredmedia'?: { source_url?: string }[];
        'wp:term'?: { name?: string; taxonomy?: string }[][];
      };
    }[];

    if (!Array.isArray(posts) || posts.length === 0) return null;
    const post = posts[0];
    const postUrl = post.link || parsedUrl.toString();
    const htmlBody = `${post.content?.rendered || ''} ${post.excerpt?.rendered || ''}`;
    const parsed = parseHtmlToMediaWithHintsBrowser(htmlBody, postUrl).media;
    const tmpDoc = new DOMParser().parseFromString(post.title?.rendered || '', 'text/html');
    const rawTitle = cleanText(tmpDoc.body?.textContent);
    if (rawTitle) {
      parsed.title = rawTitle
        .replace(/\s*[-|–]\s*(مشاهدة|تحميل|أون لاين|اون لاين|بجودة عالية|مترجم).*$/i, '')
        .trim()
        .slice(0, 200);
      const enMatch = rawTitle.match(/[A-Za-z][A-Za-z0-9\s:'\-&]{2,}/);
      if (enMatch) parsed.englishTitle = cleanText(enMatch[0]);
    }
    const featured = post._embedded?.['wp:featuredmedia']?.[0]?.source_url;
    if (featured) {
      parsed.poster = featured;
      parsed.backdrop = featured;
    }
    const termGroups = post._embedded?.['wp:term'] || [];
    for (const group of termGroups) {
      if (!Array.isArray(group)) continue;
      for (const term of group) {
        const nm = cleanText(term?.name);
        if (!nm) continue;
        if (term.taxonomy === 'category' && !parsed.categories.includes(nm) && parsed.categories.length < 8) {
          parsed.categories.push(nm);
        } else if (
          term.taxonomy === 'post_tag' &&
          !parsed.genres.includes(nm) &&
          parsed.genres.length < 8
        ) {
          parsed.genres.push(nm);
        }
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function scrapeSingleInBrowser(params: {
  url?: string;
  rawHtml?: string;
}): Promise<{ ok: boolean; error?: string; extracted?: ScrapedPayload }> {
  const { url, rawHtml } = params;

  if (rawHtml && rawHtml.trim().length > 20) {
    const canonicalInHtml =
      rawHtml.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] ||
      rawHtml.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      '';
    const effectiveUrl = (url && url.trim()) || canonicalInHtml || '';
    const extracted = parseHtmlToMediaWithHintsBrowser(rawHtml, effectiveUrl).media;
    return { ok: true, extracted };
  }

  if (!url || !url.trim()) {
    return { ok: false, error: 'يرجى إدخال رابط صفحة صالح أو لصق كود HTML.' };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url.trim());
  } catch {
    return { ok: false, error: 'صيغة الرابط غير صحيحة. يجب أن يبدأ بـ https://' };
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return { ok: false, error: 'البروتوكول المسموح هو HTTP أو HTTPS فقط.' };
  }
  if (isBlockedHost(parsedUrl.hostname)) {
    return { ok: false, error: 'لا يُسمح بجلب الروابط الداخلية أو المحلية.' };
  }

  const fetched = await fetchViaBrowserOrCorsRelay(parsedUrl.toString(), 12000);
  if (fetched.ok && fetched.text.length >= 100) {
    const extracted = await scrapeFullItemInBrowser(parsedUrl.toString(), fetched.text);
    return { ok: true, extracted };
  }

  const wpSingle = await tryWordPressSinglePostBrowser(parsedUrl);
  if (wpSingle) {
    return { ok: true, extracted: wpSingle };
  }

  return {
    ok: false,
    error:
      'منع هذا الموقع الجلب المباشر من المتصفح (CORS/Cloudflare) وتعذرت مرحّلات البروكسي العامة. الحل الأسرع: افتح تبويب "لصق كود HTML" (Ctrl+U)، أو أنشئ Cloudflare Worker مجاني في الإعدادات ليصبح الجلب بنفس كفاءة المعاينة على GitHub Pages.',
  };
}

export async function scrapeSiteInBrowser(params: {
  siteUrl?: string;
  rawHtml?: string;
  maxItems?: number;
  maxPages?: number;
  deepScrape?: boolean;
}): Promise<{
  ok: boolean;
  error?: string;
  strategy?: string;
  siteTitle?: string;
  totalDiscovered?: number;
  items?: ScrapedPayload[];
}> {
  const { siteUrl, rawHtml, maxItems = 30, maxPages = 3, deepScrape = true } = params;
  const itemLimit = Math.min(80, Math.max(1, Number(maxItems) || 30));
  const pageLimit = Math.min(8, Math.max(1, Number(maxPages) || 3));

  let parsedSiteUrl: URL | null = null;
  if (siteUrl && siteUrl.trim()) {
    try {
      parsedSiteUrl = new URL(siteUrl.trim());
    } catch {
      return { ok: false, error: 'رابط الموقع غير صالح. يجب أن يبدأ بـ https://' };
    }
    if (!['http:', 'https:'].includes(parsedSiteUrl.protocol)) {
      return { ok: false, error: 'البروتوكول المسموح هو HTTP أو HTTPS فقط.' };
    }
    if (isBlockedHost(parsedSiteUrl.hostname)) {
      return { ok: false, error: 'لا يُسمح بجلب الروابط الداخلية أو المحلية.' };
    }
  }

  if (!parsedSiteUrl && (!rawHtml || rawHtml.trim().length < 50)) {
    return { ok: false, error: 'يرجى إدخال رابط الموقع المستهدف أو لصق سورس الصفحة الرئيسية.' };
  }

  if (parsedSiteUrl && (!rawHtml || rawHtml.trim().length < 50)) {
    const origin = parsedSiteUrl.origin;

    const bloggerRes = await tryBloggerFeedBrowser(origin, itemLimit);
    if (bloggerRes && bloggerRes.items.length > 0) {
      return {
        ok: true,
        strategy: 'Blogger JSONP Feed (بدون خادم)',
        siteTitle: bloggerRes.siteTitle,
        totalDiscovered: bloggerRes.items.length,
        items: bloggerRes.items,
      };
    }

    const wpRes = await tryWordPressApiBrowser(origin, itemLimit);
    if (wpRes && wpRes.items.length > 0) {
      return {
        ok: true,
        strategy: 'WordPress REST API (بدون خادم)',
        siteTitle: wpRes.siteTitle,
        totalDiscovered: wpRes.items.length,
        items: wpRes.items,
      };
    }
  }

  const discoveredMap = new Map<string, { url: string; title: string; poster: string }>();
  let siteTitle = parsedSiteUrl ? parsedSiteUrl.hostname : 'موقع مستورد';
  let strategy = rawHtml ? 'HTML Source Crawler (بدون خادم)' : 'Browser CORS Crawler';

  if (rawHtml && rawHtml.trim().length >= 50) {
    const baseForHtml = parsedSiteUrl ? parsedSiteUrl.toString() : 'https://example.com';
    const resHtml = extractListingLinksAndPaginationBrowser(rawHtml, baseForHtml);
    siteTitle = resHtml.siteTitle;
    for (const c of resHtml.cards) {
      if (discoveredMap.size < itemLimit) discoveredMap.set(c.url, c);
    }
  } else if (parsedSiteUrl) {
    const visitedPages = new Set<string>();
    const queue: string[] = [parsedSiteUrl.toString()];

    while (queue.length > 0 && visitedPages.size < pageLimit && discoveredMap.size < itemLimit) {
      const currentUrl = queue.shift()!;
      if (visitedPages.has(currentUrl)) continue;
      visitedPages.add(currentUrl);

      const pageRes = await fetchViaBrowserOrCorsRelay(currentUrl, 12000).catch(() => null);
      if (!pageRes || !pageRes.ok || pageRes.text.length < 100) {
        if (visitedPages.size === 1) {
          const smUrls = await trySitemapDiscoveryBrowser(parsedSiteUrl.origin, itemLimit);
          if (smUrls.length > 0) {
            strategy = 'XML Sitemap Crawler (بدون خادم)';
            for (const u of smUrls) {
              discoveredMap.set(u, {
                url: u,
                title: decodeURIComponent(u.split('/').pop() || u),
                poster: '',
              });
            }
            break;
          }
          return {
            ok: false,
            error:
              'رفض الموقع الوصول التلقائي عبر المتصفح (حماية Cloudflare أو CORS). افتح الموقع في متصفحك واضغط Ctrl+U لنسخ السورس ثم الصقه في وضع "لصق HTML الموقع"، أو أضف رابط خادم Node.js خارجي في الإعدادات.',
          };
        }
        continue;
      }

      const extractedPage = extractListingLinksAndPaginationBrowser(pageRes.text, currentUrl);
      if (visitedPages.size === 1) siteTitle = extractedPage.siteTitle;

      for (const card of extractedPage.cards) {
        if (discoveredMap.size < itemLimit && !discoveredMap.has(card.url)) {
          discoveredMap.set(card.url, card);
        }
      }

      for (const nextUrl of extractedPage.nextUrls) {
        if (!visitedPages.has(nextUrl) && !queue.includes(nextUrl)) {
          queue.push(nextUrl);
        }
      }
    }

    if (discoveredMap.size === 0) {
      const smUrls = await trySitemapDiscoveryBrowser(parsedSiteUrl.origin, itemLimit);
      if (smUrls.length > 0) {
        strategy = 'XML Sitemap Crawler (بدون خادم)';
        for (const u of smUrls) {
          discoveredMap.set(u, {
            url: u,
            title: decodeURIComponent(u.split('/').pop() || u),
            poster: '',
          });
        }
      }
    }
  }

  const candidates = Array.from(discoveredMap.values()).slice(0, itemLimit);
  if (candidates.length === 0) {
    return {
      ok: false,
      error:
        'لم يتم العثور على بطاقات أفلام أو مسلسلات في الرابط المحدد. جرّب لصق كود HTML للصفحة في وضع "لصق HTML الموقع".',
    };
  }

  const finalItems: ScrapedPayload[] = [];
  if (deepScrape) {
    const CONCURRENCY = 3;
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      const chunk = candidates.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (card) => {
          try {
            const detailRes = await fetchViaBrowserOrCorsRelay(card.url, 9000);
            if (detailRes.ok && detailRes.text.length > 150) {
              const parsed = await scrapeFullItemInBrowser(card.url, detailRes.text);
              if (!parsed.poster && card.poster) {
                parsed.poster = card.poster;
                parsed.backdrop = card.poster;
              }
              if ((!parsed.title || parsed.title === 'عمل مستورد جديد') && card.title) {
                parsed.title = card.title;
              }
              return parsed;
            }
          } catch {
            // Fall back to card summary
          }
          return buildFallbackCardItem(card);
        })
      );
      finalItems.push(...results);
    }
  } else {
    for (const card of candidates) {
      finalItems.push(buildFallbackCardItem(card));
    }
  }

  return {
    ok: true,
    strategy,
    siteTitle,
    totalDiscovered: finalItems.length,
    items: finalItems,
  };
}

function buildFallbackCardItem(card: { url: string; title: string; poster: string }): ScrapedPayload {
  const isSeries = /مسلسل|حلقات/.test(card.title);
  return {
    title: card.title || 'عمل مستورد',
    englishTitle: card.title || 'Imported Title',
    kind: isSeries ? 'series' : 'movie',
    categories: isSeries
      ? ['مسلسلات', /عربي|مصري/.test(card.title) ? 'مسلسلات عربية' : 'مسلسلات اجنبية']
      : ['افلام', /عربي|مصري/.test(card.title) ? 'افلام عربية' : 'افلام اجنبية'],
    genres: ['دراما'],
    year: (card.title.match(/\b(20[1-3]\d)\b/) || [])[1] || '2026',
    country: 'الولايات المتحدة',
    language: 'مترجم للعربية',
    quality: 'WEB-DL',
    duration: '120 دقيقة',
    imdb: 7.8,
    votes: '10,000',
    poster: card.poster,
    backdrop: card.poster,
    tagline: card.title,
    story: card.title,
    shortUrl: card.url,
    cast: [],
    servers: [],
    downloads: [],
    seasons: [],
  };
}

export async function checkServerUrlsInBrowser(
  urls: string[]
): Promise<Record<string, { status: 'working' | 'warning' | 'broken'; label: string; detail: string }>> {
  const results: Record<
    string,
    { status: 'working' | 'warning' | 'broken'; label: string; detail: string }
  > = {};

  await Promise.all(
    urls.map(async (u) => {
      try {
        const parsed = new URL(u);
        if (!['http:', 'https:'].includes(parsed.protocol) || isBlockedHost(parsed.hostname)) {
          results[u] = { status: 'broken', label: 'رابط غير مسموح', detail: 'بروتوكول أو نطاق غير صالح' };
          return;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
          await fetch(u, { mode: 'no-cors', signal: controller.signal });
          results[u] = {
            status: 'working',
            label: 'متاح (فحص متصفح)',
            detail: 'النطاق يستجيب للاتصال عبر المتصفح (بدون فحص HTTP عميق)',
          };
        } finally {
          clearTimeout(timer);
        }
      } catch {
        results[u] = {
          status: 'warning',
          label: 'تعذر التحقق',
          detail: 'النطاق لم يستجب أو محجوب عن المتصفح',
        };
      }
    })
  );

  return results;
}
