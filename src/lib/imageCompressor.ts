import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { getActiveFirebaseApp } from './dbConnectionManager';

export type UploadImageSlot =
  | 'poster'
  | 'backdrop'
  | 'cast'
  | 'placeholder'
  | 'fallback'
  | 'logo'
  | 'favicon';

export interface UploadSlotSpec {
  maxWidth: number;
  maxHeight: number;
  quality: number;
  maxBytes: number;
}

export const UPLOAD_SLOT_SPECS: Record<UploadImageSlot, UploadSlotSpec> = {
  poster: { maxWidth: 1000, maxHeight: 1500, quality: 0.84, maxBytes: 900 * 1024 },
  backdrop: { maxWidth: 1920, maxHeight: 1080, quality: 0.84, maxBytes: 1400 * 1024 },
  cast: { maxWidth: 360, maxHeight: 540, quality: 0.82, maxBytes: 450 * 1024 },
  placeholder: { maxWidth: 400, maxHeight: 600, quality: 0.82, maxBytes: 450 * 1024 },
  fallback: { maxWidth: 600, maxHeight: 900, quality: 0.84, maxBytes: 550 * 1024 },
  logo: { maxWidth: 640, maxHeight: 240, quality: 0.88, maxBytes: 500 * 1024 },
  favicon: { maxWidth: 64, maxHeight: 64, quality: 0.9, maxBytes: 120 * 1024 },
};

export interface CompressedUploadResult {
  blob: Blob;
  dataUrl: string;
  mimeType: string;
  extension: string;
  beforeBytes: number;
  afterBytes: number;
  savedPct: number;
  skippedBecauseLarger: boolean;
  width: number;
  height: number;
}

export interface CanvasEncodeCapabilities {
  avif: boolean;
  webp: boolean;
}

let cachedCapabilities: CanvasEncodeCapabilities | null = null;

export function detectCanvasEncodeSupport(): CanvasEncodeCapabilities {
  if (cachedCapabilities) return cachedCapabilities;
  if (typeof document === 'undefined') {
    cachedCapabilities = { avif: false, webp: false };
    return cachedCapabilities;
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const webp = canvas.toDataURL('image/webp').startsWith('data:image/webp');
    const avif = canvas.toDataURL('image/avif').startsWith('data:image/avif');
    cachedCapabilities = { avif, webp };
    return cachedCapabilities;
  } catch {
    cachedCapabilities = { avif: false, webp: false };
    return cachedCapabilities;
  }
}

export function sanitizeSvgContent(svgText: string): string {
  const cleaned = svgText
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?>[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '');
  if (!/<svg[\s>]/i.test(cleaned)) {
    throw new Error('ملف SVG غير صالح أو يحتوي على بنية غير مدعومة.');
  }
  return cleaned;
}

export function computeScaledDimensions(
  srcWidth: number,
  srcHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number; scaledDown: boolean } {
  if (srcWidth <= 0 || srcHeight <= 0) {
    return { width: maxWidth, height: maxHeight, scaledDown: false };
  }
  const ratio = Math.min(maxWidth / srcWidth, maxHeight / srcHeight, 1);
  return {
    width: Math.max(1, Math.round(srcWidth * ratio)),
    height: Math.max(1, Math.round(srcHeight * ratio)),
    scaledDown: ratio < 0.995,
  };
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('تعذر قراءة بيانات الصورة.'));
    reader.readAsDataURL(blob);
  });
}

function loadFileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('تعذر فك ترميز الصورة المختارة.'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), mimeType, quality);
    } catch {
      resolve(null);
    }
  });
}

function mimeToExt(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes('avif')) return 'avif';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('png')) return 'png';
  if (lower.includes('svg')) return 'svg';
  if (lower.includes('icon')) return 'ico';
  return 'jpg';
}

/**
 * Compresses & optimizes an uploaded image on the client using HTML5 Canvas:
 * - Sanitizes SVGs and passes ICOs through safely
 * - Scales down oversized dimensions per slot cap
 * - Strips EXIF metadata via Canvas redraw
 * - Encodes to AVIF or WebP when supported and smaller than original
 * - Preserves transparency for PNG/WebP/AVIF
 * - Automatically keeps original if compressed size >= original bytes (and dimensions fit cap)
 */
export async function compressImageForUpload(
  file: File,
  slot: UploadImageSlot = 'poster'
): Promise<CompressedUploadResult> {
  const beforeBytes = file.size || 0;
  const spec = UPLOAD_SLOT_SPECS[slot] || UPLOAD_SLOT_SPECS.poster;
  const lowerName = (file.name || '').toLowerCase();
  const isSvg = file.type === 'image/svg+xml' || lowerName.endsWith('.svg');
  const isIco =
    file.type === 'image/x-icon' ||
    file.type === 'image/vnd.microsoft.icon' ||
    lowerName.endsWith('.ico');

  if (beforeBytes > 8 * 1024 * 1024) {
    throw new Error('حجم الصورة يتجاوز الحد المسموح قبل الضغط (8 ميغابايت).');
  }

  if (isSvg) {
    const rawSvg = await file.text();
    const cleanSvg = sanitizeSvgContent(rawSvg);
    const svgBlob = new Blob([cleanSvg], { type: 'image/svg+xml' });
    const dataUrl = await readBlobAsDataUrl(svgBlob);
    const afterBytes = svgBlob.size;
    const savedPct =
      beforeBytes > 0 ? Math.max(0, Math.round(((beforeBytes - afterBytes) / beforeBytes) * 100)) : 0;
    return {
      blob: svgBlob,
      dataUrl,
      mimeType: 'image/svg+xml',
      extension: 'svg',
      beforeBytes,
      afterBytes,
      savedPct,
      skippedBecauseLarger: false,
      width: spec.maxWidth,
      height: spec.maxHeight,
    };
  }

  if (isIco) {
    const dataUrl = await readBlobAsDataUrl(file);
    return {
      blob: file,
      dataUrl,
      mimeType: 'image/x-icon',
      extension: 'ico',
      beforeBytes,
      afterBytes: beforeBytes,
      savedPct: 0,
      skippedBecauseLarger: true,
      width: 64,
      height: 64,
    };
  }

  const img = await loadFileToImage(file);
  const srcW = img.naturalWidth || img.width || spec.maxWidth;
  const srcH = img.naturalHeight || img.height || spec.maxHeight;
  const { width, height, scaledDown } = computeScaledDimensions(srcW, srcH, spec.maxWidth, spec.maxHeight);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const dataUrl = await readBlobAsDataUrl(file);
    return {
      blob: file,
      dataUrl,
      mimeType: file.type || 'image/jpeg',
      extension: mimeToExt(file.type || 'image/jpeg'),
      beforeBytes,
      afterBytes: beforeBytes,
      savedPct: 0,
      skippedBecauseLarger: true,
      width: srcW,
      height: srcH,
    };
  }

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const caps = detectCanvasEncodeSupport();
  const candidates: Array<{ mime: string; quality: number }> = [];

  if (slot === 'favicon') {
    candidates.push({ mime: 'image/png', quality: spec.quality });
  } else {
    if (caps.avif && slot !== 'logo') {
      candidates.push({ mime: 'image/avif', quality: spec.quality });
    }
    if (caps.webp) {
      candidates.push({ mime: 'image/webp', quality: spec.quality });
    }
    if (file.type === 'image/png') {
      candidates.push({ mime: 'image/png', quality: spec.quality });
    } else {
      candidates.push({ mime: 'image/jpeg', quality: spec.quality });
    }
  }

  let bestBlob: Blob | null = null;
  for (const cand of candidates) {
    const encoded = await canvasToBlob(canvas, cand.mime, cand.quality);
    if (!encoded || encoded.size === 0) continue;
    if (!bestBlob || encoded.size < bestBlob.size) {
      bestBlob = encoded;
    }
  }

  const keepOriginal =
    !bestBlob || (!scaledDown && beforeBytes > 0 && bestBlob.size >= beforeBytes);

  const finalBlob = keepOriginal ? file : bestBlob!;
  const finalMime = keepOriginal ? file.type || 'image/jpeg' : bestBlob!.type || 'image/webp';
  const finalExt = mimeToExt(finalMime);
  const afterBytes = finalBlob.size;
  const savedPct =
    beforeBytes > 0 && afterBytes < beforeBytes
      ? Math.round(((beforeBytes - afterBytes) / beforeBytes) * 100)
      : 0;

  if (afterBytes > spec.maxBytes && slot !== 'backdrop') {
    // Attempt one extra quality step down if still exceeding slot budget
    const fallbackQ = Math.max(0.68, spec.quality - 0.14);
    const targetMime = caps.webp ? 'image/webp' : 'image/jpeg';
    const tighter = await canvasToBlob(canvas, targetMime, fallbackQ);
    if (tighter && tighter.size < afterBytes) {
      const tighterUrl = await readBlobAsDataUrl(tighter);
      return {
        blob: tighter,
        dataUrl: tighterUrl,
        mimeType: tighter.type || targetMime,
        extension: mimeToExt(tighter.type || targetMime),
        beforeBytes,
        afterBytes: tighter.size,
        savedPct:
          beforeBytes > 0 ? Math.max(0, Math.round(((beforeBytes - tighter.size) / beforeBytes) * 100)) : 0,
        skippedBecauseLarger: false,
        width,
        height,
      };
    }
  }

  const dataUrl = await readBlobAsDataUrl(finalBlob);
  return {
    blob: finalBlob,
    dataUrl,
    mimeType: finalMime,
    extension: finalExt,
    beforeBytes,
    afterBytes,
    savedPct,
    skippedBecauseLarger: keepOriginal,
    width: keepOriginal ? srcW : width,
    height: keepOriginal ? srcH : height,
  };
}

export function formatBytesReadable(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const LOCAL_UPLOADED_IMAGES_KEY = 'rahaltv_local_uploaded_images_v1';

export function resolveUploadedImageAssetUrl(rawUrl?: string | null): string {
  const clean = String(rawUrl || '').trim();
  if (!clean) return '';
  if (clean.startsWith('local-image://')) {
    const key = clean.slice('local-image://'.length);
    if (typeof window === 'undefined') return '';
    try {
      const rawMap = window.localStorage.getItem(LOCAL_UPLOADED_IMAGES_KEY);
      if (!rawMap) return '';
      const parsed = JSON.parse(rawMap) as Record<string, string>;
      return parsed[key] || '';
    } catch {
      return '';
    }
  }
  return clean;
}

function saveLocalImageFallback(slot: UploadImageSlot, dataUrl: string): string {
  if (typeof window === 'undefined') return '';
  try {
    const rawMap = window.localStorage.getItem(LOCAL_UPLOADED_IMAGES_KEY);
    const parsed = rawMap ? (JSON.parse(rawMap) as Record<string, string>) : {};
    const key = `img_${slot}`;
    parsed[key] = dataUrl;
    window.localStorage.setItem(LOCAL_UPLOADED_IMAGES_KEY, JSON.stringify(parsed));
    return `local-image://${key}`;
  } catch {
    return '';
  }
}

export interface UploadedImageAssetResult {
  url: string;
  resolvedPreviewUrl: string;
  compression: CompressedUploadResult;
  storageProvider: 'backend' | 'firebase_storage' | 'local';
}

/**
 * Optimizes an image client-side then uploads it persistently via backend `/api/images/upload`
 * (or Firebase Storage fallback, or bounded local cache offline).
 */
export async function uploadOptimizedImageAsset(params: {
  file: File;
  slot: UploadImageSlot;
  idToken?: string;
}): Promise<UploadedImageAssetResult> {
  const compression = await compressImageForUpload(params.file, params.slot);

  if (params.idToken) {
    try {
      const res = await fetch('/api/images/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.idToken}`,
        },
        body: JSON.stringify({
          slot: params.slot,
          dataUrl: compression.dataUrl,
          extension: compression.extension,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { ok?: boolean; url?: string };
        if (data.ok && data.url) {
          return {
            url: data.url,
            resolvedPreviewUrl: data.url,
            compression,
            storageProvider: 'backend',
          };
        }
      }
    } catch {
      // Fall through to Firebase Storage or local fallback
    }
  }

  try {
    const app = getActiveFirebaseApp();
    if (app.options.storageBucket) {
      const storage = getStorage(app);
      const storageRef = ref(
        storage,
        `images/${params.slot}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${compression.extension}`
      );
      await uploadBytes(storageRef, compression.blob, {
        contentType: compression.mimeType,
        cacheControl: 'public, max-age=31536000',
      });
      const url = await getDownloadURL(storageRef);
      return {
        url,
        resolvedPreviewUrl: url,
        compression,
        storageProvider: 'firebase_storage',
      };
    }
  } catch {
    // Fall through to local cache
  }

  const localRef = saveLocalImageFallback(params.slot, compression.dataUrl);
  if (!localRef) {
    throw new Error('تعذر حفظ الصورة المضغوطة. جرّب صورة أصغر حجماً أو استخدم رابطاً مباشراً.');
  }
  return {
    url: localRef,
    resolvedPreviewUrl: compression.dataUrl,
    compression,
    storageProvider: 'local',
  };
}
