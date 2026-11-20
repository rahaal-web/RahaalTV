import {
  deleteUserSubProfileFromFirestore,
  saveUserSubProfileToFirestore,
} from './firebase';
import type { AgeRatingTier, MediaItem, UserSubProfile } from '../types/media';

const PROFILES_STORAGE_KEY = 'rahaltv_profiles_v1';
const ACTIVE_PROFILE_STORAGE_KEY = 'rahaltv_active_profile_id_v1';

export const PROFILE_AVATAR_PRESETS = [
  { emoji: '🎬', color: '#dc2626', label: 'سينمائي' },
  { emoji: '🍿', color: '#ea580c', label: 'كلاسيكي' },
  { emoji: '🦁', color: '#d97706', label: 'أكشن' },
  { emoji: '🚀', color: '#2563eb', label: 'خيال علمي' },
  { emoji: '🧸', color: '#16a34a', label: 'أطفال' },
  { emoji: '🌟', color: '#9333ea', label: 'مميز' },
] as const;

export function createDefaultMainProfile(userId = 'guest', name = 'الملف الرئيسي'): UserSubProfile {
  const now = Date.now();
  return {
    id: 'main',
    userId,
    name,
    avatarEmoji: '🎬',
    avatarColor: '#dc2626',
    isKids: false,
    maxAgeRating: 'all',
    hasPin: false,
    watchlistIds: [],
    createdAtMs: now,
    updatedAtMs: now,
  };
}

export function loadLocalSubProfiles(userId = 'guest'): UserSubProfile[] {
  if (typeof window === 'undefined') return [createDefaultMainProfile(userId)];
  try {
    const raw = window.localStorage.getItem(`${PROFILES_STORAGE_KEY}_${userId}`);
    if (!raw) return [createDefaultMainProfile(userId)];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as UserSubProfile[];
    }
  } catch {
    // Ignore storage issues
  }
  return [createDefaultMainProfile(userId)];
}

export function saveLocalSubProfiles(userId: string, profiles: UserSubProfile[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${PROFILES_STORAGE_KEY}_${userId}`,
      JSON.stringify(profiles.slice(0, 12))
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function loadActiveProfileId(userId = 'guest'): string {
  if (typeof window === 'undefined') return 'main';
  try {
    return window.localStorage.getItem(`${ACTIVE_PROFILE_STORAGE_KEY}_${userId}`) || 'main';
  } catch {
    return 'main';
  }
}

export function saveActiveProfileId(userId: string, profileId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${ACTIVE_PROFILE_STORAGE_KEY}_${userId}`, profileId);
  } catch {
    // Ignore storage issues
  }
}

// ---------- Salted SHA-256 PIN Hashing (Never stores plaintext PINs) ----------

function generateHexSalt(byteLen = 8): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const arr = new Uint8Array(byteLen);
    crypto.getRandomValues(arr);
    return Array.from(arr)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return Math.random().toString(16).slice(2, 18).padEnd(16, '0');
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback deterministic hash in constrained non-subtle JS runtimes
  let h1 = 2166136261;
  let h2 = 16777619;
  for (let i = 0; i < input.length; i++) {
    h1 ^= input.charCodeAt(i);
    h1 = Math.imul(h1, 16777619);
    h2 ^= input.charCodeAt(i) + i;
    h2 = Math.imul(h2, 2246822507);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export async function hashProfilePin(pin: string): Promise<{ pinHash: string; pinSalt: string }> {
  const clean = String(pin || '').trim();
  const pinSalt = generateHexSalt(8);
  const pinHash = await sha256Hex(`${pinSalt}:${clean}`);
  return { pinHash, pinSalt };
}

export async function verifyProfilePin(
  pin: string,
  profile: Pick<UserSubProfile, 'hasPin' | 'pinHash' | 'pinSalt'>
): Promise<boolean> {
  if (!profile.hasPin || !profile.pinHash || !profile.pinSalt) return true;
  const candidate = await sha256Hex(`${profile.pinSalt}:${String(pin || '').trim()}`);
  if (candidate.length !== profile.pinHash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ profile.pinHash.charCodeAt(i);
  }
  return diff === 0;
}

export async function upsertSubProfile(params: {
  uid: string | null;
  profile: Omit<UserSubProfile, 'createdAtMs' | 'updatedAtMs' | 'userId'> & {
    createdAtMs?: number;
    newPin?: string;
    clearPin?: boolean;
  };
  existingProfiles: UserSubProfile[];
}): Promise<UserSubProfile[]> {
  const userKey = params.uid || 'guest';
  const now = Date.now();
  const existing = params.existingProfiles.find((p) => p.id === params.profile.id);

  let pinHash = existing?.pinHash;
  let pinSalt = existing?.pinSalt;
  let hasPin = existing?.hasPin || false;

  if (params.profile.clearPin) {
    pinHash = undefined;
    pinSalt = undefined;
    hasPin = false;
  } else if (params.profile.newPin && params.profile.newPin.trim().length >= 4) {
    const hashed = await hashProfilePin(params.profile.newPin.trim());
    pinHash = hashed.pinHash;
    pinSalt = hashed.pinSalt;
    hasPin = true;
  }

  const nextProfile: UserSubProfile = {
    id: params.profile.id,
    userId: userKey,
    name: params.profile.name.trim().slice(0, 60) || 'ملف',
    avatarEmoji: params.profile.avatarEmoji || '🎬',
    avatarColor: params.profile.avatarColor || '#dc2626',
    isKids: Boolean(params.profile.isKids),
    maxAgeRating: params.profile.isKids ? 'kids' : params.profile.maxAgeRating || 'all',
    hasPin,
    ...(pinHash ? { pinHash } : {}),
    ...(pinSalt ? { pinSalt } : {}),
    watchlistIds: params.profile.watchlistIds || existing?.watchlistIds || [],
    createdAtMs: existing?.createdAtMs || params.profile.createdAtMs || now,
    updatedAtMs: now,
  };

  const nextList = existing
    ? params.existingProfiles.map((p) => (p.id === nextProfile.id ? nextProfile : p))
    : [...params.existingProfiles, nextProfile];

  saveLocalSubProfiles(userKey, nextList);
  if (params.uid) {
    await saveUserSubProfileToFirestore(params.uid, nextProfile);
  }
  return nextList;
}

export async function removeSubProfile(
  uid: string | null,
  profileId: string,
  existingProfiles: UserSubProfile[]
): Promise<UserSubProfile[]> {
  if (profileId === 'main') return existingProfiles;
  const userKey = uid || 'guest';
  const nextList = existingProfiles.filter((p) => p.id !== profileId);
  saveLocalSubProfiles(userKey, nextList);
  if (uid) {
    await deleteUserSubProfileFromFirestore(uid, profileId);
  }
  return nextList;
}

// ---------- Data-Level Kids Mode & Age Rating Enforcement ----------

const AGE_RANK: Record<AgeRatingTier, number> = {
  kids: 1,
  '13+': 2,
  '16+': 3,
  '18+': 4,
  all: 5,
};

export function inferMediaAgeTier(item: MediaItem): AgeRatingTier {
  const raw = String(item.ageRating || '').toUpperCase().trim();
  if (raw) {
    if (/(^G$|TV-Y|TV-G|PG$|KIDS|ALL\s*AGES|عائلي|أطفال|اطفال|\+7|7\+)/.test(raw)) {
      return 'kids';
    }
    if (/(PG-13|TV-14|12\+|13\+|\+12|\+13)/.test(raw)) return '13+';
    if (/(15\+|16\+|\+15|\+16)/.test(raw)) return '16+';
    if (/(R$|NC-17|TV-MA|18\+|\+18)/.test(raw)) return '18+';
  }

  const hay = `${(item.categories || []).join(' ')} ${(item.genres || []).join(' ')} ${item.title} ${item.kind}`.toLowerCase();
  if (/(رعب|horror|slasher|gore|جريمة|crime|إثارة\s*للكبار|مصارعة|wrestling|18\+|للكبار)/i.test(hay)) {
    return '16+';
  }
  if (/(عنف|قتل|حرب|غموض|أكشن|action|war|thriller)/i.test(hay) && !/(انمي|أنمي|كارتون|كرتون|أطفال|عائلي|family|animation)/i.test(hay)) {
    return '13+';
  }
  if (/(أطفال|اطفال|كرتون|كارتون|انيميشن|أنيميشن|family|kids|animation|عائلي)/i.test(hay)) {
    return 'kids';
  }
  return '13+';
}

export function isMediaAllowedForProfile(
  item: MediaItem,
  profile: UserSubProfile | null | undefined
): boolean {
  if (!profile) return true;
  if (!profile.isKids && profile.maxAgeRating === 'all') return true;

  const limitTier: AgeRatingTier = profile.isKids ? 'kids' : profile.maxAgeRating;
  const maxRank = AGE_RANK[limitTier] ?? 5;
  const mediaTier = inferMediaAgeTier(item);
  const mediaRank = AGE_RANK[mediaTier] ?? 2;

  if (profile.isKids) {
    // Kids mode: explicitly exclude mature categories/wrestling/horror/16+/18+,
    // and favor kids/animation/family or strictly child-safe PG items.
    const hay = `${(item.categories || []).join(' ')} ${(item.genres || []).join(' ')} ${item.kind}`.toLowerCase();
    if (item.kind === 'wrestling') return false;
    if (/(رعب|horror|جريمة|crime|مصارعة|wrestling|18\+|16\+|إباحي|دموي)/i.test(hay)) {
      return false;
    }
    return mediaRank <= AGE_RANK.kids;
  }

  return mediaRank <= maxRank;
}
