import { type RenderResult, render } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { setSyncAuthDependencies } from '../../lib/authDependencies';
import { Sync } from './Sync';
import { SyncTestLoginForm } from './SyncTestLoginForm';
import { SyncTestRegisterForm } from './SyncTestRegisterForm';
import { SyncTestSessionList } from './SyncTestSessionList';
import {
  type LoginResult,
  mockLogin,
  mockPingGet,
  resetAuthStore,
  resetSyncAuthMocks,
  useMockAuth
} from './syncTestAuthState';

export type { LoginResult };
export { mockLogin, mockPingGet };

export function setupSyncDependencies(
  initialAuthMode?: 'login' | 'register'
): void {
  resetAuthStore();

  setSyncAuthDependencies({
    useAuth: useMockAuth,
    LoginForm: SyncTestLoginForm,
    RegisterForm: SyncTestRegisterForm,
    SessionList: SyncTestSessionList,
    ping: () => mockPingGet(),
    ...(initialAuthMode ? { initialAuthMode } : {})
  });
}

export function resetSyncTestState(): void {
  resetSyncAuthMocks();
  setupSyncDependencies();
}

export function renderSync(showBackLink = true): RenderResult {
  return render(
    createElement(MemoryRouter, null, createElement(Sync, { showBackLink }))
  );
}
