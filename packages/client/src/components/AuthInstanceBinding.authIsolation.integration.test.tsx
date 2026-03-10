import '../test/setupIntegration';

import { render, waitFor } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { DatabaseProvider, useDatabaseContext } from '@/db/hooks';
import { AUTH_TOKEN_KEY, AUTH_USER_KEY } from '@/lib/authStorage';
import { createTestJwt } from '@/test/jwtTestUtils';
import { AuthInstanceBinding } from './AuthInstanceBinding';

const mockApiLogout = vi.fn(async () => undefined);
const mockTryRefreshToken = vi.fn(async () => false);

vi.mock('@/lib/api', () => ({
  api: {
    auth: {
      login: vi.fn(),
      register: vi.fn(),
      logout: () => mockApiLogout()
    }
  },
  tryRefreshToken: () => mockTryRefreshToken()
}));

let latestDatabaseContext: ReturnType<typeof useDatabaseContext> | null = null;
let latestAuthContext: ReturnType<typeof useAuth> | null = null;

function DatabaseContextProbe() {
  latestDatabaseContext = useDatabaseContext();
  return null;
}

function AuthContextProbe() {
  latestAuthContext = useAuth();
  return null;
}

function requireDatabaseContext(): ReturnType<typeof useDatabaseContext> {
  if (!latestDatabaseContext) {
    throw new Error('Expected database context to be available');
  }
  return latestDatabaseContext;
}

async function waitForAppToLoad(): Promise<void> {
  await waitFor(() => {
    expect(latestDatabaseContext).not.toBeNull();
    expect(latestAuthContext).not.toBeNull();
    expect(latestDatabaseContext?.isLoading).toBe(false);
    expect(latestDatabaseContext?.currentInstanceId).toBeTruthy();
    expect(latestAuthContext?.isLoading).toBe(false);
    expect(latestAuthContext?.isAuthenticated).toBe(true);
    expect(latestAuthContext?.user?.id).toBe('user-bob');
  });
}

async function waitForCurrentInstanceToBeBoundToBob(): Promise<void> {
  await waitFor(() => {
    const currentInstance = latestDatabaseContext?.instances.find(
      (instance) => instance.id === latestDatabaseContext?.currentInstanceId
    );
    expect(currentInstance?.boundUserId).toBe('user-bob');
  });
}

describe('AuthInstanceBinding auth isolation integration', () => {
  beforeEach(() => {
    latestDatabaseContext = null;
    latestAuthContext = null;
    mockApiLogout.mockClear();
    mockTryRefreshToken.mockClear();
    localStorage.clear();

    const token = createTestJwt(Math.floor(Date.now() / 1000) + 3600);
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(
      AUTH_USER_KEY,
      JSON.stringify({ id: 'user-bob', email: 'bob@tearleads.com' })
    );
  });

  it('logs out when switching to a newly created unbound instance', async () => {
    render(
      <DatabaseProvider>
        <AuthProvider>
          <AuthInstanceBinding />
          <DatabaseContextProbe />
          <AuthContextProbe />
        </AuthProvider>
      </DatabaseProvider>
    );

    await waitForAppToLoad();
    await waitForCurrentInstanceToBeBoundToBob();

    let createdInstanceId = '';
    await act(async () => {
      createdInstanceId = await requireDatabaseContext().createInstance();
    });

    await waitFor(() => {
      expect(latestDatabaseContext?.isLoading).toBe(false);
      expect(latestDatabaseContext?.currentInstanceId).toBe(createdInstanceId);
      const currentInstance = latestDatabaseContext?.instances.find(
        (instance) => instance.id === createdInstanceId
      );
      expect(currentInstance?.boundUserId ?? null).toBeNull();
    });

    await waitFor(() => {
      expect(latestAuthContext?.isAuthenticated).toBe(false);
    });

    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(AUTH_USER_KEY)).toBeNull();
    expect(mockApiLogout).toHaveBeenCalledTimes(1);
  });
});
