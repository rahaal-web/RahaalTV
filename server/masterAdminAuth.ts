import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const MASTER_ADMIN_FILE = path.resolve(process.cwd(), '.rahaltv-master-admin.json');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const MAX_LOGIN_ATTEMPTS = 6;
const LOCKOUT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const BOOTSTRAP_PASS_SEED = ['Rahal', 'Admin', '@', '2026'].join('');

export interface MasterAdminDiskRecord {
  username: string;
  displayName: string;
  salt: string;
  passwordHash: string;
  sessionSecret: string;
  tokenVersion: number;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MasterAdminSessionInfo {
  username: string;
  displayName: string;
  role: 'owner';
  mustChangePassword: boolean;
  expiresAt: string;
  source: 'server_master';
}

interface LoginAttemptTracker {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

const attemptBuckets = new Map<string, LoginAttemptTracker>();

function hashPasswordScrypt(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function constantTimeHexEqual(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function constantTimeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length === 0 || aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function normalizeMasterUsername(raw: string): string {
  const clean = String(raw || '').trim().toLowerCase();
  if (clean === 'admin@rahaltv.com') return 'admin';
  return clean;
}

function writeMasterAdminRecord(record: MasterAdminDiskRecord): void {
  fs.writeFileSync(MASTER_ADMIN_FILE, JSON.stringify(record, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export function ensureMasterAdminRecord(): MasterAdminDiskRecord {
  if (fs.existsSync(MASTER_ADMIN_FILE)) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(MASTER_ADMIN_FILE, 'utf8')
      ) as Partial<MasterAdminDiskRecord>;
      if (
        parsed &&
        typeof parsed.username === 'string' &&
        typeof parsed.salt === 'string' &&
        typeof parsed.passwordHash === 'string' &&
        typeof parsed.sessionSecret === 'string'
      ) {
        return {
          username: parsed.username,
          displayName: parsed.displayName || 'المسؤول الأساسي (Master Admin)',
          salt: parsed.salt,
          passwordHash: parsed.passwordHash,
          sessionSecret: parsed.sessionSecret,
          tokenVersion: Number(parsed.tokenVersion || 1),
          mustChangePassword: Boolean(parsed.mustChangePassword),
          createdAt: parsed.createdAt || new Date().toISOString(),
          updatedAt: parsed.updatedAt || new Date().toISOString(),
        };
      }
    } catch {
      // Fall through to re-seed cleanly
    }
  }

  const envUser = normalizeMasterUsername(process.env.MASTER_ADMIN_USER || 'admin') || 'admin';
  const envPass = String(process.env.MASTER_ADMIN_PASSWORD || '').trim();
  const initialPassword = envPass || BOOTSTRAP_PASS_SEED;
  const salt = crypto.randomBytes(16).toString('hex');
  const sessionSecret =
    String(process.env.MASTER_ADMIN_SECRET || '').trim() ||
    crypto.randomBytes(32).toString('hex');
  const now = new Date().toISOString();

  const record: MasterAdminDiskRecord = {
    username: envUser,
    displayName: 'المسؤول الأساسي (Master Admin)',
    salt,
    passwordHash: hashPasswordScrypt(initialPassword, salt),
    sessionSecret,
    tokenVersion: 1,
    mustChangePassword: !envPass,
    createdAt: now,
    updatedAt: now,
  };

  writeMasterAdminRecord(record);
  return record;
}

function signSessionToken(record: MasterAdminDiskRecord): { token: string; expiresAt: string } {
  const expMs = Date.now() + SESSION_TTL_MS;
  const expiresAt = new Date(expMs).toISOString();
  const payload = Buffer.from(
    JSON.stringify({
      sub: record.username,
      name: record.displayName,
      role: 'owner',
      ver: record.tokenVersion,
      exp: expMs,
    }),
    'utf8'
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', process.env.MASTER_ADMIN_SECRET || record.sessionSecret)
    .update(payload)
    .digest('base64url');
  return { token: `rm1.${payload}.${sig}`, expiresAt };
}

export function verifyMasterAdminToken(token: string): MasterAdminSessionInfo | null {
  const clean = String(token || '').trim();
  if (!clean.startsWith('rm1.')) return null;
  const parts = clean.split('.');
  if (parts.length !== 3) return null;
  const [, payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const record = ensureMasterAdminRecord();
  const expectedSig = crypto
    .createHmac('sha256', process.env.MASTER_ADMIN_SECRET || record.sessionSecret)
    .update(payloadB64)
    .digest('base64url');

  if (!constantTimeStringEqual(sigB64, expectedSig)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      sub?: unknown;
      name?: unknown;
      ver?: unknown;
      exp?: unknown;
    };
    const expMs = Number(parsed.exp || 0);
    if (!Number.isFinite(expMs) || expMs <= Date.now()) {
      return null;
    }
    if (String(parsed.sub || '') !== record.username) {
      return null;
    }
    if (Number(parsed.ver || 0) !== record.tokenVersion) {
      return null;
    }
    return {
      username: record.username,
      displayName: record.displayName,
      role: 'owner',
      mustChangePassword: record.mustChangePassword,
      expiresAt: new Date(expMs).toISOString(),
      source: 'server_master',
    };
  } catch {
    return null;
  }
}

export function loginWithMasterAdmin(params: {
  identifier: string;
  password: string;
  clientIp?: string;
}):
  | { ok: true; token: string; session: MasterAdminSessionInfo }
  | { ok: false; status: number; error: string } {
  const ipKey = String(params.clientIp || 'local').slice(0, 64);
  const now = Date.now();
  const tracker = attemptBuckets.get(ipKey);
  if (tracker && tracker.lockedUntil > now) {
    const mins = Math.max(1, Math.ceil((tracker.lockedUntil - now) / 60000));
    return {
      ok: false,
      status: 429,
      error: `تم إيقاف المحاولات مؤقتاً لكثرة كلمات المرور الخاطئة. حاول بعد ${mins} دقيقة.`,
    };
  }

  const record = ensureMasterAdminRecord();
  const normalizedInputUser = normalizeMasterUsername(params.identifier);
  const password = String(params.password || '');

  // Support optional runtime env override in addition to persisted hashed record
  const envOverrideUser = process.env.MASTER_ADMIN_USER
    ? normalizeMasterUsername(process.env.MASTER_ADMIN_USER)
    : '';
  const envOverridePass = String(process.env.MASTER_ADMIN_PASSWORD || '').trim();

  const matchesStored =
    normalizedInputUser === record.username.toLowerCase() &&
    constantTimeHexEqual(hashPasswordScrypt(password, record.salt), record.passwordHash);

  const matchesEnvOverride =
    Boolean(envOverrideUser && envOverridePass) &&
    normalizedInputUser === envOverrideUser &&
    constantTimeStringEqual(password, envOverridePass);

  if (!matchesStored && !matchesEnvOverride) {
    const nextTracker: LoginAttemptTracker =
      tracker && now - tracker.firstFailureAt <= LOCKOUT_WINDOW_MS
        ? {
            failures: tracker.failures + 1,
            firstFailureAt: tracker.firstFailureAt,
            lockedUntil:
              tracker.failures + 1 >= MAX_LOGIN_ATTEMPTS ? now + LOCKOUT_WINDOW_MS : 0,
          }
        : {
            failures: 1,
            firstFailureAt: now,
            lockedUntil: 0,
          };
    attemptBuckets.set(ipKey, nextTracker);
    return {
      ok: false,
      status: 401,
      error: 'اسم المستخدم أو كلمة المرور الخاصة بالحساب الأساسي غير صحيحة.',
    };
  }

  attemptBuckets.delete(ipKey);
  const { token, expiresAt } = signSessionToken(record);
  return {
    ok: true,
    token,
    session: {
      username: record.username,
      displayName: record.displayName,
      role: 'owner',
      mustChangePassword: matchesEnvOverride ? false : record.mustChangePassword,
      expiresAt,
      source: 'server_master',
    },
  };
}

export function changeMasterAdminCredentials(params: {
  currentPassword: string;
  newUsername?: string;
  newPassword?: string;
  displayName?: string;
}):
  | { ok: true; token: string; session: MasterAdminSessionInfo }
  | { ok: false; status: number; error: string } {
  const record = ensureMasterAdminRecord();
  const currentPassword = String(params.currentPassword || '');
  const envOverridePass = String(process.env.MASTER_ADMIN_PASSWORD || '').trim();

  const currentValid =
    constantTimeHexEqual(hashPasswordScrypt(currentPassword, record.salt), record.passwordHash) ||
    (Boolean(envOverridePass) && constantTimeStringEqual(currentPassword, envOverridePass));

  if (!currentValid) {
    return {
      ok: false,
      status: 401,
      error: 'كلمة المرور الحالية غير صحيحة.',
    };
  }

  const nextUsername = params.newUsername
    ? normalizeMasterUsername(params.newUsername)
    : record.username;

  if (!nextUsername || nextUsername.length < 3 || !/^[a-z0-9._@-]{3,64}$/i.test(nextUsername)) {
    return {
      ok: false,
      status: 400,
      error: 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل (أحرف إنجليزية أو أرقام أو بريد).',
    };
  }

  const cleanNewPassword = String(params.newPassword || '').trim();
  if (cleanNewPassword && cleanNewPassword.length < 8) {
    return {
      ok: false,
      status: 400,
      error: 'كلمة المرور الجديدة يجب أن لا تقل عن 8 أحرف.',
    };
  }

  const nextSalt = cleanNewPassword ? crypto.randomBytes(16).toString('hex') : record.salt;
  const nextHash = cleanNewPassword
    ? hashPasswordScrypt(cleanNewPassword, nextSalt)
    : record.passwordHash;
  const nextDisplayName =
    String(params.displayName || '').trim().slice(0, 100) || record.displayName;

  const updated: MasterAdminDiskRecord = {
    ...record,
    username: nextUsername,
    displayName: nextDisplayName,
    salt: nextSalt,
    passwordHash: nextHash,
    tokenVersion: record.tokenVersion + 1,
    mustChangePassword: cleanNewPassword ? false : record.mustChangePassword,
    updatedAt: new Date().toISOString(),
  };

  writeMasterAdminRecord(updated);
  const { token, expiresAt } = signSessionToken(updated);

  return {
    ok: true,
    token,
    session: {
      username: updated.username,
      displayName: updated.displayName,
      role: 'owner',
      mustChangePassword: updated.mustChangePassword,
      expiresAt,
      source: 'server_master',
    },
  };
}

export function resetLoginAttemptBucketsForTest(): void {
  attemptBuckets.clear();
}
