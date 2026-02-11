import type { AuthUser } from '@tearleads/shared';

export const AUTH_TOKEN_KEY = 'auth_token';
export const AUTH_REFRESH_TOKEN_KEY = 'auth_refresh_token';
export const AUTH_USER_KEY = 'auth_user';
const AUTH_CHANGE_EVENT = 'tearleads_auth_change';
const SESSION_EXPIRED_MESSAGE = 'Session expired. Please sign in again.';
const REFRESH_LOCK_KEY = 'auth_refresh_lock';
const REFRESH_LOCK_TIMEOUT_MS = 10000; // 10 seconds max lock duration

let authError: string | null = null;

interface StoredAuth {
  token: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
}

function notifyAuthChange(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

export function onAuthChange(listener: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  window.addEventListener(AUTH_CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener(AUTH_CHANGE_EVENT, listener);
  };
}

export function getAuthError(): string | null {
  return authError;
}

export function setAuthError(message: string): void {
  authError = message;
  notifyAuthChange();
}

export function clearAuthError(): void {
  authError = null;
  notifyAuthChange();
}

export function setSessionExpiredError(): void {
  setAuthError(SESSION_EXPIRED_MESSAGE);
}

export function readStoredAuth(): StoredAuth {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const refreshToken = localStorage.getItem(AUTH_REFRESH_TOKEN_KEY);
    const user = localStorage.getItem(AUTH_USER_KEY);

    if (!token || !user) {
      return { token: null, refreshToken: null, user: null };
    }

    return { token, refreshToken, user: JSON.parse(user) as AuthUser };
  } catch {
    clearStoredAuth();
    return { token: null, refreshToken: null, user: null };
  }
}

export function storeAuth(
  token: string,
  refreshToken: string,
  user: AuthUser
): void {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, refreshToken);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    notifyAuthChange();
  } catch {
    // Ignore storage errors (e.g. private mode, quota exceeded).
  }
}

export function clearStoredAuth(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_REFRESH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    notifyAuthChange();
  } catch {
    // Ignore storage errors.
  }
}

export function getStoredAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Check if the user is logged in (has an auth token).
 */
export function isLoggedIn(): boolean {
  return getStoredAuthToken() !== null;
}

export function getAuthHeaderValue(): string | null {
  const token = getStoredAuthToken();
  return token ? `Bearer ${token}` : null;
}

export function getStoredRefreshToken(): string | null {
  try {
    return localStorage.getItem(AUTH_REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function updateStoredTokens(
  accessToken: string,
  refreshToken: string
): void {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, accessToken);
    localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, refreshToken);
    notifyAuthChange();
  } catch {
    // Ignore storage errors.
  }
}

/**
 * Cross-tab refresh coordination to prevent race conditions.
 * Uses a localStorage-based lock with timeout to coordinate refresh attempts.
 */

interface RefreshLock {
  tabId: string;
  timestamp: number;
  refreshToken: string;
}

// Generate a unique ID for this tab
const TAB_ID =
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

function parseRefreshLock(): RefreshLock | null {
  try {
    const raw = localStorage.getItem(REFRESH_LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'tabId' in parsed &&
      'timestamp' in parsed &&
      'refreshToken' in parsed &&
      typeof (parsed as RefreshLock).tabId === 'string' &&
      typeof (parsed as RefreshLock).timestamp === 'number' &&
      typeof (parsed as RefreshLock).refreshToken === 'string'
    ) {
      return parsed as RefreshLock;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Attempts to acquire a lock for token refresh.
 * Returns true if this tab acquired the lock, false if another tab holds it.
 */
export function tryAcquireRefreshLock(refreshToken: string): boolean {
  const now = Date.now();
  const existingLock = parseRefreshLock();

  // Check if another tab holds a valid (non-expired) lock
  if (existingLock) {
    const lockAge = now - existingLock.timestamp;
    if (lockAge < REFRESH_LOCK_TIMEOUT_MS && existingLock.tabId !== TAB_ID) {
      // Another tab is refreshing - check if it's using the same token
      if (existingLock.refreshToken === refreshToken) {
        // Same token being refreshed by another tab - wait for it
        return false;
      }
      // Different token - the other tab may have already refreshed
      // Let this tab proceed to re-read from storage
      return false;
    }
    // Lock is expired or belongs to this tab - safe to take over
  }

  // Acquire the lock
  const lock: RefreshLock = {
    tabId: TAB_ID,
    timestamp: now,
    refreshToken
  };
  try {
    localStorage.setItem(REFRESH_LOCK_KEY, JSON.stringify(lock));
    return true;
  } catch {
    return false;
  }
}

/**
 * Releases the refresh lock if this tab holds it.
 */
export function releaseRefreshLock(): void {
  try {
    const existingLock = parseRefreshLock();
    if (existingLock && existingLock.tabId === TAB_ID) {
      localStorage.removeItem(REFRESH_LOCK_KEY);
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Checks if another tab is currently refreshing.
 */
export function isRefreshInProgress(): boolean {
  const lock = parseRefreshLock();
  if (!lock) return false;

  const lockAge = Date.now() - lock.timestamp;
  return lockAge < REFRESH_LOCK_TIMEOUT_MS && lock.tabId !== TAB_ID;
}

/**
 * Waits for an ongoing refresh by another tab to complete.
 * Returns true if refresh completed (tokens updated), false if timed out.
 */
export async function waitForRefreshCompletion(
  originalRefreshToken: string,
  timeoutMs: number = 5000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    // Check if the refresh token has changed (another tab succeeded)
    const currentRefreshToken = getStoredRefreshToken();
    if (currentRefreshToken && currentRefreshToken !== originalRefreshToken) {
      return true;
    }

    // Check if the lock was released
    if (!isRefreshInProgress()) {
      // Lock released - check if tokens were updated
      const newRefreshToken = getStoredRefreshToken();
      return (
        newRefreshToken !== null && newRefreshToken !== originalRefreshToken
      );
    }

    // Wait a bit before checking again
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return false;
}
