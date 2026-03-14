import type { HealthRuntimeProviderProps } from '@tearleads/app-health/clientEntry';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ClientHealthProvider } from './ClientHealthProvider';

const mockCreateHealthTracker = vi.fn();
const mockRegisterVfsItemWithCurrentKeys = vi.fn();
const mockVfsRegister = vi.fn();
const mockIsLoggedIn = vi.fn();
const mockReadStoredAuth = vi.fn();
const mockGetFeatureFlagValue = vi.fn();
const mockQueueLinkReassignAndFlush = vi.fn();

function makeMockDb(name: string) {
  const queryChain = {
    from: vi.fn(),
    where: vi.fn().mockResolvedValue([])
  };
  const insertValues = vi.fn().mockResolvedValue(undefined);
  queryChain.from.mockReturnValue(queryChain);
  return {
    name,
    select: vi.fn().mockReturnValue(queryChain),
    insertValues,
    insert: vi.fn().mockReturnValue({ values: insertValues })
  };
}

const mockDbA = makeMockDb('health-db-a');
const mockDbB = makeMockDb('health-db-b');

let mockDatabaseContext = {
  db: mockDbA,
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'instance-a'
};

let lastProviderProps: HealthRuntimeProviderProps | null = null;

function requireProviderProps(): HealthRuntimeProviderProps {
  if (!lastProviderProps) {
    throw new Error('Expected HealthRuntimeProvider props to be captured');
  }

  return lastProviderProps;
}

vi.mock('@tearleads/app-health/clientEntry', async () => {
  return {
    createHealthTracker: (db: unknown) => mockCreateHealthTracker(db),
    HealthRuntimeProvider: (props: HealthRuntimeProviderProps) => {
      lastProviderProps = props;
      return <div data-testid="health-runtime-provider">{props.children}</div>;
    }
  };
});

vi.mock('@/db', () => ({
  getDatabase: vi.fn(() => {
    throw new Error('getDatabase should not be called by ClientHealthProvider');
  })
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockDatabaseContext
}));

vi.mock('@/db/hooks/useHostRuntimeDatabaseState', () => ({
  useHostRuntimeDatabaseState: () => ({
    isUnlocked: mockDatabaseContext.isUnlocked,
    isLoading: mockDatabaseContext.isLoading,
    currentInstanceId: mockDatabaseContext.currentInstanceId
  })
}));

vi.mock('@/hooks/vfs/useVfsKeys', () => ({
  registerVfsItemWithCurrentKeys: (...args: unknown[]) =>
    mockRegisterVfsItemWithCurrentKeys(...args)
}));

vi.mock('@/lib/api', () => ({
  api: {
    vfs: {
      register: (...args: unknown[]) => mockVfsRegister(...args)
    }
  }
}));

vi.mock('@/lib/authStorage', () => ({
  isLoggedIn: () => mockIsLoggedIn(),
  readStoredAuth: () => mockReadStoredAuth()
}));

vi.mock('@/lib/featureFlags', () => ({
  getFeatureFlagValue: (...args: unknown[]) => mockGetFeatureFlagValue(...args)
}));

vi.mock('@/lib/vfsItemSyncWriter', () => ({
  queueLinkReassignAndFlush: (...args: unknown[]) =>
    mockQueueLinkReassignAndFlush(...args)
}));

describe('ClientHealthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastProviderProps = null;
    mockCreateHealthTracker.mockImplementation((db: unknown) => ({ db }));
    mockDatabaseContext = {
      db: mockDbA,
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'instance-a'
    };
    mockRegisterVfsItemWithCurrentKeys.mockResolvedValue({
      sessionKey: new Uint8Array([1, 2, 3]),
      encryptedSessionKey: 'wrapped-health-key'
    });
    mockVfsRegister.mockResolvedValue({
      id: 'reading-1',
      createdAt: '2026-03-14T00:00:00.000Z'
    });
    mockIsLoggedIn.mockReturnValue(false);
    mockReadStoredAuth.mockReturnValue({
      user: { id: 'user-1' }
    });
    mockGetFeatureFlagValue.mockReturnValue(false);
    mockQueueLinkReassignAndFlush.mockResolvedValue(undefined);
  });

  it('renders children inside HealthRuntimeProvider', async () => {
    const view = render(
      <ClientHealthProvider>
        <div data-testid="child">Child content</div>
      </ClientHealthProvider>
    );

    await waitFor(() => {
      expect(mockDbA.select).toHaveBeenCalled();
    });

    expect(view.getByTestId('health-runtime-provider')).toBeInTheDocument();
    expect(view.getByTestId('child')).toBeInTheDocument();
  });

  it('passes database state and inline unlock to the runtime provider', async () => {
    render(
      <ClientHealthProvider>
        <div>Child</div>
      </ClientHealthProvider>
    );

    await waitFor(() => {
      expect(mockDbA.select).toHaveBeenCalled();
    });

    expect(requireProviderProps().databaseState).toEqual({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'instance-a'
    });
    expect(requireProviderProps().InlineUnlock).toBe(InlineUnlock);
  });

  it('rebinds tracker creation to the active database context', async () => {
    const { rerender } = render(
      <ClientHealthProvider>
        <div>Child</div>
      </ClientHealthProvider>
    );

    await waitFor(() => {
      expect(mockDbA.select).toHaveBeenCalled();
    });

    expect(requireProviderProps().createTracker()).toEqual({ db: mockDbA });
    expect(mockCreateHealthTracker).toHaveBeenCalledWith(mockDbA);

    mockDatabaseContext = {
      db: mockDbB,
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'instance-b'
    };

    rerender(
      <ClientHealthProvider>
        <div>Child</div>
      </ClientHealthProvider>
    );

    await waitFor(() => {
      expect(mockDbB.select).toHaveBeenCalled();
    });

    expect(requireProviderProps().databaseState).toEqual({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'instance-b'
    });
    expect(requireProviderProps().createTracker()).toEqual({ db: mockDbB });
    expect(mockCreateHealthTracker).toHaveBeenLastCalledWith(mockDbB);
  });

  it('stores VFS registry rows before awaiting server registration', async () => {
    mockIsLoggedIn.mockReturnValue(true);
    mockGetFeatureFlagValue.mockReturnValue(true);

    let resolveServerRegister: (() => void) | null = null;
    mockVfsRegister.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveServerRegister = () => resolve(undefined);
        })
    );

    render(
      <ClientHealthProvider>
        <div>Child</div>
      </ClientHealthProvider>
    );

    await waitFor(() => {
      expect(mockDbA.select).toHaveBeenCalled();
    });

    const registerPromise = requireProviderProps().registerReadingInVfs(
      'reading-1',
      '2026-03-14T12:00:00.000Z'
    );

    await waitFor(() => {
      expect(mockRegisterVfsItemWithCurrentKeys).toHaveBeenCalledWith({
        id: 'reading-1',
        objectType: 'healthReading',
        registerOnServer: false
      });
      expect(mockDbA.insertValues).toHaveBeenCalledWith({
        id: 'reading-1',
        objectType: 'healthReading',
        ownerId: 'user-1',
        encryptedSessionKey: 'wrapped-health-key',
        createdAt: new Date('2026-03-14T12:00:00.000Z')
      });
      expect(mockVfsRegister).toHaveBeenCalledWith({
        id: 'reading-1',
        objectType: 'healthReading',
        encryptedSessionKey: 'wrapped-health-key'
      });
    });

    await expect(
      Promise.race([
        registerPromise.then(() => 'resolved'),
        new Promise((resolve) => {
          setTimeout(() => resolve('pending'), 20);
        })
      ])
    ).resolves.toBe('resolved');

    resolveServerRegister?.();
    await expect(registerPromise).resolves.toBeUndefined();
  });

  it('keeps local VFS registration successful when server registration fails', async () => {
    mockIsLoggedIn.mockReturnValue(true);
    mockGetFeatureFlagValue.mockReturnValue(true);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockVfsRegister.mockRejectedValueOnce(new Error('Server rejected register'));

    render(
      <ClientHealthProvider>
        <div>Child</div>
      </ClientHealthProvider>
    );

    await waitFor(() => {
      expect(mockDbA.select).toHaveBeenCalled();
    });

    await expect(
      requireProviderProps().registerReadingInVfs(
        'reading-2',
        '2026-03-14T12:30:00.000Z'
      )
    ).resolves.toBeUndefined();

    expect(mockDbA.insertValues).toHaveBeenCalledWith({
      id: 'reading-2',
      objectType: 'healthReading',
      ownerId: 'user-1',
      encryptedSessionKey: 'wrapped-health-key',
      createdAt: new Date('2026-03-14T12:30:00.000Z')
    });

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to register health reading on server:',
        expect.any(Error)
      );
    });

    warnSpy.mockRestore();
  });
});
