import { render } from '@testing-library/react';
import { type FormEvent, useEffect, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import {
  type AuthState,
  type AuthUser,
  type LoginFormProps,
  type RegisterFormProps,
  setSyncAuthDependencies
} from '../../lib/authDependencies';
import { Sync } from './Sync';

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
export const mockLogout = vi.fn<() => Promise<void>>();
export const mockPingGet =
  vi.fn<() => Promise<{ emailDomain?: string | null }>>();

let authState: AuthStoreState;
const authListeners = new Set<() => void>();

function notifyAuthListeners(): void {
  authListeners.forEach((listener) => {
    listener();
  });
}

function setAuthState(next: AuthStoreState): void {
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
    const decoded = JSON.parse(atob(padded)) as { exp?: number };

    if (typeof decoded.exp !== 'number') {
      return null;
    }

    return decoded.exp * 1000;
  } catch {
    return null;
  }
}

function readInitialAuthState(): AuthStoreState {
  const token = localStorage.getItem('auth_token');
  const userJson = localStorage.getItem('auth_user');

  if (!token || !userJson) {
    return {
      isAuthenticated: false,
      user: null,
      isLoading: false,
      tokenExpiresMs: null
    };
  }

  try {
    const user = JSON.parse(userJson) as AuthUser;
    return {
      isAuthenticated: true,
      user,
      isLoading: false,
      tokenExpiresMs: parseTokenExpirationMs(token)
    };
  } catch {
    return {
      isAuthenticated: false,
      user: null,
      isLoading: false,
      tokenExpiresMs: null
    };
  }
}

function useMockAuth(): AuthState {
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
      setAuthState({
        isAuthenticated: false,
        user: null,
        isLoading: false,
        tokenExpiresMs: null
      });
    }
  };
}

function LoginForm({ title, description }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await mockLogin(email, password);
      setAuthState({
        isAuthenticated: true,
        user: result.user,
        isLoading: false,
        tokenExpiresMs: Date.now() + result.expiresIn * 1000
      });
    } catch (submitError) {
      if (submitError instanceof Error) {
        setError(submitError.message);
      } else if (typeof submitError === 'string') {
        setError(submitError);
      } else {
        setError('Login failed. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2>{title}</h2>
      <p>{description}</p>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <button type="submit" disabled={!email || !password || isSubmitting}>
        {isSubmitting ? 'Signing in...' : 'Sign In'}
      </button>
      {error ? <div>{error}</div> : null}
    </form>
  );
}

function RegisterForm({ title, description, emailDomain }: RegisterFormProps) {
  return (
    <div>
      <h2>{title}</h2>
      <p>{description}</p>
      {emailDomain ? <p>{emailDomain}</p> : null}
      <button type="button">Create Account</button>
    </div>
  );
}

function SessionList() {
  return <div>Session List</div>;
}

export function setupSyncDependencies(
  initialAuthMode?: 'login' | 'register'
): void {
  authListeners.clear();
  authState = readInitialAuthState();

  setSyncAuthDependencies({
    useAuth: useMockAuth,
    LoginForm,
    RegisterForm,
    SessionList,
    ping: () => mockPingGet(),
    initialAuthMode
  });
}

export function resetSyncTestState(): void {
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
  setupSyncDependencies();
}

export function renderSync(showBackLink = true) {
  return render(
    <MemoryRouter>
      <Sync showBackLink={showBackLink} />
    </MemoryRouter>
  );
}
