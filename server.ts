import 'dotenv/config';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import express from 'express';
import * as cheerio from 'cheerio';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';

const PORT = 3000;

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

function resolveUrl(baseUrl: string, maybeRelative: string | undefined): string {
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

function isYoutubeUrl(rawUrl: string): boolean {
  return /(?:youtube\.com\/(?:watch|embed|shorts|v\/)|youtube-nocookie\.com\/embed\/|youtu\.be\/)/i.test(
    rawUrl
  );
}

function normalizeTrailerUrlServer(rawUrl: string | undefined | null): string {
  if (!rawUrl) return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  const resolved = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  if (!/^https?:\/\//i.test(resolved)) return '';
  const ytMatch = resolved.match(
    /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|v\/|shorts\/)|youtube-nocookie\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/i
  );
  if (ytMatch?.[1]) {
    return `https://www.youtube.com/watch?v=${ytMatch[1]}`;
  }
  if (/\.(mp4|webm|ogg)(\?|$)/i.test(resolved) || /vimeo\.com|dailymotion\.com/i.test(resolved)) {
    return resolved;
  }
  return '';
}

const IGNORED_EMBED_HOSTS_REGEX =
  /googlesyndication|doubleclick|googletagmanager|facebook\.com\/plugins|recaptcha|cloudflare|ads|histats|yandex|analytics|disqus\.com|gravatar\.com|addtoany|sharethis|twitter\.com\/widgets|instagram\.com\/embed/i;

function normalizeArabicDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

function isLikelyNonVideoWebsiteUrl(rawUrl: string, sourceOrigin?: string): boolean {
  if (!rawUrl) return true;
  if (IGNORED_EMBED_HOSTS_REGEX.test(rawUrl)) return true;
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return true;
  }
  if (!['http:', 'https:'].includes(u.protocol) || isBlockedHost(u.hostname)) return true;

  const p = u.pathname.toLowerCase();
  const search = u.search.toLowerCase();
  const hasVideoQueryParam = /[?&](?:v|vid|id|embed|file|stream|play|hash|key|token)=/i.test(search);

  // Reject bare root website homepages (e.g. https://www.larooza.tv/ or https://example.com)
  if ((p === '' || p === '/') && !hasVideoQueryParam) {
    return true;
  }

  // Reject full PHP Melody / Arabic streaming site webpage URLs masquerading as video servers
  if (/\/(?:play|watch|download)\.php$/i.test(p) && /[?&](?:vid|v|id)=/i.test(search)) {
    return true;
  }

  // Reject homepage & portal section URLs (e.g. /home, /home.24, /index.php, /movies, /series)
  if (
    !hasVideoQueryParam &&
    (/^\/(?:home(?:\.[a-z0-9]+)?|index(?:\.[a-z0-9]+)?|main|start)\/?$/i.test(p) ||
      /^\/(?:movies|series|shows|episodes|seasons|recent|trends|latest|popular|ramadan|wrestling|tv-channels|actors|collections|requests|news)\/?$/i.test(
        p
      ) ||
      /^\/(?:category|categories|genre|genres|tag|tags|actor|search|login|register|signup|account|profile|contact|about|privacy|terms|dmca|faq)(?:\/|$)/i.test(
        p
      ))
  ) {
    return true;
  }

  // Reject same-origin full site pages inside watch servers unless they are explicit player/embed endpoints or video files
  if (
    sourceOrigin &&
    u.origin === sourceOrigin &&
    !/(?:\/embed|\/player|\/e\/|jwplayer|videojs)/i.test(p + search) &&
    !/\.(mp4|m3u8|webm|ogg)(\?|$)/i.test(p)
  ) {
    return true;
  }

  return false;
}

function hasRealVideoPlayerMarkup(snippet: string): boolean {
  if (!snippet) return false;
  return /<video\b|<source\b[^>]+src=|\.mp4\b|\.m3u8\b|\.mpd\b|jwplayer\s*\(|videojs\s*\(|new\s+Plyr\b|Hls\.isSupported|Clappr\.Player|Artplayer|DPlayer|FluidPlayer|flowplayer|sources\s*:\s*\[|eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k/i.test(
    snippet
  );
}

function isWebsiteHomepageHtml(finalUrl: string, snippet: string): boolean {
  if (finalUrl && isLikelyNonVideoWebsiteUrl(finalUrl)) return true;
  if (!snippet) return false;
  if (hasRealVideoPlayerMarkup(snippet)) return false;

  const hasPortalNavOrHomeTitle =
    /<title>[^<]*(?:الصفحة\s*الرئيسية|الرئيسية\s*[-|–]|لاروزا|Larooza|موقع\s*فيديو|ماي\s*سيما|اكوام|أكوام|أفلام\s*و?مسلسلات|قائمة\s*الأفلام|قائمة\s*المسلسلات)[^<]*<\/title>/i.test(
      snippet
    ) ||
    /الصفحة\s*الرئيسية/i.test(snippet) ||
    (/<nav\b/i.test(snippet) &&
      /(?:أضيف\s*حديث[اًا]|اضيف\s*حديث[اًا]|مسلسلات\s*رمضان|برامج\s*تلفزيونية|جميع\s*الأفلام|جميع\s*المسلسلات)/i.test(
        snippet
      )) ||
    (/placeholder=["'][^"']*(?:ابحث|بحث|search)[^"']*["']/i.test(snippet) &&
      /(?:مسلسلات|أفلام|افلام)/i.test(snippet));

  if (hasPortalNavOrHomeTitle) return true;

  // Detect any generic multi-link website page with nav/header/footer and no embedded video iframe or player
  const hasFullSiteChrome =
    /<(header|nav|footer)\b/i.test(snippet) &&
    (snippet.match(/<a\b[^>]+href=/gi)?.length || 0) >= 12;
  const hasNestedVideoIframe =
    /<iframe[^>]+src=["'][^"']*(?:embed|player|vid|stream|mp4|m3u8|dood|uqload|filemoon|streamtape|vidmoly|ok\.ru|vk\.com|mail\.ru)[^"']*["']/i.test(
      snippet
    );

  if (hasFullSiteChrome && !hasNestedVideoIframe) {
    return true;
  }

  return false;
}

interface SubpageHints {
  watchSubpageUrl?: string;
  downloadSubpageUrl?: string;
  ajaxEmbedIds: { id: string; label: string }[];
  candidateOrigins: string[];
}

function parseHtmlToMediaWithHints(
  html: string,
  sourceUrl: string,
  options?: { isDownloadPage?: boolean }
) {
  const $ = cheerio.load(html);

  // 1. JSON-LD extraction if available
  let jsonLdTitle = '';
  let jsonLdDesc = '';
  let jsonLdImage = '';
  let jsonLdTrailer = '';
  let jsonLdImdb = 0;
  let jsonLdType = '';
  const jsonLdCast: { name: string; role: string; initials: string }[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const obj of items) {
        if (!obj || typeof obj !== 'object') continue;
        if (obj['@type'] === 'Movie' || obj['@type'] === 'TVSeries') {
          jsonLdType = obj['@type'];
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
          if (obj.trailer && !jsonLdTrailer) {
            const rawTr =
              typeof obj.trailer === 'string'
                ? obj.trailer
                : String(obj.trailer?.embedUrl || obj.trailer?.url || obj.trailer?.contentUrl || '');
            const normTr = normalizeTrailerUrlServer(rawTr);
            if (normTr) jsonLdTrailer = normTr;
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
      // Ignore invalid JSON-LD blocks
    }
  });

  // 2. Title extraction
  const ogTitle = cleanText($('meta[property="og:title"]').attr('content'));
  const h1Title = cleanText($('h1').first().text());
  const docTitle = cleanText($('title').first().text());
  const rawTitle = jsonLdTitle || h1Title || ogTitle || docTitle || 'عمل مستورد جديد';
  const title = rawTitle
    .replace(/\s*[-|–]\s*(مشاهدة|تحميل|أون لاين|اون لاين|بجودة عالية|مترجم).*$/i, '')
    .trim()
    .slice(0, 200);

  const englishMatch = rawTitle.match(/[A-Za-z][A-Za-z0-9\s:'\-&]{2,}/);
  const englishTitle = englishMatch ? cleanText(englishMatch[0]) : title;

  // 3. Poster & Backdrop extraction (supports lazy data-echo / data-src)
  const ogImage = resolveUrl(sourceUrl, $('meta[property="og:image"]').attr('content'));
  const posterImgEl = $(
    '.single-right img, .poster img, .movie-poster img, .pm-video-thumb img, .video-thumb img, article img'
  ).first();
  const singlePoster = resolveUrl(
    sourceUrl,
    posterImgEl.attr('data-echo') ||
      posterImgEl.attr('data-src') ||
      posterImgEl.attr('data-lazy-src') ||
      posterImgEl.attr('src')
  );
  const poster = ogImage || singlePoster || jsonLdImage || '';
  const backdrop = ogImage || poster;

  // 4. Story / Description
  const storySelector = cleanText(
    $('.single-story, .story, .post-story, .description, [itemprop="description"]').first().text()
  );
  const ogDesc = cleanText(
    $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content')
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
  $('a[rel="tag"], .labels a, .single-details a, .single-info a, .tags a').each((_, el) => {
    const t = cleanText($(el).text());
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

  // PHP Melody pm_video_data duration extraction
  const allScriptsText = $('script')
    .map((_, el) => $(el).html() || '')
    .get()
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

  const bodyText = cleanText($.text());
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

  // IMDb rating extraction
  let imdb = jsonLdImdb;
  if (!imdb) {
    const imdbText = cleanText($('.single-imdb, .imdb, [class*="imdb"]').text());
    const m = (imdbText + ' ' + bodyText.slice(0, 3000)).match(
      /(?:IMDb[^\d]{0,15}|تقييم[^\d]{0,15})([1-9](?:\.\d)?)/i
    );
    if (m) imdb = parseFloat(m[1]);
  }
  if (!imdb || imdb > 10) imdb = 7.8;

  // Kind inference
  let kind: 'movie' | 'series' | 'tv' | 'wrestling' = 'movie';
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

  let sourceOrigin = '';
  try {
    if (sourceUrl) sourceOrigin = new URL(sourceUrl).origin;
  } catch {
    // ignore
  }

  // 5b. Trailer extraction (JSON-LD, DOM trailer containers, YouTube links/embeds, script blocks)
  let trailerUrl = jsonLdTrailer || '';
  const trySetTrailer = (rawCandidate: string | undefined | null) => {
    if (trailerUrl || !rawCandidate) return;
    const resolved = resolveUrl(sourceUrl, rawCandidate) || rawCandidate.trim();
    const norm = normalizeTrailerUrlServer(resolved);
    if (norm) trailerUrl = norm;
  };

  $(
    '[data-trailer], [data-youtube], .trailer iframe, #trailer iframe, .trailer a, #trailer a, a[href*="youtube.com/watch"], a[href*="youtu.be/"], iframe[src*="youtube.com"], iframe[src*="youtube-nocookie.com"], iframe[data-src*="youtube"]'
  ).each((_, el) => {
    if (trailerUrl) return;
    trySetTrailer($(el).attr('data-trailer'));
    trySetTrailer($(el).attr('data-youtube'));
    trySetTrailer($(el).attr('href'));
    trySetTrailer($(el).attr('src'));
    trySetTrailer($(el).attr('data-src'));
  });

  if (!trailerUrl && allScriptsText) {
    const ytScriptMatch = allScriptsText.match(
      /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/)|youtube-nocookie\.com\/embed\/|youtu\.be\/)[A-Za-z0-9_-]{11}/i
    );
    if (ytScriptMatch?.[0]) trySetTrailer(ytScriptMatch[0]);
  }

  // 6. Watch Servers (<iframe> embeds + data-* attributes + inline JS var servers arrays + <video>)
  const serversMap = new Map<
    string,
    {
      id: string;
      name: string;
      mode: 'url' | 'embed';
      url: string;
      embedCode: string;
      quality: string;
      speed: string;
      tag: string;
    }
  >();

  const pushEmbedServer = (rawCandidate: string, _preferredName?: string) => {
    const src = resolveUrl(sourceUrl, rawCandidate);
    if (!src) return;

    // Route YouTube embeds/links to trailerUrl instead of Watch Servers
    if (isYoutubeUrl(src)) {
      trySetTrailer(src);
      return;
    }

    if (serversMap.has(src) || isLikelyNonVideoWebsiteUrl(src, sourceOrigin)) return;

    const seqNum = serversMap.size + 1;
    serversMap.set(src, {
      id: `srv-ext-${seqNum}`,
      name: `سيرفر ${seqNum}`,
      mode: 'embed',
      url: src,
      embedCode: `<iframe src="${src}" frameborder="0" allowfullscreen></iframe>`,
      quality,
      speed: 'سريع',
      tag: quality,
    });
  };

  const ajaxEmbedIds: { id: string; label: string }[] = [];
  const seenAjaxIds = new Set<string>();

  const decodeMaybeBase64Embed = (val: string): string => {
    const trimmed = val.trim();
    if (/^(https?:)?\/\//i.test(trimmed) || /<iframe/i.test(trimmed)) return trimmed;
    if (/^[A-Za-z0-9+/=]{16,}$/.test(trimmed)) {
      try {
        const decoded = Buffer.from(trimmed, 'base64').toString('utf-8').trim();
        if (/https?:\/\/|<iframe/i.test(decoded)) return decoded;
      } catch {
        // Not valid base64 text
      }
    }
    return trimmed;
  };

  $('iframe').each((_, el) => {
    if ($(el).closest('header, nav, footer, .ads, .banner, .trailer, #trailer').length > 0) return;
    const rawSrc = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || '';
    pushEmbedServer(rawSrc);
  });

  // Check clickable server buttons with data-* attributes (excluding <img> lazy-load data-src)
  $('[data-embed], [data-iframe], [data-server], [data-video], [data-url], [data-watch], [data-link], [data-play], li[data-src], button[data-src], a[data-src]').each(
    (_, el) => {
      if (el.tagName?.toLowerCase() === 'img') return;
      if ($(el).closest('header, nav, footer, .ads, .banner, .trailer, #trailer').length > 0) return;
      const attrVal =
        $(el).attr('data-embed') ||
        $(el).attr('data-iframe') ||
        $(el).attr('data-server') ||
        $(el).attr('data-video') ||
        $(el).attr('data-url') ||
        $(el).attr('data-watch') ||
        $(el).attr('data-link') ||
        $(el).attr('data-play') ||
        $(el).attr('data-src');
      if (!attrVal) return;

      let candidateUrl = decodeMaybeBase64Embed(attrVal);
      const iframeMatch = candidateUrl.match(/src=["']([^"']+)["']/i);
      if (iframeMatch) candidateUrl = iframeMatch[1];

      const btnText = cleanText($(el).find('.name').first().text()) || cleanText($(el).text());

      // Pure numeric/short ID (e.g. FaselHD `data-embed="173411"`) -> resolve via /ajax/embed, never as a URL
      if (/^[0-9a-zA-Z_-]{1,24}$/.test(candidateUrl) && !/[./:?]/.test(candidateUrl)) {
        if (!seenAjaxIds.has(candidateUrl)) {
          seenAjaxIds.add(candidateUrl);
          ajaxEmbedIds.push({ id: candidateUrl, label: btnText || `سيرفر ${ajaxEmbedIds.length + 1}` });
        }
        return;
      }

      pushEmbedServer(candidateUrl, btnText || undefined);
    }
  );

  // Inline <script> extraction (handles JS arrays, escaped HTML, and atob() base64 embeds)
  const serverButtonLabels = $(
    '.server-btn, .servers li, .watch-servers button, .servers-list button, .server-item, .btn-service'
  )
    .map((_, el) => cleanText($(el).find('.name').first().text()) || cleanText($(el).text()))
    .get()
    .filter(Boolean);

  $('script').each((_, el) => {
    const scriptText = $(el).html() || '';
    if (!scriptText || scriptText.length < 15) return;

    // Unescape JSON/PHP-escaped HTML inside script blocks
    const unescaped = scriptText
      .replace(/\\\//g, '/')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\n|\\r|\\t/g, ' ');

    // Find all iframe src URLs inside script
    const iframeSrcRegex = /<iframe[^>]+src=["'](https?:\/\/[^"'\s<>]+)["']/gi;
    let match: RegExpExecArray | null;
    let scriptServerIdx = 0;
    while ((match = iframeSrcRegex.exec(unescaped)) !== null) {
      const label = serverButtonLabels[scriptServerIdx] || undefined;
      pushEmbedServer(match[1], label);
      scriptServerIdx++;
    }

    // Decode atob("...") base64 snippets that hold an iframe or embed URL (skipping ad trackers)
    const atobRegex = /atob\(\s*["']([A-Za-z0-9+/=]{20,})["']\s*\)/gi;
    let b64Match: RegExpExecArray | null;
    while ((b64Match = atobRegex.exec(scriptText)) !== null) {
      const decoded = decodeMaybeBase64Embed(b64Match[1]);
      if (/<script/i.test(decoded)) continue;
      const srcInDecoded = decoded.match(/src=["'](https?:\/\/[^"'\s<>]+)["']/i)?.[1] || decoded;
      if (/^https?:\/\//i.test(srcInDecoded) && !IGNORED_EMBED_HOSTS_REGEX.test(srcInDecoded)) {
        pushEmbedServer(srcInDecoded);
      }
    }

    // Also inspect JS server arrays holding bare embed URLs
    const jsArrayVarRegex = /(?:var|let|const)\s+(?:servers|embeds|players|watchLinks)\s*=\s*\[([\s\S]{5,8000}?)\]/gi;
    let arrMatch: RegExpExecArray | null;
    while ((arrMatch = jsArrayVarRegex.exec(unescaped)) !== null) {
      const urlRegex = /https?:\/\/[^\s"'<>]+/gi;
      let uMatch: RegExpExecArray | null;
      let arrIdx = 0;
      while ((uMatch = urlRegex.exec(arrMatch[1])) !== null) {
        if (!IGNORED_EMBED_HOSTS_REGEX.test(uMatch[0])) {
          const label = serverButtonLabels[arrIdx] || undefined;
          pushEmbedServer(uMatch[0], label);
          arrIdx++;
        }
      }
    }
  });

  $('video source, video').each((_, el) => {
    const src = resolveUrl(sourceUrl, $(el).attr('src'));
    if (!src || serversMap.has(src) || isLikelyNonVideoWebsiteUrl(src, sourceOrigin)) return;
    const seqNum = serversMap.size + 1;
    serversMap.set(src, {
      id: `srv-vid-${seqNum}`,
      name: `سيرفر ${seqNum}`,
      mode: 'url',
      url: src,
      embedCode: '',
      quality,
      speed: 'فائق',
      tag: 'MP4',
    });
  });

  // 7. Download Links & Subpage Hints (play.php / download.php)
  const downloadsMap = new Map<
    string,
    { id: string; host: string; quality: string; size: string; format: string; url: string }
  >();

  const candidateOriginsSet = new Set<string>();
  const addOriginCandidate = (maybeUrl: string | undefined | null) => {
    if (!maybeUrl) return;
    try {
      const u = new URL(maybeUrl.trim());
      if (['http:', 'https:'].includes(u.protocol) && u.hostname !== 'example.com' && !isBlockedHost(u.hostname)) {
        candidateOriginsSet.add(u.origin);
      }
    } catch {
      // ignore
    }
  };

  addOriginCandidate($('link[rel="canonical"]').attr('href'));
  addOriginCandidate($('meta[property="og:url"]').attr('content'));
  const varUrlMatch = allScriptsText.match(/\}\)\(\s*["'](https?:\/\/[^"']+)["']\s*\)/);
  if (varUrlMatch) addOriginCandidate(varUrlMatch[1]);
  if (sourceOrigin && !sourceOrigin.includes('example.com')) {
    candidateOriginsSet.add(sourceOrigin);
  }

  const hints: SubpageHints = {
    ajaxEmbedIds,
    candidateOrigins: Array.from(candidateOriginsSet),
  };
  const ignoredDownloadHosts =
    /facebook\.com|twitter\.com|x\.com|t\.me|telegram|whatsapp|instagram|youtube\.com|tiktok\.com|pinterest|linkedin|plus\.google\.com|google\.com\/search|sharer\.php|\/share\?/i;
  const knownMirrorRegex =
    /(mediafire|mega\.nz|drive\.google|gofile|1fichier|pixeldrain|uqload|streamtape|dood|filemoon|liiivideo|vidmoly|vidspeed|anafast|vidoba|abyssplayer|mp4plus|bysetayico|filelions|streamwish|earnvids|voe\.sx|mixdrop|krakenfiles|turbobit|rapidgator|nitroflare)/i;

  $('a[href]').each((idx, el) => {
    const rawHref = $(el).attr('href');
    const href = resolveUrl(sourceUrl, rawHref);
    const text = cleanText($(el).text());
    const cls = cleanText($(el).attr('class'));
    if (!href || href === sourceUrl) return;

    let hrefOrigin = '';
    try {
      hrefOrigin = new URL(href).origin;
    } catch {
      return;
    }

    const sameOrigin = Boolean(sourceOrigin && hrefOrigin === sourceOrigin);

    // Detect 1-hop watch/player subpage (e.g. PHP Melody `play.php?vid=...`, `<a class="xtgo">`)
    if (
      sameOrigin &&
      !hints.watchSubpageUrl &&
      (/play\.php|\/watch\/|\/player\/|\/embed\//i.test(href) ||
        /\bxtgo\b/i.test(cls) ||
        (/مشاهدة/i.test(text) && /\b(play|watch|vid=)\b/i.test(href)))
    ) {
      hints.watchSubpageUrl = href;
    }

    // Detect 1-hop download subpage (e.g. PHP Melody `download.php?vid=...`)
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
        Boolean(options?.isDownloadPage && $(el).closest('header, nav, footer, .navbar, .menu').length === 0));

    const looksLikeDirectButton =
      !sameOrigin &&
      !ignoredDownloadHosts.test(href) &&
      /تحميل|download|سيرفر/i.test(text);

    if (!looksLikeExternalMirror && !looksLikeDirectButton && !(sameOrigin && /\.(mp4|mkv|avi|zip)(\?|$)/i.test(href))) {
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
      host: text && text.length < 40 && !/^(download|تحميل)$/i.test(text) ? `${text} (${host})` : host,
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

  // 8. Episodes detection (for series)
  const episodes: {
    number: number;
    title: string;
    duration: string;
    quality: string;
    watchUrl?: string;
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
  }[] = [];

  $('a[href]').each((_, el) => {
    if ($(el).closest('header nav, .navbar, footer').length > 0) return;
    const rawHref = resolveUrl(sourceUrl, $(el).attr('href'));
    if (!rawHref) return;
    const text = normalizeArabicDigits(cleanText($(el).text()));
    const titleAttr = normalizeArabicDigits(cleanText($(el).attr('title')));
    const combinedLabel = text || titleAttr;
    if (!combinedLabel || /أحدث\s*الحلقات|جميع\s*الحلقات|كل\s*الحلقات/.test(combinedLabel)) return;

    const epMatch =
      combinedLabel.match(/(?:الحلقة|حلقة|Episode|Ep\.?)\s*#?(\d{1,3})/i) ||
      (rawHref.includes('vid=') ? combinedLabel.match(/^(\d{1,3})$/) : null);

    if (epMatch && episodes.length < 40) {
      const num = Number(epMatch[1]);
      if (num > 0 && !episodes.some((e) => e.number === num)) {
        episodes.push({
          number: num,
          title: (text || titleAttr || `الحلقة ${num}`).slice(0, 80),
          duration: '45 دقيقة',
          quality,
          watchUrl: rawHref,
        });
      }
    }
  });
  episodes.sort((a, b) => a.number - b.number);

  // If current page itself looks like Episode N and wasn't linked in the list (common on PHP Melody active episode), include it
  const currentEpMatch = normalizeArabicDigits(`${rawTitle} ${h1Title}`).match(
    /(?:الحلقة|حلقة|Episode|Ep\.?)\s*#?(\d{1,3})/i
  );
  if (currentEpMatch && sourceUrl) {
    const currNum = Number(currentEpMatch[1]);
    if (currNum > 0 && episodes.length > 0 && !episodes.some((e) => e.number === currNum)) {
      episodes.push({
        number: currNum,
        title: `الحلقة ${String(currNum).padStart(2, '0')}`,
        duration: '45 دقيقة',
        quality,
        watchUrl: sourceUrl,
      });
      episodes.sort((a, b) => a.number - b.number);
    }
  }

  // 9. Cast fallback
  if (jsonLdCast.length === 0) {
    $('.single-actor-name, [itemprop="actor"] [itemprop="name"]').each((_, el) => {
      const nm = cleanText($(el).text());
      if (nm && jsonLdCast.length < 10) {
        jsonLdCast.push({
          name: nm,
          role: 'فريق العمل',
          initials: nm.slice(0, 2).toUpperCase(),
        });
      }
    });
  }

  const normalizedServers = Array.from(serversMap.values())
    .slice(0, 12)
    .map((srv, idx) => ({
      ...srv,
      id: srv.id || `srv-ext-${idx + 1}`,
      name: `سيرفر ${idx + 1}`,
    }));

  const media = {
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
    sourceUrl: sourceUrl || '',
    shortUrl: '',
    trailerUrl,
    cast: jsonLdCast,
    servers: normalizedServers,
    downloads: Array.from(downloadsMap.values()).slice(0, 12),
    seasons:
      (kind === 'series' || episodes.length > 1) && episodes.length > 0
        ? [{ seasonNumber: 1, label: 'الموسم 01', year, episodes }]
        : [],
  };

  return { media, hints };
}

function parseHtmlToMedia(html: string, sourceUrl: string) {
  return parseHtmlToMediaWithHints(html, sourceUrl).media;
}

type ScrapedMediaItem = ReturnType<typeof parseHtmlToMedia>;

const DEFAULT_FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
};

async function fetchRemoteText(
  targetUrl: string,
  timeoutMs = 12000
): Promise<{ ok: boolean; status: number; text: string; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: DEFAULT_FETCH_HEADERS,
    });
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    return { ok: response.ok, status: response.status, text, contentType };
  } finally {
    clearTimeout(timeout);
  }
}

function isLikelyContentUrl(candidateUrl: string, allowedOrigins: string | string[]): boolean {
  try {
    const u = new URL(candidateUrl);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const originsList = Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins];
    if (!originsList.includes(u.origin)) return false;
    const p = u.pathname.toLowerCase();
    if (
      p === '/' ||
      p === '' ||
      /\.(jpg|jpeg|png|gif|webp|svg|css|js|ico|xml|pdf|zip|mp4|mkv)$/i.test(p) ||
      /^\/(movies|series|shows|mix|one|recent|trends|discovery|actors|tv-channels|collections|requests|modal)\/?$/i.test(
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

function extractListingLinksAndPagination(html: string, pageUrl: string) {
  const $ = cheerio.load(html);
  const baseOrigin = new URL(pageUrl).origin;
  const canonicalHref = $('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content') || '';
  const allowedOrigins = [baseOrigin];
  try {
    if (canonicalHref) {
      const co = new URL(canonicalHref).origin;
      if (!allowedOrigins.includes(co)) allowedOrigins.push(co);
    }
  } catch {
    // ignore
  }
  const siteTitle = cleanText($('title').first().text()) || new URL(pageUrl).hostname;

  const cards = new Map<string, { url: string; title: string; poster: string }>();
  const cardSelectors = [
    '.entry-box a[href]',
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
    $(selector).each((_, el) => {
      if ($(el).closest('header, nav, footer, .navbar, .cinema-topbar').length > 0) return;
      const href = resolveUrl(pageUrl, $(el).attr('href'));
      if (!href || !isLikelyContentUrl(href, allowedOrigins)) return;

      const cleanHref = href.split('#')[0];
      if (cards.has(cleanHref)) return;

      const parentCard = $(el).closest('.entry-box, .cinema-poster-slide, .cinema-card, .pm-li-video, .pm-video-thumb, article, .post, .movie, .card, .item, .block');
      const imgEl = $(el).find('img').first().length
        ? $(el).find('img').first()
        : parentCard.find('img').first();
      const rawPoster =
        imgEl.attr('data-echo') ||
        imgEl.attr('data-src') ||
        imgEl.attr('data-lazy-src') ||
        imgEl.attr('src') ||
        '';
      const poster = resolveUrl(pageUrl, rawPoster);

      const cardTitle =
        cleanText($(el).attr('title')) ||
        cleanText($(el).find('h2, h3, h4, .title').first().text()) ||
        cleanText(parentCard.find('h2, h3, h4, .title, .ellipsis').first().text()) ||
        cleanText(imgEl.attr('alt')) ||
        cleanText($(el).text());

      // Prioritize elements that look like actual media cards
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

  // Next pagination links (prefer rel="next" / "التالي" / lower sequential page numbers)
  const prioritizedNext: string[] = [];
  const otherNext: string[] = [];
  $('a[rel="next"], .next a, a.next, .pagination a, a.blog-pager-older-link, .nav-previous a').each(
    (_, el) => {
      const nextHref = resolveUrl(pageUrl, $(el).attr('href'));
      if (!nextHref || !nextHref.startsWith(baseOrigin) || nextHref === pageUrl) return;
      const label = cleanText($(el).text());
      const isExplicitNext =
        $(el).attr('rel') === 'next' || /التالي|next|›|»/i.test(label) || /\/page\/[2-9]\//.test(nextHref);
      const targetList = isExplicitNext ? prioritizedNext : otherNext;
      if (!prioritizedNext.includes(nextHref) && !otherNext.includes(nextHref)) {
        targetList.push(nextHref);
      }
    }
  );

  return { siteTitle, cards: Array.from(cards.values()), nextUrls: [...prioritizedNext, ...otherNext] };
}

async function resolveAjaxEmbedsFromOrigins(
  ajaxEmbedIds: { id: string; label: string }[],
  candidateOrigins: string[],
  refererUrl: string,
  quality: string
) {
  const resolved: {
    id: string;
    name: string;
    mode: 'url' | 'embed';
    url: string;
    embedCode: string;
    quality: string;
    speed: string;
    tag: string;
  }[] = [];

  if (ajaxEmbedIds.length === 0 || candidateOrigins.length === 0) return resolved;

  for (const origin of candidateOrigins) {
    try {
      const host = new URL(origin).hostname;
      if (isBlockedHost(host) || host === 'example.com') continue;

      // Obtain an active PHP session + matching CSRF token (prefer /login which bypasses Cloudflare edge cache)
      let cookieHeader = '';
      let csrfToken = '';

      for (const probePath of ['/login', '/']) {
        const probeRes = await fetch(`${origin}${probePath}`, {
          headers: DEFAULT_FETCH_HEADERS,
          signal: AbortSignal.timeout(8000),
        });
        if (!probeRes.ok) continue;
        const probeHtml = await probeRes.text();
        const setCookies =
          typeof probeRes.headers.getSetCookie === 'function' ? probeRes.headers.getSetCookie() : [];
        const joinedCookies = setCookies.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
        const tokenMatch =
          probeHtml.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i) ||
          probeHtml.match(/name=["']_TOKEN["'][^>]*value=["']([^"']+)["']/i);

        if (joinedCookies && tokenMatch?.[1]) {
          cookieHeader = joinedCookies;
          csrfToken = tokenMatch[1];
          break;
        }
      }

      if (!cookieHeader || !csrfToken) continue;

      const postSingleEmbed = async (item: { id: string; label: string }) => {
        const embRes = await fetch(`${origin}/ajax/embed`, {
          method: 'POST',
          headers: {
            ...DEFAULT_FETCH_HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRF-TOKEN': csrfToken,
            Origin: origin,
            Referer: refererUrl || `${origin}/`,
            Cookie: cookieHeader,
          },
          body: `id=${encodeURIComponent(item.id)}`,
          signal: AbortSignal.timeout(8000),
        });
        if (!embRes.ok) return null;
        const body = await embRes.text();
        const iframeSrcMatch = body.match(/<iframe[^>]+src=["']([^"']+)["']/i);
        const videoSrcMatch = body.match(/<(?:video|source)[^>]+src=["']([^"']+)["']/i);
        const rawSrc = iframeSrcMatch?.[1] || videoSrcMatch?.[1] || '';
        const src = resolveUrl(origin, rawSrc);
        if (!src) return null;

        let hostLabel = '';
        try {
          hostLabel = new URL(src).hostname.replace(/^www\./, '');
        } catch {
          hostLabel = 'embed';
        }
        const cleanLabel = cleanText(item.label).replace(/^\d+\s*/, '').replace(/✓$/, '').replace(/مستورد|embed/gi, '').trim();
        const name = cleanLabel ? cleanLabel.slice(0, 40) : `سيرفر ${resolved.length + 1}`;

        return {
          id: `srv-ajax-${item.id}`,
          name,
          mode: (iframeSrcMatch ? 'embed' : 'url') as 'url' | 'embed',
          url: src,
          embedCode: iframeSrcMatch ? `<iframe src="${src}" frameborder="0" allowfullscreen></iframe>` : '',
          quality,
          speed: 'سريع',
          tag: iframeSrcMatch ? quality : 'MP4',
        };
      };

      // Probe first ID before fetching remaining servers in parallel
      const limitedIds = ajaxEmbedIds.slice(0, 12);
      const firstSrv = await postSingleEmbed(limitedIds[0]);
      if (!firstSrv) continue; // Try next origin (e.g. canonical domain if mirror drops sessions)

      resolved.push(firstSrv);
      if (limitedIds.length > 1) {
        const rest = await Promise.all(limitedIds.slice(1).map((item) => postSingleEmbed(item).catch(() => null)));
        for (const srv of rest) {
          if (srv && !resolved.some((existing) => existing.url === srv.url)) {
            resolved.push(srv);
          }
        }
      }

      if (resolved.length > 0) break;
    } catch {
      // Try next origin candidate
    }
  }

  return resolved;
}

async function findYoutubeTrailerFallback(
  title: string,
  englishTitle: string,
  year: string,
  kind: 'movie' | 'series' | 'tv' | 'wrestling'
): Promise<string> {
  const cleanEn = cleanText(englishTitle)
    .replace(/\b(20[1-3]\d|19\d\d)\b/g, '')
    .trim();
  const cleanAr = cleanText(title)
    .replace(/\b(20[1-3]\d|19\d\d)\b/g, '')
    .replace(/^(فيلم|مسلسل|برنامج|عرض)\s+/i, '')
    .replace(/\s+(مترجم|مدبلج|كامل|اون\s*لاين|أون\s*لاين).*$/i, '')
    .trim();
  const baseQuery = cleanEn.length >= 3 && /[A-Za-z]{3,}/.test(cleanEn) ? cleanEn : cleanAr;
  if (!baseQuery) return '';

  const kindSuffix = kind === 'series' ? 'series official trailer' : 'official trailer';
  const query = `${baseQuery} ${year || ''} ${kindSuffix}`.replace(/\s+/g, ' ').trim();

  try {
    const res = await fetchRemoteText(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      4800
    );
    if (!res.ok || !res.text) return '';
    const match = res.text.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
    if (match?.[1]) {
      return `https://www.youtube.com/watch?v=${match[1]}`;
    }
    return '';
  } catch {
    return '';
  }
}

async function verifyScrapedServers(
  servers: ScrapedMediaItem['servers'],
  sourceOrigin: string
): Promise<ScrapedMediaItem['servers']> {
  if (!servers.length) return [];

  const checkOne = async (srv: ScrapedMediaItem['servers'][number]) => {
    const target = srv.url;
    if (!target || isLikelyNonVideoWebsiteUrl(target, sourceOrigin)) return false;
    if (/\.(mp4|m3u8|webm|ogg)(\?|$)/i.test(target)) return true;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(target, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          ...DEFAULT_FETCH_HEADERS,
          Referer: sourceOrigin ? `${sourceOrigin}/` : new URL(target).origin + '/',
          Range: 'bytes=0-24576',
        },
      });
      const finalUrl = response.url || target;
      if (isLikelyNonVideoWebsiteUrl(finalUrl, sourceOrigin)) return false;
      if (!response.ok && response.status !== 206) return false;

      const xFrame = (response.headers.get('x-frame-options') || '').toLowerCase();
      const csp = (response.headers.get('content-security-policy') || '').toLowerCase();
      const cfMitigated = (response.headers.get('cf-mitigated') || '').toLowerCase();
      if (cfMitigated === 'challenge') return false;

      const ct = (response.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('video/') || ct.includes('mpegurl')) return true;

      let snippet = '';
      if (ct.includes('text/html') || ct.includes('text/plain') || !ct) {
        snippet = (await response.text().catch(() => '')).slice(0, 28000);
        if (isWebsiteHomepageHtml(finalUrl, snippet)) return false;
        if (
          /<title>\s*(?:403\s+Forbidden|Access\s+Denied|Just\s+a\s+moment|Attention\s+Required|404\s+Not\s+Found)/i.test(
            snippet
          ) ||
          /file\s*(?:was|has been)?\s*(?:deleted|removed)|video\s*(?:was|has been)?\s*(?:deleted|removed|not found)|file\s*not\s*found|404\s*not\s*found|no\s*longer\s*available|تم\s*حذف\s*(?:الملف|الفيديو)|الفيديو\s*غير\s*موجود|الملف\s*غير\s*موجود/i.test(
            snippet
          )
        ) {
          return false;
        }
        const frameBlocked =
          xFrame.includes('deny') ||
          xFrame.includes('sameorigin') ||
          /frame-ancestors\s+[^;]*'none'|frame-ancestors\s+'self'/.test(csp) ||
          /sandboxed\s+embed\s+is\s+not\s+allowed|please\s+disable\s+sandbox/i.test(snippet);
        if (frameBlocked && !/\.(mp4|m3u8)(\?|"|')/i.test(snippet)) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };

  const keptFlags = await Promise.all(servers.map((srv) => checkOne(srv)));
  return servers
    .filter((_, idx) => keptFlags[idx])
    .slice(0, 12)
    .map((srv, idx) => ({
      ...srv,
      id: srv.id || `srv-ext-${idx + 1}`,
      name: `سيرفر ${idx + 1}`,
    }));
}

function canonicalizeCompareUrl(rawUrl?: string): string {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl.trim());
    u.hash = '';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return rawUrl.trim().replace(/\/+$/, '');
  }
}

async function scrapeFullItemWithSubpages(
  mainUrl: string,
  mainHtml: string,
  options?: { skipEpisodeCrawl?: boolean }
): Promise<ScrapedMediaItem> {
  const { media, hints } = parseHtmlToMediaWithHints(mainHtml, mainUrl);

  let watchUrl = hints.watchSubpageUrl;
  let downloadUrl = hints.downloadSubpageUrl;

  // Step 1: If a separate watch/player subpage exists (e.g. play.php?vid=...) and servers aren't already complete, fetch it
  if (watchUrl && canonicalizeCompareUrl(watchUrl) !== canonicalizeCompareUrl(mainUrl)) {
    try {
      const u = new URL(watchUrl);
      if (!isBlockedHost(u.hostname)) {
        const watchRes = await fetchRemoteText(watchUrl, 8500);
        if (watchRes.ok && watchRes.text.length > 100) {
          const watchParsed = parseHtmlToMediaWithHints(watchRes.text, watchUrl);
          if (!media.trailerUrl && watchParsed.media.trailerUrl) {
            media.trailerUrl = watchParsed.media.trailerUrl;
          }
          if (watchParsed.media.servers.length > 0) {
            const seen = new Set(media.servers.map((s) => s.url));
            for (const srv of watchParsed.media.servers) {
              if (!seen.has(srv.url)) {
                media.servers.push(srv);
                seen.add(srv.url);
              }
            }
          }
          if (watchParsed.media.downloads.length > 0) {
            const seenDl = new Set(media.downloads.map((d) => d.url));
            for (const dl of watchParsed.media.downloads) {
              if (!seenDl.has(dl.url)) {
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
      // Non-fatal: continue with main page data
    }
  }

  // Step 2: If a separate download subpage exists (e.g. download.php?vid=...), fetch it for real download mirrors
  if (downloadUrl && downloadUrl !== mainUrl && downloadUrl !== watchUrl) {
    try {
      const u = new URL(downloadUrl);
      if (!isBlockedHost(u.hostname)) {
        const dlRes = await fetchRemoteText(downloadUrl, 8500);
        if (dlRes.ok && dlRes.text.length > 100) {
          const dlParsed = parseHtmlToMediaWithHints(dlRes.text, downloadUrl, {
            isDownloadPage: true,
          });
          if (dlParsed.media.downloads.length > 0) {
            const seenDl = new Set(media.downloads.map((d) => d.url));
            for (const dl of dlParsed.media.downloads) {
              if (!seenDl.has(dl.url)) {
                media.downloads.push(dl);
                seenDl.add(dl.url);
              }
            }
          }
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // Step 3: If servers are loaded dynamically via AJAX embed IDs (e.g. FaselHD `data-embed="173411"`), resolve them via /ajax/embed
  if (media.servers.length === 0 && hints.ajaxEmbedIds.length > 0) {
    const ajaxServers = await resolveAjaxEmbedsFromOrigins(
      hints.ajaxEmbedIds,
      hints.candidateOrigins,
      mainUrl,
      media.quality
    );
    const seen = new Set(media.servers.map((s) => s.url));
    for (const srv of ajaxServers) {
      if (!seen.has(srv.url) && !isLikelyNonVideoWebsiteUrl(srv.url)) {
        media.servers.push(srv);
        seen.add(srv.url);
      }
    }
  }

  let mainOrigin = '';
  try {
    if (mainUrl) mainOrigin = new URL(mainUrl).origin;
  } catch {
    // ignore
  }

  // Step 4: Verify scraped servers aren't website homepages / broken + enforce سيرفر 1, سيرفر 2...
  // Step 5: Fallback trailer search on YouTube if page omitted trailer (skip trailer search when crawling individual episodes)
  const [filteredServers, fallbackTrailer] = await Promise.all([
    verifyScrapedServers(media.servers, mainOrigin),
    media.trailerUrl || options?.skipEpisodeCrawl
      ? Promise.resolve(media.trailerUrl)
      : findYoutubeTrailerFallback(media.title, media.englishTitle, media.year, media.kind),
  ]);

  media.servers = filteredServers;
  media.trailerUrl = fallbackTrailer || '';
  media.downloads = media.downloads.slice(0, 12);

  // Step 6: Per-Episode Deep Server Extraction for Series (so Episode 2, 3, 4... each have their OWN watch servers!)
  if (!options?.skipEpisodeCrawl && media.seasons.length > 0 && media.seasons[0].episodes.length > 0) {
    const canonicalMain = canonicalizeCompareUrl(mainUrl);
    const canonicalWatch = canonicalizeCompareUrl(watchUrl);
    const episodesList = media.seasons[0].episodes;
    const EP_CONCURRENCY = 4;

    for (let i = 0; i < episodesList.length; i += EP_CONCURRENCY) {
      const chunk = episodesList.slice(i, i + EP_CONCURRENCY);
      await Promise.all(
        chunk.map(async (ep) => {
          const epPageUrl = ep.watchUrl || '';
          const canonicalEp = canonicalizeCompareUrl(epPageUrl);

          if (!canonicalEp || canonicalEp === canonicalMain || canonicalEp === canonicalWatch) {
            ep.servers = filteredServers.map((s, sIdx) => ({
              ...s,
              id: `ep-${ep.number}-srv-${sIdx + 1}`,
              name: `سيرفر ${sIdx + 1}`,
            }));
            ep.watchUrl = ep.servers[0]?.url || '';
            return;
          }

          try {
            const parsedEpUrl = new URL(epPageUrl);
            if (isBlockedHost(parsedEpUrl.hostname)) {
              ep.servers = [];
              ep.watchUrl = '';
              return;
            }
            const epRes = await fetchRemoteText(epPageUrl, 8500);
            if (epRes.ok && epRes.text.length > 100) {
              const epData = await scrapeFullItemWithSubpages(epPageUrl, epRes.text, {
                skipEpisodeCrawl: true,
              });
              ep.servers = epData.servers.map((s, sIdx) => ({
                ...s,
                id: `ep-${ep.number}-srv-${sIdx + 1}`,
                name: `سيرفر ${sIdx + 1}`,
              }));
              ep.watchUrl = ep.servers[0]?.url || '';
              return;
            }
          } catch {
            // Fall through and clear raw website URL
          }
          ep.servers = [];
          ep.watchUrl = '';
        })
      );
    }

    // If root media servers were empty (e.g., series overview page), inherit Episode 1's servers
    if (media.servers.length === 0) {
      const firstEpWithServers = episodesList.find((e) => e.servers && e.servers.length > 0);
      if (firstEpWithServers?.servers) {
        media.servers = firstEpWithServers.servers.map((s, idx) => ({
          ...s,
          id: `srv-ext-${idx + 1}`,
          name: `سيرفر ${idx + 1}`,
        }));
      }
    }
  }

  return media;
}

async function tryBloggerFeedScrape(
  origin: string,
  maxItems: number
): Promise<{ siteTitle: string; items: ScrapedMediaItem[] } | null> {
  try {
    const feedUrl = `${origin}/feeds/posts/default?alt=json&max-results=${maxItems}`;
    const res = await fetchRemoteText(feedUrl, 10000);
    if (!res.ok || !res.text.trim().startsWith('{')) return null;

    const json = JSON.parse(res.text) as {
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
    };

    const entries = json.feed?.entry;
    if (!Array.isArray(entries) || entries.length === 0) return null;

    const siteTitle = cleanText(json.feed?.title?.$t) || new URL(origin).hostname;
    const items: ScrapedMediaItem[] = entries.slice(0, maxItems).map((entry) => {
      const altLink = entry.link?.find((l) => l.rel === 'alternate')?.href || origin;
      const contentHtml = entry.content?.$t || entry.summary?.$t || '';
      const parsed = parseHtmlToMedia(contentHtml, altLink);

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
  } catch {
    return null;
  }
}

async function tryWordPressApiScrape(
  origin: string,
  maxItems: number
): Promise<{ siteTitle: string; items: ScrapedMediaItem[] } | null> {
  try {
    const wpUrl = `${origin}/wp-json/wp/v2/posts?per_page=${Math.min(maxItems, 50)}&_embed`;
    const res = await fetchRemoteText(wpUrl, 10000);
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

    const items: ScrapedMediaItem[] = posts.slice(0, maxItems).map((post) => {
      const postUrl = post.link || origin;
      const htmlBody = `${post.content?.rendered || ''} ${post.excerpt?.rendered || ''}`;
      const parsed = parseHtmlToMedia(htmlBody, postUrl);
      const rawTitle = cleanText(cheerio.load(post.title?.rendered || '').text());
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

async function trySitemapDiscovery(origin: string, maxItems: number): Promise<string[]> {
  const candidates = [`${origin}/sitemap.xml`, `${origin}/post-sitemap.xml`];
  const discovered: string[] = [];

  for (const smUrl of candidates) {
    try {
      const res = await fetchRemoteText(smUrl, 8000);
      if (!res.ok || !res.text.includes('<loc>')) continue;
      const $ = cheerio.load(res.text, { xmlMode: true });
      const nestedSitemaps: string[] = [];

      $('sitemap loc').each((_, el) => {
        const loc = cleanText($(el).text());
        if (loc && !loc.includes('page-sitemap') && !loc.includes('category-sitemap')) {
          nestedSitemaps.push(loc);
        }
      });

      $('url loc').each((_, el) => {
        const loc = cleanText($(el).text());
        if (loc && isLikelyContentUrl(loc, origin) && !discovered.includes(loc)) {
          discovered.push(loc);
        }
      });

      for (const childSm of nestedSitemaps.slice(0, 2)) {
        if (discovered.length >= maxItems) break;
        const subRes = await fetchRemoteText(childSm, 8000);
        if (!subRes.ok) continue;
        const $sub = cheerio.load(subRes.text, { xmlMode: true });
        $sub('url loc').each((_, el) => {
          const loc = cleanText($sub(el).text());
          if (loc && isLikelyContentUrl(loc, origin) && !discovered.includes(loc)) {
            discovered.push(loc);
          }
        });
      }

      if (discovered.length > 0) break;
    } catch {
      // Ignore sitemap fetch failure
    }
  }

  return discovered.slice(0, maxItems);
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '6mb' }));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (_req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    return next();
  });

  // Single Item Content Scraper Endpoint (URL or Raw HTML)
  app.post('/api/scrape', async (req, res) => {
    try {
      const { url, rawHtml } = req.body as { url?: string; rawHtml?: string };

      if (rawHtml && typeof rawHtml === 'string' && rawHtml.trim().length > 20) {
        const canonicalInHtml =
          rawHtml.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] ||
          rawHtml.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
          '';
        const effectiveUrl = (url && url.trim()) || canonicalInHtml || '';
        const extracted = await scrapeFullItemWithSubpages(effectiveUrl, rawHtml);
        return res.json({ ok: true, source: 'html', extracted });
      }

      if (!url || typeof url !== 'string') {
        return res.status(400).json({ ok: false, error: 'يرجى إدخال رابط صفحة صالح أو لصق كود HTML.' });
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url.trim());
      } catch {
        return res.status(400).json({ ok: false, error: 'صيغة الرابط غير صحيحة. يجب أن يبدأ بـ https://' });
      }

      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return res.status(400).json({ ok: false, error: 'البروتوكول المسموح هو HTTP أو HTTPS فقط.' });
      }

      if (isBlockedHost(parsedUrl.hostname)) {
        return res.status(403).json({ ok: false, error: 'لا يُسمح بجلب الروابط الداخلية أو المحلية.' });
      }

      const fetched = await fetchRemoteText(parsedUrl.toString(), 12000);

      if (!fetched.ok) {
        return res.status(502).json({
          ok: false,
          error: `الموقع المصدر رفض الاتصال (رمز الحالة ${fetched.status}). يمكنك نسخ View-Source ولصقه في خانة HTML البديلة.`,
        });
      }

      if (!fetched.text || fetched.text.length < 100) {
        return res.status(502).json({
          ok: false,
          error: 'استجاب الموقع بصفحة فارغة. جرّب استخدام وضع لصق كود HTML.',
        });
      }

      const extracted = await scrapeFullItemWithSubpages(parsedUrl.toString(), fetched.text);
      return res.json({ ok: true, source: 'url', extracted });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'خطأ غير متوقع';
      return res.status(500).json({
        ok: false,
        error: `تعذر سحب الصفحة تلقائيًا (${msg}). جرّب لصق كود HTML للموقع المستهدف في التبويب المخصص.`,
      });
    }
  });

  // Site-Wide Bulk Crawler Endpoint (Entire Website Scraper)
  app.post('/api/scrape-site', async (req, res) => {
    try {
      const {
        siteUrl,
        rawHtml,
        maxItems = 30,
        maxPages = 3,
        deepScrape = true,
      } = req.body as {
        siteUrl?: string;
        rawHtml?: string;
        maxItems?: number;
        maxPages?: number;
        deepScrape?: boolean;
      };

      const itemLimit = Math.min(80, Math.max(1, Number(maxItems) || 30));
      const pageLimit = Math.min(8, Math.max(1, Number(maxPages) || 3));

      let parsedSiteUrl: URL | null = null;
      if (siteUrl && typeof siteUrl === 'string' && siteUrl.trim()) {
        try {
          parsedSiteUrl = new URL(siteUrl.trim());
        } catch {
          return res.status(400).json({ ok: false, error: 'رابط الموقع غير صالح. يجب أن يبدأ بـ https://' });
        }
        if (!['http:', 'https:'].includes(parsedSiteUrl.protocol)) {
          return res.status(400).json({ ok: false, error: 'البروتوكول المسموح هو HTTP أو HTTPS فقط.' });
        }
        if (isBlockedHost(parsedSiteUrl.hostname)) {
          return res.status(403).json({ ok: false, error: 'لا يُسمح بجلب الروابط الداخلية أو المحلية.' });
        }
      }

      if (!parsedSiteUrl && (!rawHtml || rawHtml.trim().length < 50)) {
        return res.status(400).json({
          ok: false,
          error: 'يرجى إدخال رابط الموقع المستهدف أو لصق سورس الصفحة الرئيسية.',
        });
      }

      // If URL mode (no rawHtml override): try Blogger JSON Feed first (Blogger embeds live in feed)
      if (parsedSiteUrl && (!rawHtml || rawHtml.trim().length < 50)) {
        const origin = parsedSiteUrl.origin;

        const bloggerRes = await tryBloggerFeedScrape(origin, itemLimit);
        if (bloggerRes && bloggerRes.items.length > 0) {
          return res.json({
            ok: true,
            strategy: 'Blogger JSON Feed',
            siteTitle: bloggerRes.siteTitle,
            totalDiscovered: bloggerRes.items.length,
            items: bloggerRes.items,
          });
        }
      }

      // General HTML Crawler (with multi-page pagination or rawHtml) — preserves section paths like /movies/ and enables full //watch subpage scraping
      const discoveredMap = new Map<string, { url: string; title: string; poster: string }>();
      let siteTitle = parsedSiteUrl ? parsedSiteUrl.hostname : 'موقع مستورد';
      let strategy = rawHtml ? 'HTML Source Crawler' : 'HTML Multi-Page Crawler';

      if (rawHtml && rawHtml.trim().length >= 50) {
        const baseForHtml = parsedSiteUrl ? parsedSiteUrl.toString() : 'https://example.com';
        const resHtml = extractListingLinksAndPagination(rawHtml, baseForHtml);
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

          const pageRes = await fetchRemoteText(currentUrl, 12000).catch(() => null);
          if (!pageRes || !pageRes.ok || pageRes.text.length < 100) {
            if (visitedPages.size === 1) {
              // First page blocked: try WordPress API + Sitemap fallbacks before failing
              const wpFallback = await tryWordPressApiScrape(parsedSiteUrl.origin, itemLimit);
              if (wpFallback && wpFallback.items.length > 0) {
                if (deepScrape) {
                  const enrichedItems: ScrapedMediaItem[] = [];
                  for (let i = 0; i < wpFallback.items.length; i += 4) {
                    const chunk = wpFallback.items.slice(i, i + 4);
                    const updated = await Promise.all(
                      chunk.map(async (item) => {
                        const wpUrl = item.sourceUrl || '';
                        if (item.servers.length === 0 && wpUrl) {
                          try {
                            const detailRes = await fetchRemoteText(wpUrl, 9000);
                            if (detailRes.ok && detailRes.text.length > 150) {
                              const full = await scrapeFullItemWithSubpages(wpUrl, detailRes.text);
                              if (!full.poster && item.poster) {
                                full.poster = item.poster;
                                full.backdrop = item.poster;
                              }
                              return full;
                            }
                          } catch {
                            // Keep WP API item if detail page fails
                          }
                        }
                        return item;
                      })
                    );
                    enrichedItems.push(...updated);
                  }
                  wpFallback.items = enrichedItems;
                }
                return res.json({
                  ok: true,
                  strategy: 'WordPress REST API + Deep Scrape',
                  siteTitle: wpFallback.siteTitle,
                  totalDiscovered: wpFallback.items.length,
                  items: wpFallback.items,
                });
              }

              const smUrls = await trySitemapDiscovery(parsedSiteUrl.origin, itemLimit);
              if (smUrls.length > 0) {
                strategy = 'XML Sitemap Crawler';
                for (const u of smUrls) {
                  discoveredMap.set(u, { url: u, title: decodeURIComponent(u.split('/').pop() || u), poster: '' });
                }
                break;
              }
              return res.status(502).json({
                ok: false,
                error: `رفض الموقع الوصول للصفحة الرئيسية (حماية أو رمز ${pageRes?.status || 'اتصال'}). انسخ سورس الصفحة الرئيسية (Ctrl+U) واستخدم وضع "لصق HTML الموقع".`,
              });
            }
            continue;
          }

          const extractedPage = extractListingLinksAndPagination(pageRes.text, currentUrl);
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
          const wpFallback = await tryWordPressApiScrape(parsedSiteUrl.origin, itemLimit);
          if (wpFallback && wpFallback.items.length > 0) {
            return res.json({
              ok: true,
              strategy: 'WordPress REST API',
              siteTitle: wpFallback.siteTitle,
              totalDiscovered: wpFallback.items.length,
              items: wpFallback.items,
            });
          }

          const smUrls = await trySitemapDiscovery(parsedSiteUrl.origin, itemLimit);
          if (smUrls.length > 0) {
            strategy = 'XML Sitemap Crawler';
            for (const u of smUrls) {
              discoveredMap.set(u, { url: u, title: decodeURIComponent(u.split('/').pop() || u), poster: '' });
            }
          }
        }
      }

      const candidates = Array.from(discoveredMap.values()).slice(0, itemLimit);
      if (candidates.length === 0) {
        return res.status(404).json({
          ok: false,
          error: 'لم يتم العثور على بطاقات أفلام أو مسلسلات في الرابط المحدد. جرّب وضع رابط قسم الأفلام أو لصق HTML الصفحة.',
        });
      }

      const finalItems: ScrapedMediaItem[] = [];
      if (deepScrape) {
        const CONCURRENCY = 4;
        for (let i = 0; i < candidates.length; i += CONCURRENCY) {
          const chunk = candidates.slice(i, i + CONCURRENCY);
          const results = await Promise.all(
            chunk.map(async (card) => {
              try {
                const detailRes = await fetchRemoteText(card.url, 9000);
                if (detailRes.ok && detailRes.text.length > 150) {
                  const parsed = await scrapeFullItemWithSubpages(card.url, detailRes.text);
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
                // Fall back to card metadata if single detail page fails
              }
              return {
                title: card.title || 'عمل مستورد',
                englishTitle: card.title || 'Imported Title',
                kind: (/مسلسل|حلقات/.test(card.title) ? 'series' : 'movie') as ScrapedMediaItem['kind'],
                categories: /مسلسل|حلقات/.test(card.title)
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
                sourceUrl: card.url,
                shortUrl: '',
                trailerUrl: '',
                cast: [],
                servers: [],
                downloads: [],
                seasons: [],
              };
            })
          );
          finalItems.push(...results);
        }
      } else {
        for (const card of candidates) {
          finalItems.push({
            title: card.title || 'عمل مستورد',
            englishTitle: card.title || 'Imported Title',
            kind: /مسلسل|حلقات/.test(card.title) ? 'series' : 'movie',
            categories: /مسلسل|حلقات/.test(card.title)
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
            sourceUrl: card.url,
            shortUrl: '',
            trailerUrl: '',
            cast: [],
            servers: [],
            downloads: [],
            seasons: [],
          });
        }
      }

      return res.json({
        ok: true,
        strategy,
        siteTitle,
        totalDiscovered: finalItems.length,
        items: finalItems,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'خطأ غير متوقع';
      return res.status(500).json({
        ok: false,
        error: `حدث خطأ أثناء سحب الموقع (${msg}).`,
      });
    }
  });

  // Server Link Health Check Endpoint (Admin Dashboard Server Status)
  app.post('/api/check-servers', async (req, res) => {
    try {
      const { urls } = req.body as { urls?: unknown };
      if (!Array.isArray(urls)) {
        return res.status(400).json({ ok: false, error: 'يجب إرسال مصفوفة روابط (urls).' });
      }

      const uniqueUrls = Array.from(
        new Set(
          urls
            .map((u) => String(u || '').trim())
            .filter(Boolean)
            .slice(0, 40)
        )
      );

      interface CheckResult {
        status: 'working' | 'warning' | 'broken';
        httpStatus: number;
        label: string;
        detail: string;
        sandboxBlocked?: boolean;
      }

      const results: Record<string, CheckResult> = {};

      const checkSingleUrl = async (targetUrl: string): Promise<CheckResult> => {
        let parsed: URL;
        try {
          parsed = new URL(targetUrl);
        } catch {
          return {
            status: 'broken',
            httpStatus: 0,
            label: 'رابط غير صالح',
            detail: 'صيغة الرابط غير صحيحة',
          };
        }

        if (!['http:', 'https:'].includes(parsed.protocol) || isBlockedHost(parsed.hostname)) {
          return {
            status: 'broken',
            httpStatus: 0,
            label: 'رابط محظور',
            detail: 'بروتوكول أو نطاق غير مسموح',
          };
        }

        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 6500);
          let response: Response;
          try {
            response = await fetch(parsed.toString(), {
              method: 'GET',
              redirect: 'follow',
              signal: controller.signal,
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                Accept: 'text/html,video/*,application/xhtml+xml,*/*;q=0.8',
                Range: 'bytes=0-16384',
              },
            });
          } finally {
            clearTimeout(timer);
          }

          const httpStatus = response.status;
          const contentType = (response.headers.get('content-type') || '').toLowerCase();
          const xFrame = (response.headers.get('x-frame-options') || '').toLowerCase();
          const csp = (response.headers.get('content-security-policy') || '').toLowerCase();
          const cfMitigated = (response.headers.get('cf-mitigated') || '').toLowerCase();

          let snippet = '';
          if (contentType.includes('text/html') || contentType.includes('text/plain') || !contentType) {
            try {
              const txt = await response.text();
              snippet = txt.slice(0, 16000);
            } catch {
              snippet = '';
            }
          }

          if (httpStatus === 404 || httpStatus === 410) {
            return {
              status: 'broken',
              httpStatus,
              label: `معطل (${httpStatus})`,
              detail: 'الصفحة أو الملف غير موجود (Not Found)',
            };
          }

          if (httpStatus >= 500) {
            return {
              status: 'broken',
              httpStatus,
              label: `معطل (${httpStatus})`,
              detail: 'خطأ داخلي من السيرفر المستضيف',
            };
          }

          if (!response.ok && httpStatus !== 206) {
            return {
              status: 'broken',
              httpStatus,
              label: `معطل (${httpStatus})`,
              detail:
                httpStatus === 403
                  ? 'تم رفض الوصول أو محمي (403)'
                  : `رمز حالة غير ناجح (${httpStatus})`,
            };
          }

          // Inspect HTML body for soft-404 / removed video pages
          if (
            snippet &&
            /file\s*(?:was|has been)?\s*(?:deleted|removed)|video\s*(?:was|has been)?\s*(?:deleted|removed|not found)|file\s*not\s*found|404\s*not\s*found|no\s*longer\s*available|تم\s*حذف\s*(?:الملف|الفيديو)|الفيديو\s*غير\s*موجود|الملف\s*غير\s*موجود/i.test(
              snippet
            )
          ) {
            return {
              status: 'broken',
              httpStatus: 404,
              label: 'معطل (404)',
              detail: 'الملف أو الفيديو محذوف أو غير موجود',
            };
          }

          return {
            status: 'working',
            httpStatus,
            label: `يعمل (${httpStatus})`,
            detail: contentType.includes('video')
              ? 'ملف بث مباشر يعمل بنجاح'
              : 'الرابط مستجيب ويعمل بنجاح',
          };
        } catch (err) {
          const isTimeout = err instanceof Error && err.name === 'AbortError';
          return {
            status: 'broken',
            httpStatus: 0,
            label: isTimeout ? 'معطل (مهلة انتهت)' : 'معطل (خطأ اتصال)',
            detail: isTimeout ? 'انتهت مهلة استجابة السيرفر' : 'تعذر الوصول إلى النطاق',
          };
        }
      };

      const CONCURRENCY = 6;
      for (let i = 0; i < uniqueUrls.length; i += CONCURRENCY) {
        const chunk = uniqueUrls.slice(i, i + CONCURRENCY);
        const checked = await Promise.all(chunk.map(async (u) => [u, await checkSingleUrl(u)] as const));
        for (const [u, result] of checked) {
          results[u] = result;
        }
      }

      return res.json({ ok: true, results });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'خطأ غير متوقع';
      return res.status(500).json({ ok: false, error: msg });
    }
  });

  // Resolve Direct MP4/Video Stream or Detect Frame Block for Embed URLs
  app.get('/api/resolve-stream', async (req, res) => {
    try {
      const targetUrl = String(req.query.url || '').trim();
      if (!targetUrl) {
        return res.status(400).json({ ok: false, error: 'Missing url' });
      }
      let parsed: URL;
      try {
        parsed = new URL(targetUrl);
      } catch {
        return res.status(400).json({ ok: false, error: 'Invalid url' });
      }
      if (!['http:', 'https:'].includes(parsed.protocol) || isBlockedHost(parsed.hostname)) {
        return res.status(403).json({ ok: false, error: 'Blocked url' });
      }

      if (/\.(mp4|webm|ogg)(\?|$)/i.test(parsed.toString())) {
        return res.json({ ok: true, directUrl: parsed.toString(), kind: 'mp4', frameBlocked: false });
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      let response: Response;
      try {
        response = await fetch(parsed.toString(), {
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            Referer: parsed.origin + '/',
            Accept: 'text/html,application/xhtml+xml,*/*',
          },
        });
      } finally {
        clearTimeout(timer);
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('video/')) {
        return res.json({ ok: true, directUrl: response.url || parsed.toString(), kind: 'mp4', frameBlocked: false });
      }

      const xFrame = (response.headers.get('x-frame-options') || '').toLowerCase();
      const csp = (response.headers.get('content-security-policy') || '').toLowerCase();
      const html = await response.text();

      const frameBlocked =
        xFrame.includes('deny') ||
        xFrame.includes('sameorigin') ||
        /frame-ancestors\s+[^;]*'none'|frame-ancestors\s+'self'/.test(csp) ||
        /sandboxed\s+embed\s+is\s+not\s+allowed/i.test(html);

      // Try extracting direct MP4 source from embed HTML
      const mp4Match =
        html.match(/<(?:video|source)[^>]+src=["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i) ||
        html.match(/(?:file|src|video_url|mp4_url)\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i) ||
        html.match(/["'](https?:\/\/[^"'\s<>]+\.mp4(?:\?[^"'\s<>]*)?)["']/i);

      if (mp4Match?.[1]) {
        return res.json({
          ok: true,
          directUrl: mp4Match[1].replace(/\\\//g, '/'),
          kind: 'mp4',
          frameBlocked,
        });
      }

      return res.json({ ok: true, directUrl: null, frameBlocked });
    } catch {
      return res.json({ ok: true, directUrl: null, frameBlocked: false });
    }
  });

  // Automatic Official Trailer Lookup Endpoint
  app.post('/api/find-trailer', async (req, res) => {
    try {
      const { title = '', englishTitle = '', year = '', kind = 'movie' } = req.body as {
        title?: string;
        englishTitle?: string;
        year?: string;
        kind?: 'movie' | 'series' | 'tv' | 'wrestling';
      };
      const trailerUrl = await findYoutubeTrailerFallback(title, englishTitle, year, kind);
      return res.json({ ok: true, trailerUrl });
    } catch {
      return res.json({ ok: false, trailerUrl: '' });
    }
  });

  // Auto Server Filtering Endpoint (detects 403, Sandboxed embed, 404, X-Frame-Options/CSP blocks, and website homepages)
  app.post('/api/filter-servers', async (req, res) => {
    try {
      const { urls } = req.body as { urls?: unknown };
      if (!Array.isArray(urls)) {
        return res.status(400).json({ ok: false, error: 'يجب إرسال قائمة الروابط (urls).' });
      }

      const targetUrls = urls.map((u) => String(u || '').trim()).slice(0, 60);

      interface FilterCheckResult {
        url: string;
        ok: boolean;
        faultType: '403' | 'sandboxed_embed' | '404' | 'frame_blocked' | 'not_video' | 'error' | null;
        httpStatus: number;
        reason: string;
        directStreamUrl?: string | null;
      }

      const inspectServerUrl = async (rawUrl: string): Promise<FilterCheckResult> => {
        if (!rawUrl) {
          return {
            url: rawUrl,
            ok: false,
            faultType: 'error',
            httpStatus: 0,
            reason: 'لا يوجد رابط تشغيل',
          };
        }

        let parsed: URL;
        try {
          parsed = new URL(rawUrl);
        } catch {
          return {
            url: rawUrl,
            ok: false,
            faultType: 'error',
            httpStatus: 0,
            reason: 'صيغة الرابط غير صالحة',
          };
        }

        if (!['http:', 'https:'].includes(parsed.protocol) || isBlockedHost(parsed.hostname)) {
          return {
            url: rawUrl,
            ok: false,
            faultType: 'error',
            httpStatus: 0,
            reason: 'رابط غير مسموح به',
          };
        }

        if (isLikelyNonVideoWebsiteUrl(parsed.toString())) {
          return {
            url: rawUrl,
            ok: false,
            faultType: 'not_video',
            httpStatus: 200,
            reason: 'الرابط يفتح صفحة موقع وليس مشغل فيديو',
          };
        }

        const isDirectMedia = /\.(mp4|webm|ogg|m3u8)(\?|$)/i.test(parsed.toString());
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5500);

        try {
          const response = await fetch(parsed.toString(), {
            method: isDirectMedia ? 'HEAD' : 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
              Referer: parsed.origin + '/',
              Accept: 'text/html,video/*,application/xhtml+xml,*/*;q=0.8',
              ...(isDirectMedia ? {} : { Range: 'bytes=0-32768' }),
            },
          });

          const finalUrl = response.url || parsed.toString();
          const httpStatus = response.status;
          const contentType = (response.headers.get('content-type') || '').toLowerCase();
          const xFrame = (response.headers.get('x-frame-options') || '').toLowerCase();
          const csp = (response.headers.get('content-security-policy') || '').toLowerCase();
          const cfMitigated = (response.headers.get('cf-mitigated') || '').toLowerCase();

          let snippet = '';
          if (!isDirectMedia && (contentType.includes('text/html') || contentType.includes('text/plain') || !contentType)) {
            try {
              const txt = await response.text();
              snippet = txt.slice(0, 32768);
            } catch {
              snippet = '';
            }
          }

          // 0. Detect non-video website homepages / redirects (e.g. larooza.tv/, laroza1.bond/home.24)
          if (!isDirectMedia && isWebsiteHomepageHtml(finalUrl, snippet)) {
            return {
              url: rawUrl,
              ok: false,
              faultType: 'not_video',
              httpStatus,
              reason: 'الرابط يفتح الصفحة الرئيسية لموقع وليس فيديو',
            };
          }

          // 1. Detect Sandboxed embed messages explicitly
          const hasSandboxedMsg =
            /sandboxed\s+embed\s+is\s+not\s+allowed|sandboxed\s+embed|please\s+disable\s+sandbox|embedding\s+in\s+sandbox\s+is\s+not\s+allowed/i.test(
              snippet
            );

          if (hasSandboxedMsg) {
            const mp4Fallback =
              snippet.match(/<(?:video|source)[^>]+src=["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i)?.[1] ||
              snippet.match(/(?:file|src|video_url|mp4_url)\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i)?.[1];
            if (mp4Fallback) {
              return {
                url: rawUrl,
                ok: true,
                faultType: null,
                httpStatus,
                reason: 'تم استخراج البث المباشر بنجاح',
                directStreamUrl: mp4Fallback.replace(/\\\//g, '/'),
              };
            }
            return {
              url: rawUrl,
              ok: false,
              faultType: 'sandboxed_embed',
              httpStatus,
              reason: 'رسالة Sandboxed embed (يمنع التشغيل المدمج)',
            };
          }

          // 2. Detect HTTP 403 Forbidden / Cloudflare block
          const is403Body =
            httpStatus === 403 ||
            cfMitigated === 'challenge' ||
            (snippet &&
              /<title>\s*(?:403\s+Forbidden|Access\s+Denied|Just\s+a\s+moment|Attention\s+Required)/i.test(snippet));

          if (is403Body) {
            return {
              url: rawUrl,
              ok: false,
              faultType: '403',
              httpStatus: httpStatus === 200 ? 403 : httpStatus,
              reason: 'خطأ 403 (رفض الوصول من السيرفر)',
            };
          }

          // 3. Detect 404 / Soft-404
          const is404Body =
            httpStatus === 404 ||
            httpStatus === 410 ||
            (snippet &&
              /file\s*(?:was|has been)?\s*(?:deleted|removed)|video\s*(?:was|has been)?\s*(?:deleted|removed|not found)|file\s*not\s*found|404\s*not\s*found|no\s*longer\s*available|تم\s*حذف\s*(?:الملف|الفيديو)|الفيديو\s*غير\s*موجود/i.test(
                snippet
              ));

          if (is404Body) {
            return {
              url: rawUrl,
              ok: false,
              faultType: '404',
              httpStatus: 404,
              reason: 'الملف غير موجود (404)',
            };
          }

          if (!response.ok && httpStatus !== 206) {
            return {
              url: rawUrl,
              ok: false,
              faultType: 'error',
              httpStatus,
              reason: `عطل في استجابة السيرفر (${httpStatus})`,
            };
          }

          // 4. Detect Frame Blocking headers (X-Frame-Options / CSP frame-ancestors)
          const frameBlocked =
            xFrame.includes('deny') ||
            xFrame.includes('sameorigin') ||
            /frame-ancestors\s+[^;]*'none'|frame-ancestors\s+'self'/.test(csp);

          const mp4Fallback = snippet
            ? snippet.match(/<(?:video|source)[^>]+src=["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i)?.[1] ||
              snippet.match(/(?:file|src|video_url|mp4_url)\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i)?.[1]
            : null;

          if (frameBlocked) {
            if (mp4Fallback) {
              return {
                url: rawUrl,
                ok: true,
                faultType: null,
                httpStatus,
                reason: 'بث مباشر متاح',
                directStreamUrl: mp4Fallback.replace(/\\\//g, '/'),
              };
            }
            return {
              url: rawUrl,
              ok: false,
              faultType: 'frame_blocked',
              httpStatus,
              reason: 'السيرفر يمنع التضمين المدمج (X-Frame)',
            };
          }

          return {
            url: rawUrl,
            ok: true,
            faultType: null,
            httpStatus,
            reason: 'السيرفر يعمل بنجاح',
            directStreamUrl: mp4Fallback ? mp4Fallback.replace(/\\\//g, '/') : null,
          };
        } catch (err) {
          const isTimeout = err instanceof Error && err.name === 'AbortError';
          return {
            url: rawUrl,
            ok: false,
            faultType: 'error',
            httpStatus: 0,
            reason: isTimeout ? 'انتهت مهلة استجابة السيرفر' : 'تعذر الاتصال بالسيرفر',
          };
        } finally {
          clearTimeout(timer);
        }
      };

      const checked = await Promise.all(targetUrls.map((u) => inspectServerUrl(u)));
      return res.json({ ok: true, results: checked });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'خطأ غير متوقع';
      return res.status(500).json({ ok: false, error: msg });
    }
  });

  // AI Bulk Catalog Editor Endpoint (Server-Side Gemini API)
  app.post('/api/ai-bulk-edit', async (req, res) => {
    try {
      const apiKey = (process.env.GEMINI_API_KEY || '').trim();
      if (!apiKey) {
        return res.status(500).json({
          ok: false,
          error:
            'مفتاح GEMINI_API_KEY غير متوفر على الخادم. يرجى التأكد من إضافته في إعدادات Secrets.',
        });
      }

      const { instruction, items } = req.body as {
        instruction?: unknown;
        items?: unknown;
      };

      const cleanInstruction = typeof instruction === 'string' ? instruction.trim() : '';
      if (!cleanInstruction || cleanInstruction.length < 3) {
        return res.status(400).json({
          ok: false,
          error: 'يرجى كتابة أمر واضح للتعديل الشامل على المحتوى.',
        });
      }
      if (cleanInstruction.length > 2000) {
        return res.status(400).json({
          ok: false,
          error: 'نص التعليمات طويل جداً (الحد الأقصى 2000 حرف).',
        });
      }

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          ok: false,
          error: 'لا توجد أعمال محددة لتطبيق التعديل عليها.',
        });
      }

      interface AiInputItem {
        id: string;
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
        tagline: string;
        story: string;
        pinned: boolean;
        isNew: boolean;
        comingSoon: boolean;
      }

      interface AiPatchItem {
        id: string;
        title?: string;
        englishTitle?: string;
        kind?: 'movie' | 'series' | 'tv' | 'wrestling';
        categories?: string[];
        genres?: string[];
        year?: string;
        country?: string;
        language?: string;
        quality?: string;
        duration?: string;
        tagline?: string;
        story?: string;
        pinned?: boolean;
        isNew?: boolean;
        comingSoon?: boolean;
      }

      const sanitizedItems: AiInputItem[] = items.slice(0, 400).map((raw: Record<string, unknown>) => ({
        id: String(raw.id || '').trim(),
        title: String(raw.title || '').slice(0, 200),
        englishTitle: String(raw.englishTitle || '').slice(0, 200),
        kind: (['movie', 'series', 'tv', 'wrestling'].includes(String(raw.kind))
          ? String(raw.kind)
          : 'movie') as AiInputItem['kind'],
        categories: Array.isArray(raw.categories)
          ? raw.categories.map((c) => String(c || '').trim()).filter(Boolean).slice(0, 10)
          : [],
        genres: Array.isArray(raw.genres)
          ? raw.genres.map((g) => String(g || '').trim()).filter(Boolean).slice(0, 10)
          : [],
        year: String(raw.year || '').slice(0, 10),
        country: String(raw.country || '').slice(0, 80),
        language: String(raw.language || '').slice(0, 80),
        quality: String(raw.quality || '').slice(0, 40),
        duration: String(raw.duration || '').slice(0, 40),
        tagline: String(raw.tagline || '').slice(0, 400),
        story: String(raw.story || '').slice(0, 2000),
        pinned: Boolean(raw.pinned),
        isNew: Boolean(raw.isNew),
        comingSoon: Boolean(raw.comingSoon),
      })).filter((it) => it.id.length > 0);

      if (sanitizedItems.length === 0) {
        return res.status(400).json({
          ok: false,
          error: 'لم يتم العثور على معرفات صالحة للأعمال.',
        });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const BATCH_SIZE = 25;
      const chunks: AiInputItem[][] = [];
      for (let i = 0; i < sanitizedItems.length; i += BATCH_SIZE) {
        chunks.push(sanitizedItems.slice(i, i + BATCH_SIZE));
      }

      const systemInstruction = [
        'أنت محرر محتوى متخصص لمنصة RahaL TV للأفلام والمسلسلات.',
        'مهمتك تنفيذ أمر التعديل الشامل الذي يطلبه المشرف بدقة متناهية على قائمة الأعمال المرسلة.',
        'القواعد الصارمة:',
        '1. أرجع في مصفوفة updates فقط الأعمال التي تحتاج تعديلاً فعلياً بناءً على الأمر، واحتفظ بنفس حقل id لكل عمل.',
        '2. في كل عنصر داخل updates، أدرج فقط الحقول التي تغيرت قيمتها فعلياً (لا تعيد الحقول غير المعدلة إلا إذا لزم، ولا تخترع أعمالاً جديدة).',
        '3. إذا طُلب حذف كلمة أو بادئة مثل "فيلم" أو "مسلسل" أو عبارات مثل "مترجم اون لاين بجودة عالية"، أزلها بدقة ونظّف المسافات الزائدة دون إتلاف اسم العمل الأساسي أو السنة.',
        '4. القيم المسموحة لحقل kind إن تم تغييره هي فقط: movie, series, tv, wrestling.',
        '5. حافظ على اللغة العربية سليمة وجذابة، واجعل summary ملخصاً عربياً واضحاً لما تم تعديله.',
      ].join('\n');

      const processChunkWithRetry = async (chunk: AiInputItem[]) => {
        const chunkIds = new Set(chunk.map((c) => c.id));
        const userPrompt = JSON.stringify({
          instruction: cleanInstruction,
          items: chunk,
        });

        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const response = await ai.models.generateContent({
              model: 'gemini-4-hydrogen',
              contents: userPrompt,
              config: {
                systemInstruction,
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    summary: {
                      type: Type.STRING,
                      description: 'ملخص عربي مختصر للتعديلات التي طُبقت على هذه المجموعة.',
                    },
                    updates: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          id: { type: Type.STRING },
                          title: { type: Type.STRING },
                          englishTitle: { type: Type.STRING },
                          kind: { type: Type.STRING },
                          categories: { type: Type.ARRAY, items: { type: Type.STRING } },
                          genres: { type: Type.ARRAY, items: { type: Type.STRING } },
                          year: { type: Type.STRING },
                          country: { type: Type.STRING },
                          language: { type: Type.STRING },
                          quality: { type: Type.STRING },
                          duration: { type: Type.STRING },
                          tagline: { type: Type.STRING },
                          story: { type: Type.STRING },
                          pinned: { type: Type.BOOLEAN },
                          isNew: { type: Type.BOOLEAN },
                          comingSoon: { type: Type.BOOLEAN },
                        },
                        required: ['id'],
                      },
                    },
                  },
                  required: ['summary', 'updates'],
                },
              },
            });

            const parsed = JSON.parse((response.text ?? '{}').trim()) as {
              summary?: string;
              updates?: AiPatchItem[];
            };

            const validUpdates: AiPatchItem[] = [];
            if (Array.isArray(parsed.updates)) {
              for (const rawUpd of parsed.updates) {
                if (!rawUpd || typeof rawUpd.id !== 'string' || !chunkIds.has(rawUpd.id)) continue;
                const cleanUpd: AiPatchItem = { id: rawUpd.id };
                if (typeof rawUpd.title === 'string' && rawUpd.title.trim()) {
                  cleanUpd.title = rawUpd.title.trim().slice(0, 200);
                }
                if (typeof rawUpd.englishTitle === 'string' && rawUpd.englishTitle.trim()) {
                  cleanUpd.englishTitle = rawUpd.englishTitle.trim().slice(0, 200);
                }
                if (
                  typeof rawUpd.kind === 'string' &&
                  ['movie', 'series', 'tv', 'wrestling'].includes(rawUpd.kind)
                ) {
                  cleanUpd.kind = rawUpd.kind;
                }
                if (Array.isArray(rawUpd.categories) && rawUpd.categories.length > 0) {
                  const cats = rawUpd.categories
                    .map((c) => String(c || '').trim().slice(0, 60))
                    .filter(Boolean)
                    .slice(0, 10);
                  if (cats.length > 0) cleanUpd.categories = cats;
                }
                if (Array.isArray(rawUpd.genres) && rawUpd.genres.length > 0) {
                  const gns = rawUpd.genres
                    .map((g) => String(g || '').trim().slice(0, 60))
                    .filter(Boolean)
                    .slice(0, 10);
                  if (gns.length > 0) cleanUpd.genres = gns;
                }
                if (typeof rawUpd.year === 'string' && rawUpd.year.trim().length >= 4) {
                  cleanUpd.year = rawUpd.year.trim().slice(0, 10);
                }
                if (typeof rawUpd.country === 'string' && rawUpd.country.trim()) {
                  cleanUpd.country = rawUpd.country.trim().slice(0, 80);
                }
                if (typeof rawUpd.language === 'string' && rawUpd.language.trim()) {
                  cleanUpd.language = rawUpd.language.trim().slice(0, 80);
                }
                if (typeof rawUpd.quality === 'string' && rawUpd.quality.trim()) {
                  cleanUpd.quality = rawUpd.quality.trim().slice(0, 40);
                }
                if (typeof rawUpd.duration === 'string' && rawUpd.duration.trim()) {
                  cleanUpd.duration = rawUpd.duration.trim().slice(0, 40);
                }
                if (typeof rawUpd.tagline === 'string') {
                  cleanUpd.tagline = rawUpd.tagline.trim().slice(0, 400);
                }
                if (typeof rawUpd.story === 'string' && rawUpd.story.trim()) {
                  cleanUpd.story = rawUpd.story.trim().slice(0, 3000);
                }
                if (typeof rawUpd.pinned === 'boolean') cleanUpd.pinned = rawUpd.pinned;
                if (typeof rawUpd.isNew === 'boolean') cleanUpd.isNew = rawUpd.isNew;
                if (typeof rawUpd.comingSoon === 'boolean') cleanUpd.comingSoon = rawUpd.comingSoon;

                if (Object.keys(cleanUpd).length > 1) {
                  validUpdates.push(cleanUpd);
                }
              }
            }

            return {
              summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
              updates: validUpdates,
            };
          } catch (err) {
            lastErr = err;
            const errStr = err instanceof Error ? err.message : String(err);
            const isPermanent =
              /API_KEY_INVALID|PERMISSION_DENIED|NOT_FOUND|400|403|404/.test(errStr) &&
              !/429|500|503|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(errStr);
            if (isPermanent || attempt === 2) {
              throw err;
            }
            await new Promise((r) => setTimeout(r, 700 * Math.pow(2, attempt)));
          }
        }
        throw lastErr;
      };

      const allUpdates: AiPatchItem[] = [];
      const summaries: string[] = [];

      // Process up to 3 batches concurrently for speed across large catalogs
      for (let i = 0; i < chunks.length; i += 3) {
        const wave = chunks.slice(i, i + 3);
        const results = await Promise.all(wave.map((c) => processChunkWithRetry(c)));
        for (const r of results) {
          if (r.summary) summaries.push(r.summary);
          allUpdates.push(...r.updates);
        }
      }

      return res.json({
        ok: true,
        model: 'gemini-4-hydrogen',
        processedCount: sanitizedItems.length,
        batchesCount: chunks.length,
        summary: summaries[0] || `تم تحليل ${sanitizedItems.length} عملًا وتجهيز التعديلات المقترحة.`,
        updates: allUpdates,
      });
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'تعذر تنفيذ المعالجة بالذكاء الاصطناعي.';
      let friendlyMsg = `تعذر تنفيذ التعديل عبر Gemini AI: ${rawMsg}`;
      if (/API_KEY_INVALID|PERMISSION_DENIED|403/.test(rawMsg)) {
        friendlyMsg =
          'مفتاح Gemini API غير صالح أو يفتقر للصلاحية. يرجى مراجعة المفتاح في Settings > Secrets.';
      } else if (/RESOURCE_EXHAUSTED|429/.test(rawMsg)) {
        friendlyMsg =
          'تم تجاوز حد الطلبات المؤقت لـ Gemini API. يرجى الانتظار قليلاً أو تقليل نطاق العناصر ثم المحاولة مجدداً.';
      }
      return res.status(500).json({ ok: false, error: friendlyMsg });
    }
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: disableHmr ? false : { server: httpServer },
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build not found');
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`RahaL TV server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
