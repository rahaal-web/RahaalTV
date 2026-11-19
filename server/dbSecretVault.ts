import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Request, Response, NextFunction } from 'express';
import type { DatabaseServerSecretStatus } from '../src/types/database';
import { verifyMasterAdminToken } from './masterAdminAuth.ts';

const VAULT_FILE = path.resolve(process.cwd(), '.rahaltv-secrets.json');
const CONFIG_FILE = path.resolve(process.cwd(), 'firebase-applet-config.json');

const PRIMARY_ADMIN_EMAILS = new Set([
  'rahalahmed348@gmail.com',
  'mfeshmeny2@gmail.com',
  'ccicada6@gmail.com',
  'bebraheem439@gmail.com',
]);

interface StoredSecretRecord {
  connectionId: string;
  encryptedBlob: string; // iv:tag:ciphertext base64
  serviceAccountClientEmail?: string;
  hasServiceAccount: boolean;
  hasPrivateKey: boolean;
  hasApiSecret: boolean;
  hasCloudflareToken: boolean;
  updatedAt: string;
  updatedBy: string;
}

interface PlainSecretPayload {
  serviceAccountJson?: string;
  privateKey?: string;
  apiSecret?: string;
  cloudflareToken?: string;
}

function getDefaultWebApiKey(): string {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as {
        apiKey?: string;
        projectId?: string;
      };
      return String(parsed.apiKey || '').trim();
    }
  } catch {
    // Ignore
  }
  return '';
}

function deriveVaultKey(): Buffer {
  const seed =
    process.env.DB_VAULT_KEY ||
    process.env.SESSION_SECRET ||
    `rahaltv-vault-${process.cwd()}-${getDefaultWebApiKey()}`;
  return crypto.scryptSync(seed, 'rahaltv-db-secret-salt-v1', 32);
}

function encryptSecretPayload(payload: PlainSecretPayload): string {
  const key = deriveVaultKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const json = JSON.stringify(payload);
  const enc = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function readVaultRecords(): Record<string, StoredSecretRecord> {
  try {
    if (!fs.existsSync(VAULT_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8')) as Record<
      string,
      StoredSecretRecord
    >;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeVaultRecords(records: Record<string, StoredSecretRecord>): void {
  fs.writeFileSync(VAULT_FILE, JSON.stringify(records, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export function getMaskedSecretStatuses(): Record<string, DatabaseServerSecretStatus> {
  const records = readVaultRecords();
  const out: Record<string, DatabaseServerSecretStatus> = {};
  for (const [id, rec] of Object.entries(records)) {
    out[id] = {
      connectionId: id,
      hasServiceAccount: Boolean(rec.hasServiceAccount),
      serviceAccountClientEmail: rec.serviceAccountClientEmail,
      hasPrivateKey: Boolean(rec.hasPrivateKey),
      hasApiSecret: Boolean(rec.hasApiSecret),
      hasCloudflareToken: Boolean(rec.hasCloudflareToken),
      updatedAt: rec.updatedAt,
      updatedBy: rec.updatedBy,
      vaultSource: 'node_vault',
    };
  }
  return out;
}

export function upsertSecretRecord(params: {
  connectionId: string;
  serviceAccountJson?: string;
  privateKey?: string;
  apiSecret?: string;
  cloudflareToken?: string;
  updatedBy: string;
}): DatabaseServerSecretStatus {
  const cleanId = params.connectionId.replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 96);
  if (!cleanId) {
    throw new Error('معرّف الاتصال غير صالح.');
  }

  let serviceAccountClientEmail: string | undefined;
  const cleanSa = typeof params.serviceAccountJson === 'string' ? params.serviceAccountJson.trim() : '';
  if (cleanSa) {
    let parsedSa: { client_email?: unknown; private_key?: unknown; project_id?: unknown };
    try {
      parsedSa = JSON.parse(cleanSa) as {
        client_email?: unknown;
        private_key?: unknown;
        project_id?: unknown;
      };
    } catch {
      throw new Error('ملف Service Account JSON غير صالح (صيغة JSON غير صحيحة).');
    }
    if (!parsedSa.client_email || !parsedSa.private_key) {
      throw new Error('ملف Service Account JSON يجب أن يحتوي على client_email و private_key.');
    }
    serviceAccountClientEmail = String(parsedSa.client_email).slice(0, 180);
  }

  const records = readVaultRecords();
  const prev = records[cleanId];
  const payload: PlainSecretPayload = {
    ...(cleanSa ? { serviceAccountJson: cleanSa } : {}),
    ...(params.privateKey?.trim() ? { privateKey: params.privateKey.trim() } : {}),
    ...(params.apiSecret?.trim() ? { apiSecret: params.apiSecret.trim() } : {}),
    ...(params.cloudflareToken?.trim()
      ? { cloudflareToken: params.cloudflareToken.trim() }
      : {}),
  };

  if (
    !payload.serviceAccountJson &&
    !payload.privateKey &&
    !payload.apiSecret &&
    !payload.cloudflareToken
  ) {
    throw new Error('لم يتم إرسال أي مفتاح سري للحفظ.');
  }

  const updatedAt = new Date().toISOString();
  const nextRec: StoredSecretRecord = {
    connectionId: cleanId,
    encryptedBlob: encryptSecretPayload(payload),
    serviceAccountClientEmail:
      serviceAccountClientEmail || prev?.serviceAccountClientEmail,
    hasServiceAccount: Boolean(payload.serviceAccountJson || prev?.hasServiceAccount),
    hasPrivateKey: Boolean(payload.privateKey || prev?.hasPrivateKey),
    hasApiSecret: Boolean(payload.apiSecret || prev?.hasApiSecret),
    hasCloudflareToken: Boolean(payload.cloudflareToken || prev?.hasCloudflareToken),
    updatedAt,
    updatedBy: params.updatedBy,
  };

  records[cleanId] = nextRec;
  writeVaultRecords(records);

  return {
    connectionId: cleanId,
    hasServiceAccount: nextRec.hasServiceAccount,
    serviceAccountClientEmail: nextRec.serviceAccountClientEmail,
    hasPrivateKey: nextRec.hasPrivateKey,
    hasApiSecret: nextRec.hasApiSecret,
    hasCloudflareToken: nextRec.hasCloudflareToken,
    updatedAt: nextRec.updatedAt,
    updatedBy: nextRec.updatedBy,
    vaultSource: 'node_vault',
  };
}

export function deleteSecretRecord(connectionId: string): boolean {
  const cleanId = connectionId.replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 96);
  const records = readVaultRecords();
  if (!records[cleanId]) return false;
  delete records[cleanId];
  writeVaultRecords(records);
  return true;
}

export interface VerifiedAdminContext {
  uid: string;
  email: string;
}

export async function verifyOwnerAdminMiddleware(
  req: Request & { adminAuth?: VerifiedAdminContext },
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) {
      return res.status(401).json({
        ok: false,
        error: 'مطلوب مصادقة المسؤول (Missing Authorization Bearer Token).',
      });
    }
    const idToken = match[1].trim();
    const masterSession = verifyMasterAdminToken(idToken);
    if (masterSession) {
      req.adminAuth = {
        uid: `master:${masterSession.username}`,
        email: masterSession.username,
      };
      return next();
    }

    const apiKey = getDefaultWebApiKey();
    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: 'تعذر قراءة apiKey من إعدادات Firebase للتحقق من الجلسة.',
      });
    }

    const lookupResp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );

    if (!lookupResp.ok) {
      return res.status(401).json({
        ok: false,
        error: 'رمز جلسة Firebase غير صالح أو منتهي الصلاحية.',
      });
    }

    const data = (await lookupResp.json()) as {
      users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
    };
    const user = data.users?.[0];
    const email = String(user?.email || '').toLowerCase();
    if (!user?.localId || !email) {
      return res.status(401).json({ ok: false, error: 'تعذر التحقق من هوية المستخدم.' });
    }
    if (!user.emailVerified || !PRIMARY_ADMIN_EMAILS.has(email)) {
      return res.status(403).json({
        ok: false,
        error: 'هذا القسم مقتصر على المسؤول المالك (Owner) فقط.',
      });
    }

    req.adminAuth = { uid: user.localId, email };
    return next();
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'فشل التحقق الأمني من الجلسة.',
    });
  }
}
