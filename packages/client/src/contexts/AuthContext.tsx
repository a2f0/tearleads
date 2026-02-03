import type { AuthUser } from '@rapid/shared';
import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';
import { api, tryRefreshToken } from '@/lib/api';
import {
  AUTH_REFRESH_TOKEN_KEY,
  AUTH_TOKEN_KEY,
  AUTH_USER_KEY,
  clearAuthError,
  clearStoredAuth,
  getAuthError,
  getStoredAuthToken,
  onAuthChange,
  readStoredAuth,
  storeAuth
} from '@/lib/auth-storage';
import { getJwtExpiration, getJwtTimeRemaining } from '@/lib/jwt';

const REFRESH_THRESHOLD_MS = 60 * 1000; // Refresh if expiring within 60 seconds

interface AuthContextValue {
  isAuthenticated: boolean;
  user: AuthUser | null;
  token: string | null;
  tokenExpiresAt: Date | null;
  authError: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearAuthError: () => void;
  getTokenTimeRemaining: () => number | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authError, setAuthErrorState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const syncFromStorage = useCallback(() => {
    const { token: savedToken, user: savedUser } = readStoredAuth();
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(savedUser);
    } else {
      setToken(null);
      setUser(null);
    }
    setAuthErrorState(getAuthError());
  }, []);

  // Load session from localStorage on mount
  useEffect(() => {
    syncFromStorage();
    setIsLoading(false);
  }, [syncFromStorage]);

  useEffect(() => {
    const unsubscribe = onAuthChange(syncFromStorage);
    return unsubscribe;
  }, [syncFromStorage]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const authStorageKeys = new Set([
      AUTH_TOKEN_KEY,
      AUTH_REFRESH_TOKEN_KEY,
      AUTH_USER_KEY
    ]);

    const handleStorageChange = (event: StorageEvent) => {
      if (!event.key || authStorageKeys.has(event.key)) {
        syncFromStorage();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [syncFromStorage]);

  // Proactive token refresh on mount and visibility change
  useEffect(() => {
    const checkAndRefresh = async () => {
      const storedToken = getStoredAuthToken();
      if (!storedToken) return;

      const timeRemaining = getJwtTimeRemaining(storedToken);
      // timeRemaining is null if token is already expired
      if (timeRemaining === null || timeRemaining < REFRESH_THRESHOLD_MS) {
        // Token expired or expiring soon - refresh proactively
        await tryRefreshToken();
      }
    };

    // Check on mount (app hydration)
    void checkAndRefresh();

    // Check on visibility change (tab becoming visible)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkAndRefresh();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Errors propagate to caller for handling (e.g., Sync component catches and displays)
  const login = useCallback(async (email: string, password: string) => {
    clearAuthError();
    const response = await api.auth.login(email, password);

    // Store in state
    setToken(response.accessToken);
    setUser(response.user);
    setAuthErrorState(null);

    // Persist to localStorage
    storeAuth(response.accessToken, response.refreshToken, response.user);
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    clearAuthError();
    const response = await api.auth.register(email, password);

    // Store in state (same as login - auto-login after registration)
    setToken(response.accessToken);
    setUser(response.user);
    setAuthErrorState(null);

    // Persist to localStorage
    storeAuth(response.accessToken, response.refreshToken, response.user);
  }, []);

  const logout = useCallback(async () => {
    // Invalidate session on server (best effort)
    try {
      await api.auth.logout();
    } catch (error) {
      // Ignore errors - we still want to clear local state, but log for debugging.
      console.warn('Server-side logout failed:', error);
    }

    setToken(null);
    setUser(null);
    setAuthErrorState(null);
    clearStoredAuth();
    clearAuthError();
  }, []);

  const tokenExpiresAt = useMemo(() => {
    if (!token) return null;
    const exp = getJwtExpiration(token);
    return exp ? new Date(exp * 1000) : null;
  }, [token]);

  const getTokenTimeRemaining = useCallback(() => {
    if (!token) return null;
    return getJwtTimeRemaining(token);
  }, [token]);

  const value = useMemo(
    () => ({
      isAuthenticated: token !== null,
      user,
      token,
      tokenExpiresAt,
      authError,
      isLoading,
      login,
      register,
      logout,
      clearAuthError: () => {
        setAuthErrorState(null);
        clearAuthError();
      },
      getTokenTimeRemaining
    }),
    [
      user,
      token,
      tokenExpiresAt,
      authError,
      isLoading,
      login,
      register,
      logout,
      getTokenTimeRemaining
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
