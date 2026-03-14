import { useEffect, useState } from 'react';
import { vi } from 'vitest';
import type { AuthState, AuthUser } from '../../lib/authDependencies';

export interface LoginResult {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  user: AuthUser;
}

interface AuthStoreState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  isLoading: boolean;
  tokenExpiresMs: number | null;
}

export const mockLogin =
  vi.fn<(email: string, password: string) => Promise<LoginResult>>();
const mockLogout = vi.fn<() => Promise<void>>();
export const mockPingGet =
  vi.fn<() => Promise<{ emailDomain?: string | null }>>();

const defaultAuthState: AuthStoreState = {
  isAuthenticated: false,
  user: null,
  isLoading: false,
  tokenExpiresMs: null
};

let authState: AuthStoreState = defaultAuthState;
const authListeners = new Set<() => void>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAuthUser(value: unknown): value is AuthUser {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value['id'] === 'string' && typeof value['email'] === 'string'
  );
}

function notifyAuthListeners(): void {
  authListeners.forEach((listener) => {
    listener();
  });
}

export function setAuthState(next: AuthStoreState): void {
  authState = next;
  notifyAuthListeners();
}

function parseTokenExpirationMs(token: string): number | null {
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) {
    return null;
  }

  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(padded));

    const exp = isRecord(decoded) ? decoded['exp'] : undefined;

    if (typeof exp !== 'number') {
      return null;
    }

    return exp * 1000;
  } catch {
    return null;
  }
}

function readInitialAuthState(): AuthStoreState {
  const token = localStorage.getItem('auth_token');
  const userJson = localStorage.getItem('auth_user');

  if (!token || !userJson) {
    return defaultAuthState;
  }

  try {
    const user = JSON.parse(userJson);

    if (!isAuthUser(user)) {
      return defaultAuthState;
    }

    return {
      isAuthenticated: true,
      user,
      isLoading: false,
      tokenExpiresMs: parseTokenExpirationMs(token)
    };
  } catch {
    return defaultAuthState;
  }
}

export function resetAuthStore(): void {
  authListeners.clear();
  authState = readInitialAuthState();
}

export function useMockAuth(): AuthState {
  const [, forceRender] = useState(0);

  useEffect(() => {
    const listener = () => {
      forceRender((value) => value + 1);
    };

    authListeners.add(listener);
    return () => {
      authListeners.delete(listener);
    };
  }, []);

  return {
    isAuthenticated: authState.isAuthenticated,
    user: authState.user,
    isLoading: authState.isLoading,
    tokenExpiresAt:
      authState.tokenExpiresMs !== null
        ? new Date(authState.tokenExpiresMs)
        : null,
    getTokenTimeRemaining: () => {
      if (authState.tokenExpiresMs === null) {
        return null;
      }

      return authState.tokenExpiresMs - Date.now();
    },
    logout: async () => {
      await mockLogout();
      setAuthState(defaultAuthState);
    }
  };
}

export function resetSyncAuthMocks(): void {
  vi.clearAllMocks();
  localStorage.clear();
  mockLogout.mockResolvedValue(undefined);
  mockPingGet.mockResolvedValue({});
  mockLogin.mockResolvedValue({
    accessToken: 'test-token',
    tokenType: 'Bearer',
    expiresIn: 3600,
    user: { id: '123', email: 'test@example.com' }
  });
}
