import type { HealthRuntimeProviderProps } from '@tearleads/app-health/clientEntry';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ClientHealthProvider } from './ClientHealthProvider';

const mockCreateHealthTracker = vi.fn();

const mockDbA = { name: 'health-db-a' };
const mockDbB = { name: 'health-db-b' };

let mockDatabaseContext = {
  db: mockDbA,
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'instance-a'
};

let lastProviderProps: HealthRuntimeProviderProps | null = null;

vi.mock('@tearleads/app-health/clientEntry', async () => {
  const actual = await vi.importActual<
    typeof import('@tearleads/app-health/clientEntry')
  >('@tearleads/app-health/clientEntry');

  return {
    ...actual,
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

  it('renders children inside HealthRuntimeProvider', () => {
    render(
      <ClientHealthProvider>
        <div data-testid="child">Child content</div>
      </ClientHealthProvider>
    );

    expect(screen.getByTestId('health-runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('passes database state and inline unlock to the runtime provider', () => {
    render(
      <ClientHealthProvider>
        <div>Child</div>
      </ClientHealthProvider>
    );

    if (!lastProviderProps) {
      throw new Error('Expected HealthRuntimeProvider props to be captured');
    }

    expect(lastProviderProps.databaseState).toEqual({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'instance-a'
    });
    expect(lastProviderProps.InlineUnlock).toBe(InlineUnlock);
  });

  it('rebinds tracker creation to the active database context', () => {
    const { rerender } = render(
      <ClientHealthProvider>
        <div>Child</div>
      </ClientHealthProvider>
    );

    if (!lastProviderProps) {
      throw new Error('Expected HealthRuntimeProvider props to be captured');
    }

    expect(lastProviderProps.createTracker()).toEqual({ db: mockDbA });
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

    if (!lastProviderProps) {
      throw new Error('Expected HealthRuntimeProvider props to be captured');
    }

    expect(lastProviderProps.databaseState).toEqual({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'instance-b'
    });
    expect(lastProviderProps.createTracker()).toEqual({ db: mockDbB });
    expect(mockCreateHealthTracker).toHaveBeenLastCalledWith(mockDbB);
  });
});
