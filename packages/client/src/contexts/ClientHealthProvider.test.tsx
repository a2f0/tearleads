import type { HealthRuntimeProviderProps } from '@tearleads/app-health/clientEntry';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ClientHealthProvider } from './ClientHealthProvider';

const mockCreateHealthTracker = vi.fn();

function makeMockDb(name: string) {
  const queryChain = {
    from: vi.fn(),
    where: vi.fn().mockResolvedValue([])
  };
  queryChain.from.mockReturnValue(queryChain);
  return {
    name,
    select: vi.fn().mockReturnValue(queryChain),
    insert: vi.fn().mockReturnValue({ values: vi.fn() })
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

vi.mock('@tearleads/app-health/clientEntry', () => {
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
  });

  it('renders children inside HealthRuntimeProvider', async () => {
    render(
      <ClientHealthProvider>
        <div data-testid="child">Child content</div>
      </ClientHealthProvider>
    );

    await waitFor(() => {
      expect(mockDbA.select).toHaveBeenCalled();
    });

    expect(screen.getByTestId('health-runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
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
});
