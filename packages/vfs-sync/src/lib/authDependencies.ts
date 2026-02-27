import type { ComponentType } from 'react';

type AuthMode = 'login' | 'register';

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  isLoading: boolean;
  tokenExpiresAt: Date | null;
  getTokenTimeRemaining: () => number | null;
  logout: () => Promise<void>;
}

export interface LoginFormProps {
  title: string;
  description: string;
  switchModeCta?:
    | {
        prompt: string;
        actionLabel: string;
        onAction: () => void;
      }
    | undefined;
}

export interface RegisterFormProps {
  title: string;
  description: string;
  emailDomain?: string | undefined;
  switchModeCta?:
    | {
        prompt: string;
        actionLabel: string;
        onAction: () => void;
      }
    | undefined;
}

export interface SyncAuthDependencies {
  useAuth: () => AuthState;
  LoginForm: ComponentType<LoginFormProps>;
  RegisterForm: ComponentType<RegisterFormProps>;
  SessionList: ComponentType;
  ping: () => Promise<{ emailDomain?: string | null }>;
  initialAuthMode?: AuthMode;
}

let dependencies: SyncAuthDependencies | null = null;

export function setSyncAuthDependencies(next: SyncAuthDependencies): void {
  dependencies = next;
}

export function getSyncAuthDependencies(): SyncAuthDependencies | null {
  return dependencies;
}
