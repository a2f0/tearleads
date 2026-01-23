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
import { api } from '@/lib/api';
import { clearStoredAuth, readStoredAuth, storeAuth } from '@/lib/auth-storage';

interface AuthContextValue {
  isAuthenticated: boolean;
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load session from localStorage on mount
  useEffect(() => {
    const { token: savedToken, user: savedUser } = readStoredAuth();
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(savedUser);
    } else {
      setToken(null);
      setUser(null);
    }
    setIsLoading(false);
  }, []);

  // Errors propagate to caller for handling (e.g., Sync component catches and displays)
  const login = useCallback(async (email: string, password: string) => {
    const response = await api.auth.login(email, password);

    // Store in state
    setToken(response.accessToken);
    setUser(response.user);

    // Persist to localStorage
    storeAuth(response.accessToken, response.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    clearStoredAuth();
  }, []);

  const value = useMemo(
    () => ({
      isAuthenticated: token !== null,
      user,
      token,
      isLoading,
      login,
      logout
    }),
    [user, token, isLoading, login, logout]
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
