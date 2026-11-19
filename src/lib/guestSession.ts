// Client-only Viewer Guest Session manager.
// Never creates fake Firebase accounts and never requires a database connection.

export const GUEST_SESSION_STORAGE_KEY = 'rahaltv_guest_session_v1';

export interface GuestSession {
  active: true;
  displayName: string;
  startedAt: string;
}

let inMemoryFallbackSession: GuestSession | null = null;

function createGuestPayload(): GuestSession {
  return {
    active: true,
    displayName: 'ضيف',
    startedAt: new Date().toISOString(),
  };
}

export function isGuestSessionActive(session: GuestSession | null | undefined): session is GuestSession {
  return Boolean(session && session.active === true);
}

export function loadGuestSession(): GuestSession | null {
  if (typeof window === 'undefined') return inMemoryFallbackSession;
  try {
    const raw = window.localStorage.getItem(GUEST_SESSION_STORAGE_KEY);
    if (!raw) return inMemoryFallbackSession;
    const parsed = JSON.parse(raw) as Partial<GuestSession> | null;
    if (!parsed || parsed.active !== true) return null;
    const normalized: GuestSession = {
      active: true,
      displayName:
        typeof parsed.displayName === 'string' && parsed.displayName.trim()
          ? parsed.displayName.trim().slice(0, 40)
          : 'ضيف',
      startedAt:
        typeof parsed.startedAt === 'string' && parsed.startedAt
          ? parsed.startedAt
          : new Date().toISOString(),
    };
    inMemoryFallbackSession = normalized;
    return normalized;
  } catch {
    return inMemoryFallbackSession;
  }
}

export function enterGuestSession(): GuestSession {
  const session = createGuestPayload();
  inMemoryFallbackSession = session;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(GUEST_SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Private browsing / Android WebView / TV quota fallback already handled in memory
    }
  }
  return session;
}

export function exitGuestSession(): void {
  inMemoryFallbackSession = null;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(GUEST_SESSION_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }
}
