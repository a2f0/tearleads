import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { VehicleRecord, VehicleRepository } from '@tearleads/vehicles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VehiclesWindowList } from './VehiclesWindowList';

const mockUseVehiclesRuntime = vi.fn();
const mockUseVirtualizer = vi.fn();

let instanceChangeCallback:
  | ((newInstanceId: string | null, previousInstanceId: string | null) => void)
  | null = null;

vi.mock('@tearleads/vehicles', async () => {
  const actual =
    await vi.importActual<typeof import('@tearleads/vehicles')>(
      '@tearleads/vehicles'
    );

  return {
    ...actual,
    useVehiclesRuntime: () => mockUseVehiclesRuntime()
  };
});

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => mockUseVirtualizer()
}));

vi.mock('@/hooks/app', () => ({
  useOnInstanceChange: (
    callback: (
      newInstanceId: string | null,
      previousInstanceId: string | null
    ) => void
  ) => {
    instanceChangeCallback = callback;
  }
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock {description}</div>
  )
}));

interface VehiclesRuntimeState {
  databaseState: {
    isUnlocked: boolean;
    isLoading: boolean;
    currentInstanceId: string | null;
  };
  repository: VehicleRepository | null;
}

function createRepository(
  overrides: Partial<VehicleRepository> = {}
): VehicleRepository {
  return {
    getVehicleById: vi.fn(async () => null),
    listVehicles: vi.fn(async () => []),
    createVehicle: vi.fn(async () => null),
    updateVehicle: vi.fn(async () => null),
    deleteVehicle: vi.fn(async () => false),
    ...overrides
  };
}

function createRuntime(
  overrides: Partial<VehiclesRuntimeState> = {}
): VehiclesRuntimeState {
  return {
    databaseState: {
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'instance-a',
      ...overrides.databaseState
    },
    repository: overrides.repository ?? createRepository()
  };
}

function createVehicle(overrides: Partial<VehicleRecord> = {}): VehicleRecord {
  return {
    id: 'vehicle-1',
    make: 'Tesla',
    model: 'Model Y',
    year: 2024,
    color: 'Midnight Silver',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    ...overrides
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe('VehiclesWindowList', () => {
  const defaultProps = {
    onSelectVehicle: vi.fn(),
    onCreateVehicle: vi.fn(),
    refreshToken: 0,
    onRefresh: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    instanceChangeCallback = null;
    mockUseVirtualizer.mockReturnValue({
      getVirtualItems: () => [{ index: 0, start: 0 }],
      getTotalSize: () => 56,
      measureElement: vi.fn()
    });

    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          listVehicles: vi.fn(async () => [createVehicle()]),
          deleteVehicle: vi.fn(async () => true)
        })
      })
    );
  });

  it('renders loading state when database is loading', () => {
    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        databaseState: {
          isUnlocked: false,
          isLoading: true,
          currentInstanceId: null
        }
      })
    );

    render(<VehiclesWindowList {...defaultProps} />);

    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('renders unlock prompt when database is locked', () => {
    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        databaseState: {
          isUnlocked: false,
          isLoading: false,
          currentInstanceId: null
        },
        repository: null
      })
    );

    render(<VehiclesWindowList {...defaultProps} />);

    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('renders empty state when no vehicles exist', async () => {
    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          listVehicles: vi.fn(async () => [])
        })
      })
    );

    render(<VehiclesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('No vehicles yet')).toBeInTheDocument();
    });
  });

  it('renders vehicle list data', async () => {
    render(<VehiclesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('2024 Tesla Model Y')).toBeInTheDocument();
    });
  });

  it('shows secondary info with color', async () => {
    render(<VehiclesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Midnight Silver')).toBeInTheDocument();
    });
  });

  it('calls onSelectVehicle when clicking a vehicle row', async () => {
    const onSelectVehicle = vi.fn();

    render(
      <VehiclesWindowList {...defaultProps} onSelectVehicle={onSelectVehicle} />
    );

    await waitFor(() => {
      expect(screen.getByText('2024 Tesla Model Y')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('2024 Tesla Model Y'));

    expect(onSelectVehicle).toHaveBeenCalledWith('vehicle-1');
  });

  it('calls onCreateVehicle when create button is clicked', async () => {
    const onCreateVehicle = vi.fn();

    render(
      <VehiclesWindowList {...defaultProps} onCreateVehicle={onCreateVehicle} />
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('window-create-vehicle-button')
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('window-create-vehicle-button'));

    expect(onCreateVehicle).toHaveBeenCalled();
  });

  it('opens a context menu on right click', async () => {
    render(<VehiclesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('2024 Tesla Model Y')).toBeInTheDocument();
    });

    const vehicleButton = screen.getByText('2024 Tesla Model Y').closest('div');
    if (vehicleButton) {
      fireEvent.contextMenu(vehicleButton);
    }

    expect(screen.getByTestId('context-menu-view')).toBeInTheDocument();
    expect(screen.getByTestId('context-menu-delete')).toBeInTheDocument();
  });

  it('selects a vehicle from the context menu', async () => {
    const onSelectVehicle = vi.fn();

    render(
      <VehiclesWindowList {...defaultProps} onSelectVehicle={onSelectVehicle} />
    );

    await waitFor(() => {
      expect(screen.getByText('2024 Tesla Model Y')).toBeInTheDocument();
    });

    const vehicleButton = screen.getByText('2024 Tesla Model Y').closest('div');
    if (vehicleButton) {
      fireEvent.contextMenu(vehicleButton);
    }

    fireEvent.click(screen.getByTestId('context-menu-view'));

    expect(onSelectVehicle).toHaveBeenCalledWith('vehicle-1');
  });

  it('deletes a vehicle from the context menu', async () => {
    const deleteVehicle = vi.fn(async () => true);

    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          listVehicles: vi.fn(async () => [createVehicle()]),
          deleteVehicle
        })
      })
    );

    render(<VehiclesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('2024 Tesla Model Y')).toBeInTheDocument();
    });

    const vehicleButton = screen.getByText('2024 Tesla Model Y').closest('div');
    if (vehicleButton) {
      fireEvent.contextMenu(vehicleButton);
    }

    fireEvent.click(screen.getByTestId('context-menu-delete'));

    await waitFor(() => {
      expect(deleteVehicle).toHaveBeenCalledWith('vehicle-1');
    });
  });

  it('filters vehicles by the search query', async () => {
    mockUseVirtualizer.mockReturnValue({
      getVirtualItems: () => [
        { index: 0, start: 0 },
        { index: 1, start: 56 }
      ],
      getTotalSize: () => 112,
      measureElement: vi.fn()
    });

    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          listVehicles: vi.fn(async () => [
            createVehicle({ color: 'Silver' }),
            createVehicle({
              id: 'vehicle-2',
              make: 'Ford',
              model: 'F-150',
              year: 2023,
              color: 'Blue'
            })
          ])
        })
      })
    );

    render(<VehiclesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('2024 Tesla Model Y')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('window-vehicles-search');
    fireEvent.change(searchInput, { target: { value: 'Tesla' } });

    expect(searchInput).toHaveValue('Tesla');
  });

  it('focuses the search input on render', async () => {
    render(<VehiclesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByTestId('window-vehicles-search')
      );
    });
  });

  it('shows an empty-state context menu on right click', async () => {
    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          listVehicles: vi.fn(async () => [])
        })
      })
    );

    render(<VehiclesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('No vehicles yet')).toBeInTheDocument();
    });

    const emptyState = screen.getByText('No vehicles yet').closest('div');
    if (emptyState) {
      fireEvent.contextMenu(emptyState);
    }

    expect(screen.getByTestId('context-menu-new-vehicle')).toBeInTheDocument();
  });

  it('creates a vehicle from the empty-state context menu', async () => {
    const onCreateVehicle = vi.fn();

    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          listVehicles: vi.fn(async () => [])
        })
      })
    );

    render(
      <VehiclesWindowList {...defaultProps} onCreateVehicle={onCreateVehicle} />
    );

    await waitFor(() => {
      expect(screen.getByText('No vehicles yet')).toBeInTheDocument();
    });

    const emptyState = screen.getByText('No vehicles yet').closest('div');
    if (emptyState) {
      fireEvent.contextMenu(emptyState);
    }

    fireEvent.click(screen.getByTestId('context-menu-new-vehicle'));

    expect(onCreateVehicle).toHaveBeenCalled();
  });

  it('ignores stale list results after an instance switch', async () => {
    const staleFetch = createDeferred<VehicleRecord[]>();
    const activeFetch = createDeferred<VehicleRecord[]>();

    const staleRepository = createRepository({
      listVehicles: vi.fn(() => staleFetch.promise)
    });
    const activeRepository = createRepository({
      listVehicles: vi.fn(() => activeFetch.promise)
    });

    let runtime = createRuntime({
      databaseState: { currentInstanceId: 'instance-a' },
      repository: staleRepository
    });

    mockUseVehiclesRuntime.mockImplementation(() => runtime);

    const { rerender } = render(<VehiclesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(staleRepository.listVehicles).toHaveBeenCalledTimes(1);
    });

    runtime = createRuntime({
      databaseState: { currentInstanceId: 'instance-b' },
      repository: activeRepository
    });

    await act(async () => {
      rerender(<VehiclesWindowList {...defaultProps} />);
      instanceChangeCallback?.('instance-b', 'instance-a');
    });

    await waitFor(() => {
      expect(activeRepository.listVehicles).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      staleFetch.resolve([createVehicle()]);
      await Promise.resolve();
    });

    expect(screen.queryByText('2024 Tesla Model Y')).not.toBeInTheDocument();

    await act(async () => {
      activeFetch.resolve([
        createVehicle({
          id: 'vehicle-2',
          make: 'Ford',
          model: 'F-150',
          year: 2023,
          color: 'Blue'
        })
      ]);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText('2023 Ford F-150')).toBeInTheDocument();
    });
  });
});
