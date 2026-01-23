import type { AuthUser } from '@rapid/shared';

const AUTH_TOKEN_KEY = 'auth_token';
const AUTH_USER_KEY = 'auth_user';

interface StoredAuth {
  token: string | null;
  user: AuthUser | null;
}

export function readStoredAuth(): StoredAuth {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const user = localStorage.getItem(AUTH_USER_KEY);

    if (!token || !user) {
      return { token: null, user: null };
    }

    return { token, user: JSON.parse(user) as AuthUser };
  } catch {
    clearStoredAuth();
    return { token: null, user: null };
  }
}

export function storeAuth(token: string, user: AuthUser): void {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  } catch {
    // Ignore storage errors (e.g. private mode, quota exceeded).
  }
}

export function clearStoredAuth(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
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
