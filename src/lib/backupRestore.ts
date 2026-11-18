// Full-Site Backup Export, Schema Validation, Checksum Verification, and Diff Preview.

import { MediaItem, SiteSettings, VisitorRequest } from '../types/media';
import type { ScraperAdapter } from '../types/scraperAdapter';
import { DisplayDevicePrefs, loadDisplayDevicePrefs } from './browserCompat';

export interface SiteBackupPayload {
  schemaVersion: 2;
  exportedAt: string;
  appName: string;
  checksum: string;
  counts: {
    media: number;
    adapters: number;
    requests: number;
  };
  data: {
    settings: SiteSettings;
    media: MediaItem[];
    adapters?: ScraperAdapter[];
    requests?: VisitorRequest[];
    displayPrefs?: DisplayDevicePrefs;
  };
}

export interface BackupValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  payload: SiteBackupPayload | null;
  diff: {
    incomingMediaCount: number;
    existingMediaCount: number;
    newItemsCount: number;
    updatedItemsCount: number;
    hasSettings: boolean;
    adaptersCount: number;
  } | null;
}

/**
 * Deterministic FNV-1a 32-bit checksum encoded in hex so backup integrity can be verified
 * safely across all browsers (even offline / non-HTTPS where crypto.subtle may be absent).
 */
export function computeBackupChecksum(data: SiteBackupPayload['data']): string {
  const canonical = JSON.stringify(data);
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function createSiteBackupPayload(input: {
  settings: SiteSettings;
  media: MediaItem[];
  adapters?: ScraperAdapter[];
  requests?: VisitorRequest[];
}): SiteBackupPayload {
  const data: SiteBackupPayload['data'] = {
    settings: input.settings,
    media: input.media,
    adapters: input.adapters || [],
    requests: input.requests || [],
    displayPrefs: loadDisplayDevicePrefs(),
  };

  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    appName: input.settings.siteName || 'RahaL TV',
    checksum: computeBackupChecksum(data),
    counts: {
      media: input.media.length,
      adapters: (input.adapters || []).length,
      requests: (input.requests || []).length,
    },
    data,
  };
}

export function validateBackupJson(
  rawText: string,
  currentMedia: MediaItem[]
): BackupValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      valid: false,
      errors: ['ملف JSON غير صالح أو تالف ولا يمكن قراءته.'],
      warnings: [],
      payload: null,
      diff: null,
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      valid: false,
      errors: ['بنية الملف غير صحيحة (يجب أن يكون كائن JSON).'],
      warnings: [],
      payload: null,
      diff: null,
    };
  }

  const obj = parsed as Partial<SiteBackupPayload>;

  // Support both schemaVersion 2 envelope and legacy v1 plain `{ settings, media }`
  let normalizedPayload: SiteBackupPayload;
  if (obj.schemaVersion === 2 && obj.data && typeof obj.data === 'object') {
    normalizedPayload = obj as SiteBackupPayload;
    if (obj.checksum) {
      const expected = computeBackupChecksum(obj.data);
      if (obj.checksum !== expected) {
        warnings.push('تحذير: البصمة الرقمية (Checksum) لا تطابق المحتوى — قد يكون الملف معدّلاً يدوياً.');
      }
    }
  } else if ('media' in obj && Array.isArray((obj as { media?: unknown }).media)) {
    const legacy = obj as unknown as {
      settings?: SiteSettings;
      media: MediaItem[];
      adapters?: ScraperAdapter[];
      requests?: VisitorRequest[];
    };
    const data: SiteBackupPayload['data'] = {
      settings: legacy.settings || ({} as SiteSettings),
      media: legacy.media,
      adapters: legacy.adapters || [],
      requests: legacy.requests || [],
    };
    normalizedPayload = {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      appName: legacy.settings?.siteName || 'RahaL TV',
      checksum: computeBackupChecksum(data),
      counts: {
        media: data.media.length,
        adapters: data.adapters?.length || 0,
        requests: data.requests?.length || 0,
      },
      data,
    };
    warnings.push('تم التعرف على نسخة احتياطية بصيغة قديمة (v1) وسيتم تحويلها تلقائياً.');
  } else {
    return {
      valid: false,
      errors: ['الملف لا يحتوي على حقل data.media أو بنية نسخة RahaL TV المعتمدة.'],
      warnings: [],
      payload: null,
      diff: null,
    };
  }

  if (!Array.isArray(normalizedPayload.data.media)) {
    errors.push('قائمة الأعمال (media) غير صالحة أو مفقودة.');
  } else {
    const invalidItems = normalizedPayload.data.media.filter(
      (m) => !m || typeof m.id !== 'string' || typeof m.title !== 'string' || !m.kind
    );
    if (invalidItems.length > 0) {
      errors.push(`تم العثور على ${invalidItems.length} عنصر(عناصر) تفتقد المعرّف أو العنوان أو النوع.`);
    }
  }

  const hasSettings = Boolean(
    normalizedPayload.data.settings &&
      typeof normalizedPayload.data.settings === 'object' &&
      typeof normalizedPayload.data.settings.siteName === 'string'
  );
  if (!hasSettings) {
    warnings.push('إعدادات الموقع العامة غير مكتملة في هذه النسخة — سيتم الإبقاء على الإعدادات الحالية عند عدم توفرها.');
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      warnings,
      payload: null,
      diff: null,
    };
  }

  const existingIds = new Set(currentMedia.map((m) => m.id));
  let newItemsCount = 0;
  let updatedItemsCount = 0;
  for (const item of normalizedPayload.data.media) {
    if (existingIds.has(item.id)) updatedItemsCount += 1;
    else newItemsCount += 1;
  }

  return {
    valid: true,
    errors: [],
    warnings,
    payload: normalizedPayload,
    diff: {
      incomingMediaCount: normalizedPayload.data.media.length,
      existingMediaCount: currentMedia.length,
      newItemsCount,
      updatedItemsCount,
      hasSettings,
      adaptersCount: normalizedPayload.data.adapters?.length || 0,
    },
  };
}
