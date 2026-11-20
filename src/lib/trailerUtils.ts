import { MediaKind } from '../types/media';

export interface ParsedTrailerPlayback {
  kind: 'video' | 'iframe';
  src: string;
  watchUrl: string;
  isYouTube: boolean;
  youtubeId?: string;
}

const YOUTUBE_ID_RX = /^[a-zA-Z0-9_-]{6,20}$/;

export function extractYouTubeVideoId(rawUrl: string): string | null {
  const input = String(rawUrl || '').trim();
  if (!input) return null;

  const normalized = input.startsWith('//') ? `https:${input}` : input;
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase().replace(/^(?:www\.|m\.)/, '');

    if (host === 'youtu.be') {
      const seg = parsed.pathname.split('/').filter(Boolean)[0] || '';
      return YOUTUBE_ID_RX.test(seg) ? seg : null;
    }

    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const vParam = parsed.searchParams.get('v');
      if (vParam && YOUTUBE_ID_RX.test(vParam)) {
        return vParam;
      }

      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && /^(embed|shorts|live|v)$/i.test(parts[0])) {
        return YOUTUBE_ID_RX.test(parts[1]) ? parts[1] : null;
      }
    }
  } catch {
    // Fallback regex parsing below
  }

  const fallbackMatch = normalized.match(
    /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#&]*&)*v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,20})/i
  );
  return fallbackMatch?.[1] || null;
}

export function parseTrailerPlaybackUrl(rawUrl?: string | null): ParsedTrailerPlayback | null {
  if (!rawUrl) return null;
  let trimmed = String(rawUrl).trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('//')) {
    trimmed = `https:${trimmed}`;
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  if (/\.(mp4|webm|ogg|m3u8)(\?|$)/i.test(trimmed)) {
    return {
      kind: 'video',
      src: trimmed,
      watchUrl: trimmed,
      isYouTube: false,
    };
  }

  const ytId = extractYouTubeVideoId(trimmed);
  if (ytId) {
    return {
      kind: 'iframe',
      src: `https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0`,
      watchUrl: `https://www.youtube.com/watch?v=${ytId}`,
      isYouTube: true,
      youtubeId: ytId,
    };
  }

  return {
    kind: 'iframe',
    src: trimmed,
    watchUrl: trimmed,
    isYouTube: false,
  };
}

export function buildTrailerSearchQueryUrl(params: {
  title?: string;
  englishTitle?: string;
  year?: string;
  kind?: MediaKind;
}): string {
  const cleanEn = String(params.englishTitle || '')
    .replace(/\b(20[1-3]\d|19\d\d)\b/g, '')
    .replace(/\b(HD|FHD|UHD|4K|WEB-?DL|BluRay|HDRip|CAM)\b/gi, '')
    .replace(/[()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cleanAr = String(params.title || '')
    .replace(/\b(20[1-3]\d|19\d\d)\b/g, '')
    .replace(/\b(HD|FHD|UHD|4K|WEB-?DL|BluRay|HDRip|CAM)\b/gi, '')
    .replace(/^(فيلم|مسلسل|برنامج|عرض)\s+/i, '')
    .replace(/\s+(مترجم|مدبلج|كامل|اون\s*لاين|أون\s*لاين).*$/i, '')
    .replace(/[()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const useEn = cleanEn.length >= 3 && /[A-Za-z]{3,}/.test(cleanEn);
  const baseQuery = useEn ? cleanEn : cleanAr || cleanEn;
  const suffix = useEn
    ? params.kind === 'series'
      ? 'series official trailer'
      : 'official trailer'
    : 'إعلان رسمي';
  const query = `${baseQuery} ${params.year || ''} ${suffix}`.replace(/\s+/g, ' ').trim();
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}
