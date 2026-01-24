import type { AuthUser } from '@rapid/shared';

const AUTH_TOKEN_KEY = 'auth_token';
const AUTH_REFRESH_TOKEN_KEY = 'auth_refresh_token';
const AUTH_USER_KEY = 'auth_user';
const AUTH_CHANGE_EVENT = 'rapid_auth_change';
const SESSION_EXPIRED_MESSAGE = 'Session expired. Please sign in again.';

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
