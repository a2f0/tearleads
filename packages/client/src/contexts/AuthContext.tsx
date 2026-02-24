import type { AuthUser, VfsKeySetupRequest } from '@tearleads/shared';
import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';
import {
  createVfsKeySetupPayloadForOnboarding,
  setVfsRecoveryPassword
} from '@/hooks/vfs';
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
} from '@/lib/authStorage';
import { getJwtExpiration, getJwtTimeRemaining } from '@/lib/jwt';

const REFRESH_THRESHOLD_MS = 60 * 1000; // Refresh if expiring within 60 seconds
const REFRESH_POLL_INTERVAL_MS = 30 * 1000;

interface AuthContextValue {
  isAuthenticated: boolean;
  user: AuthUser | null;
  token: string | null;
  tokenExpiresAt: Date | null;
  authError: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    vfsKeySetup?: VfsKeySetupRequest
  ) => Promise<void>;
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

  const refreshIfNeeded = useCallback(async () => {
    const storedToken = getStoredAuthToken();
    if (!storedToken) return;

    const timeRemaining = getJwtTimeRemaining(storedToken);
    // timeRemaining is null if token is already expired
    if (timeRemaining === null || timeRemaining < REFRESH_THRESHOLD_MS) {
      await tryRefreshToken();
      syncFromStorage();
    }
  }, [syncFromStorage]);

  // Load session from localStorage on mount and proactively refresh if needed
  // IMPORTANT: isLoading stays true until refresh completes to prevent SSE race condition
  useEffect(() => {
    const initAuth = async () => {
      syncFromStorage();

      // Check if proactive refresh is needed before marking as loaded
      await refreshIfNeeded();

      setIsLoading(false);
    };

    void initAuth();
  }, [refreshIfNeeded, syncFromStorage]);

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

  // Proactive token refresh on visibility/focus change (mount case handled above)
  useEffect(() => {
    const handlePageActive = () => {
      if (document.visibilityState === 'visible') {
        void refreshIfNeeded();
      }
    };

    document.addEventListener('visibilitychange', handlePageActive);
    window.addEventListener('focus', handlePageActive);
    window.addEventListener('pageshow', handlePageActive);
    return () => {
      document.removeEventListener('visibilitychange', handlePageActive);
      window.removeEventListener('focus', handlePageActive);
      window.removeEventListener('pageshow', handlePageActive);
    };
  }, [refreshIfNeeded]);

  // Proactive token refresh on a timer to keep the session alive
  useEffect(() => {
    if (isLoading || !token) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshIfNeeded();
    }, REFRESH_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [isLoading, refreshIfNeeded, token]);

  // Errors propagate to caller for handling (e.g., Sync component catches and displays)
  const login = useCallback(async (email: string, password: string) => {
    clearAuthError();
    const response = await api.auth.login(email, password);
    setVfsRecoveryPassword(password);

    // Store in state
    setToken(response.accessToken);
    setUser(response.user);
    setAuthErrorState(null);

    // Persist to localStorage
    storeAuth(response.accessToken, response.refreshToken, response.user);
  }, []);

  const register = useCallback(
    async (
      email: string,
      password: string,
      vfsKeySetup?: VfsKeySetupRequest
    ) => {
      clearAuthError();
      let effectiveVfsKeySetup = vfsKeySetup;
      setVfsRecoveryPassword(password);
      if (!effectiveVfsKeySetup) {
        effectiveVfsKeySetup =
          await createVfsKeySetupPayloadForOnboarding(password);
      }

      const response = await api.auth.register(
        email,
        password,
        effectiveVfsKeySetup
      );

      // Store in state (same as login - auto-login after registration)
      setToken(response.accessToken);
      setUser(response.user);
      setAuthErrorState(null);

      // Persist to localStorage
      storeAuth(response.accessToken, response.refreshToken, response.user);
    },
    []
  );

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
    setVfsRecoveryPassword(null);
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
