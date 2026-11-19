import { resolveApiEndpoint, shouldSkipBackendApiCalls } from './clientScraper';

export interface MasterAdminSession {
  username: string;
  displayName: string;
  role: 'owner';
  mustChangePassword: boolean;
  expiresAt: string;
  source: 'server_master' | 'worker_master' | 'local_offline';
}

interface StoredMasterSessionPayload {
  token: string;
  session: MasterAdminSession;
}

interface OfflineLocalMasterRecord {
  username: string;
  displayName: string;
  saltHex: string;
  hashHex: string;
  updatedAt: string;
}

const STORAGE_MASTER_SESSION = 'rahaltv_master_admin_session_v1';
const STORAGE_OFFLINE_MASTER_RECORD = 'rahaltv_offline_master_admin_v1';

let inMemoryMasterSession: StoredMasterSessionPayload | null = null;
const sessionListeners = new Set<() => void>();

function notifyMasterSessionChanged() {
  sessionListeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // Ignore listener errors
    }
  });
}

export function subscribeMasterAdminSession(cb: () => void): () => void {
  sessionListeners.add(cb);
  return () => {
    sessionListeners.delete(cb);
  };
}

function readStoredSessionPayload(): StoredMasterSessionPayload | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return inMemoryMasterSession;
  }
  try {
    const raw = localStorage.getItem(STORAGE_MASTER_SESSION);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredMasterSessionPayload>;
    if (!parsed?.token || !parsed?.session?.username || !parsed?.session?.expiresAt) {
      return null;
    }
    const expMs = Date.parse(parsed.session.expiresAt);
    if (!Number.isFinite(expMs) || expMs <= Date.now()) {
      localStorage.removeItem(STORAGE_MASTER_SESSION);
      return null;
    }
    return {
      token: String(parsed.token),
      session: {
        username: String(parsed.session.username),
        displayName: String(parsed.session.displayName || 'المسؤول الأساسي'),
        role: 'owner',
        mustChangePassword: Boolean(parsed.session.mustChangePassword),
        expiresAt: String(parsed.session.expiresAt),
        source: parsed.session.source || 'server_master',
      },
    };
  } catch {
    return null;
  }
}

function writeStoredSessionPayload(payload: StoredMasterSessionPayload | null): void {
  inMemoryMasterSession = payload;
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      if (payload) {
        localStorage.setItem(STORAGE_MASTER_SESSION, JSON.stringify(payload));
      } else {
        localStorage.removeItem(STORAGE_MASTER_SESSION);
      }
    } catch {
      // Ignore storage quota errors
    }
  }
  notifyMasterSessionChanged();
}

export function loadStoredMasterAdminSession(): MasterAdminSession | null {
  return readStoredSessionPayload()?.session || null;
}

export function getMasterAdminToken(): string {
  return readStoredSessionPayload()?.token || '';
}

function normalizeIdentifier(raw: string): string {
  const clean = String(raw || '').trim().toLowerCase();
  if (clean === 'admin@rahaltv.com') return 'admin';
  return clean;
}

// Offline WebCrypto PBKDF2 fallback (used ONLY on static GitHub Pages builds without any server/Worker API)
async function pbkdf2Hex(password: string, saltHex: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('المتصفح لا يدعم التشفير المحلي WebCrypto.');
  }
  const enc = new TextEncoder();
  const saltBytes = new Uint8Array(
    (saltHex.match(/.{1,2}/g) || []).map((b) => parseInt(b, 16))
  );
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 120000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hasOfflineLocalMasterAccount(): boolean {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return false;
  try {
    const raw = localStorage.getItem(STORAGE_OFFLINE_MASTER_RECORD);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Partial<OfflineLocalMasterRecord>;
    return Boolean(parsed?.username && parsed?.saltHex && parsed?.hashHex);
  } catch {
    return false;
  }
}

export async function setupOfflineLocalMasterAccount(params: {
  username: string;
  password: string;
  displayName?: string;
}): Promise<{ ok: true; session: MasterAdminSession } | { ok: false; error: string }> {
  const cleanUser = normalizeIdentifier(params.username);
  if (!cleanUser || cleanUser.length < 3 || !/^[a-z0-9._@-]{3,64}$/i.test(cleanUser)) {
    return { ok: false, error: 'اسم المستخدم يجب أن لا يقل عن 3 أحرف إنجليزية.' };
  }
  if (!params.password || params.password.length < 8) {
    return { ok: false, error: 'كلمة المرور يجب أن لا تقل عن 8 أحرف.' };
  }
  try {
    const saltHex = randomHex(16);
    const hashHex = await pbkdf2Hex(params.password, saltHex);
    const displayName =
      String(params.displayName || '').trim().slice(0, 100) ||
      'المسؤول الأساسي (وضع الطوارئ المحلي)';
    const rec: OfflineLocalMasterRecord = {
      username: cleanUser,
      displayName,
      saltHex,
      hashHex,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_OFFLINE_MASTER_RECORD, JSON.stringify(rec));

    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const session: MasterAdminSession = {
      username: cleanUser,
      displayName,
      role: 'owner',
      mustChangePassword: false,
      expiresAt,
      source: 'local_offline',
    };
    writeStoredSessionPayload({
      token: `local:${cleanUser}:${Date.now()}`,
      session,
    });
    return { ok: true, session };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'تعذر إنشاء حساب الطوارئ المحلي.',
    };
  }
}

export async function loginMasterAdmin(
  identifier: string,
  password: string
): Promise<{ ok: true; session: MasterAdminSession } | { ok: false; error: string }> {
  const cleanId = String(identifier || '').trim();
  if (!cleanId || !password) {
    return { ok: false, error: 'يرجى إدخال اسم المستخدم وكلمة المرور.' };
  }

  // Try Server / Cloudflare Worker backend first when configured
  if (!shouldSkipBackendApiCalls()) {
    try {
      const resp = await fetch(resolveApiEndpoint('/api/master-admin/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: cleanId, password }),
      });
      const data = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        token?: string;
        session?: MasterAdminSession;
        error?: string;
      };
      if (resp.ok && data.ok && data.token && data.session) {
        writeStoredSessionPayload({ token: data.token, session: data.session });
        return { ok: true, session: data.session };
      }
      if (resp.status !== 404 && resp.status !== 501) {
        return {
          ok: false,
          error: data.error || `تعذر تسجيل الدخول بالحساب الأساسي (HTTP ${resp.status}).`,
        };
      }
    } catch (err) {
      // Fall through to offline account check only if one exists locally
      if (!hasOfflineLocalMasterAccount()) {
        return {
          ok: false,
          error:
            err instanceof Error
              ? `تعذر الاتصال بخادم التحقق: ${err.message}`
              : 'تعذر الاتصال بخادم التحقق.',
        };
      }
    }
  }

  // Static/offline mode fallback
  try {
    const raw = localStorage.getItem(STORAGE_OFFLINE_MASTER_RECORD);
    if (!raw) {
      return {
        ok: false,
        error:
          'لا يوجد خادم متصل حالياً ولم يتم إعداد حساب الطوارئ المحلي بعد. أنشئ حساب الطوارئ المحلي أولاً.',
      };
    }
    const rec = JSON.parse(raw) as OfflineLocalMasterRecord;
    if (normalizeIdentifier(cleanId) !== rec.username.toLowerCase()) {
      return { ok: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' };
    }
    const candidateHash = await pbkdf2Hex(password, rec.saltHex);
    if (candidateHash !== rec.hashHex) {
      return { ok: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' };
    }
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const session: MasterAdminSession = {
      username: rec.username,
      displayName: rec.displayName,
      role: 'owner',
      mustChangePassword: false,
      expiresAt,
      source: 'local_offline',
    };
    writeStoredSessionPayload({ token: `local:${rec.username}:${Date.now()}`, session });
    return { ok: true, session };
  } catch {
    return { ok: false, error: 'تعذر التحقق من حساب الطوارئ المحلي.' };
  }
}

export async function validateMasterAdminSession(): Promise<MasterAdminSession | null> {
  const stored = readStoredSessionPayload();
  if (!stored) return null;

  if (stored.session.source === 'local_offline' || shouldSkipBackendApiCalls()) {
    return stored.session;
  }

  try {
    const resp = await fetch(resolveApiEndpoint('/api/master-admin/session'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${stored.token}` },
    });
    if (resp.status === 401 || resp.status === 403) {
      writeStoredSessionPayload(null);
      return null;
    }
    if (!resp.ok) {
      return stored.session;
    }
    const data = (await resp.json().catch(() => ({}))) as {
      ok?: boolean;
      session?: MasterAdminSession;
    };
    if (data.ok && data.session) {
      writeStoredSessionPayload({ token: stored.token, session: data.session });
      return data.session;
    }
    return stored.session;
  } catch {
    // Preserve active session during brief offline hiccups until TTL expires
    return stored.session;
  }
}

export async function changeMasterAdminCredentialsClient(params: {
  currentPassword: string;
  newUsername?: string;
  newPassword?: string;
  displayName?: string;
}): Promise<{ ok: true; session: MasterAdminSession } | { ok: false; error: string }> {
  const stored = readStoredSessionPayload();
  if (!stored) {
    return { ok: false, error: 'لا توجد جلسة نشطة للحساب الأساسي.' };
  }

  if (stored.session.source === 'local_offline' || shouldSkipBackendApiCalls()) {
    try {
      const raw = localStorage.getItem(STORAGE_OFFLINE_MASTER_RECORD);
      if (!raw) return { ok: false, error: 'الحساب المحلي غير موجود.' };
      const rec = JSON.parse(raw) as OfflineLocalMasterRecord;
      const curHash = await pbkdf2Hex(params.currentPassword, rec.saltHex);
      if (curHash !== rec.hashHex) {
        return { ok: false, error: 'كلمة المرور الحالية غير صحيحة.' };
      }
      const nextUsername = params.newUsername
        ? normalizeIdentifier(params.newUsername)
        : rec.username;
      if (!nextUsername || nextUsername.length < 3) {
        return { ok: false, error: 'اسم المستخدم غير صالح.' };
      }
      if (params.newPassword && params.newPassword.length < 8) {
        return { ok: false, error: 'كلمة المرور الجديدة يجب أن لا تقل عن 8 أحرف.' };
      }
      const nextSalt = params.newPassword ? randomHex(16) : rec.saltHex;
      const nextHash = params.newPassword
        ? await pbkdf2Hex(params.newPassword, nextSalt)
        : rec.hashHex;
      const nextDisplay = params.displayName?.trim() || rec.displayName;
      localStorage.setItem(
        STORAGE_OFFLINE_MASTER_RECORD,
        JSON.stringify({
          username: nextUsername,
          displayName: nextDisplay,
          saltHex: nextSalt,
          hashHex: nextHash,
          updatedAt: new Date().toISOString(),
        })
      );
      const nextSession: MasterAdminSession = {
        ...stored.session,
        username: nextUsername,
        displayName: nextDisplay,
        mustChangePassword: false,
      };
      writeStoredSessionPayload({ token: stored.token, session: nextSession });
      return { ok: true, session: nextSession };
    } catch {
      return { ok: false, error: 'تعذر تحديث بيانات الحساب المحلي.' };
    }
  }

  try {
    const resp = await fetch(resolveApiEndpoint('/api/master-admin/change-credentials'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${stored.token}`,
      },
      body: JSON.stringify(params),
    });
    const data = (await resp.json().catch(() => ({}))) as {
      ok?: boolean;
      token?: string;
      session?: MasterAdminSession;
      error?: string;
    };
    if (!resp.ok || !data.ok || !data.token || !data.session) {
      return { ok: false, error: data.error || `تعذر تحديث البيانات (HTTP ${resp.status}).` };
    }
    writeStoredSessionPayload({ token: data.token, session: data.session });
    return { ok: true, session: data.session };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'تعذر الاتصال بالخادم لتحديث البيانات.',
    };
  }
}

export async function logoutMasterAdmin(): Promise<void> {
  const token = getMasterAdminToken();
  writeStoredSessionPayload(null);
  if (token && !token.startsWith('local:') && !shouldSkipBackendApiCalls()) {
    void fetch(resolveApiEndpoint('/api/master-admin/logout'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }
}
