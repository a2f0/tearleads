import '../test/setupIntegration';

import { render, waitFor } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseProvider, useDatabaseContext } from '@/db/hooks';
import { AuthInstanceBinding } from './AuthInstanceBinding';

const mockUseAuth = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth()
}));

let latestDatabaseContext: ReturnType<typeof useDatabaseContext> | null = null;

function DatabaseContextProbe() {
  latestDatabaseContext = useDatabaseContext();
  return null;
}

async function waitForDatabaseIdle(): Promise<void> {
  await waitFor(() => {
    expect(latestDatabaseContext).not.toBeNull();
    expect(latestDatabaseContext?.isLoading).toBe(false);
    expect(latestDatabaseContext?.currentInstanceId).toBeTruthy();
  });
}

async function waitForBindingToComplete(): Promise<void> {
  await waitFor(() => {
    expect(latestDatabaseContext?.instances[0]?.name).toBe(
      'user-1@example.com'
    );
  });
}

function requireDatabaseContext(): ReturnType<typeof useDatabaseContext> {
  if (!latestDatabaseContext) {
    throw new Error('Expected database context to be available');
  }
  return latestDatabaseContext;
}

describe('AuthInstanceBinding integration', () => {
  beforeEach(() => {
    latestDatabaseContext = null;
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', email: 'user-1@example.com' },
      isAuthenticated: true,
      isLoading: false
    });
  });

  it('keeps created/switched instances active while authenticated', async () => {
    render(
      <DatabaseProvider>
        <AuthInstanceBinding />
        <DatabaseContextProbe />
      </DatabaseProvider>
    );

    await waitForDatabaseIdle();
    await waitForBindingToComplete();

    const initialInstanceId = latestDatabaseContext?.currentInstanceId;
    expect(initialInstanceId).toBeTruthy();
    if (!initialInstanceId) {
      throw new Error('Expected initial instance id');
    }

    let createdInstanceId = '';
    await act(async () => {
      createdInstanceId = await requireDatabaseContext().createInstance();
    });

    await waitForDatabaseIdle();
    await waitFor(() => {
      expect(latestDatabaseContext?.instances).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: createdInstanceId })
        ])
      );
    });

    // Give auth-binding effects time to react to instance changes.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200);
    });

    expect(latestDatabaseContext?.currentInstanceId).toBe(createdInstanceId);

    await act(async () => {
      await requireDatabaseContext().switchInstance(initialInstanceId);
    });
    await waitForDatabaseIdle();
    expect(latestDatabaseContext?.currentInstanceId).toBe(initialInstanceId);

    await act(async () => {
      await requireDatabaseContext().switchInstance(createdInstanceId);
    });
    await waitForDatabaseIdle();

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200);
    });

    expect(latestDatabaseContext?.currentInstanceId).toBe(createdInstanceId);
  });
});
