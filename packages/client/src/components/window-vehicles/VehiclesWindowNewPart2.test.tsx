import type { VehicleRecord, VehicleRepository } from '@tearleads/vehicles';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VehiclesWindowNew } from './VehiclesWindowNew';

const mockUseVehiclesRuntime = vi.fn();

let instanceChangeCallback:
  | ((newInstanceId: string | null, previousInstanceId: string | null) => void)
  | null = null;

vi.mock('@tearleads/vehicles', async () => {
  const actual = await vi.importActual<typeof import('@tearleads/vehicles')>(
    '@tearleads/vehicles'
  );

  return {
    ...actual,
    useVehiclesRuntime: () => mockUseVehiclesRuntime()
  };
});

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
    id: 'new-vehicle-id',
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
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

describe('VehiclesWindowNew part 2', () => {
  const defaultProps = {
    onCreated: vi.fn(),
    onCancel: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    instanceChangeCallback = null;
    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          createVehicle: vi.fn(async () => createVehicle())
        })
      })
    );
  });

  it('shows repository error messages when create throws an Error', async () => {
    const user = userEvent.setup();
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          createVehicle: vi.fn(async () => {
            throw new Error('Create exploded');
          })
        })
      })
    );

    try {
      render(<VehiclesWindowNew {...defaultProps} />);

      await user.type(screen.getByLabelText('Make'), 'Tesla');
      await user.type(screen.getByLabelText('Model'), 'Model Y');
      await user.click(screen.getByRole('button', { name: 'Create Vehicle' }));

      await waitFor(() => {
        expect(screen.getByText('Create exploded')).toBeInTheDocument();
      });
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('falls back to a generic error when create throws a non-Error value', async () => {
    const user = userEvent.setup();
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          createVehicle: vi.fn(async () => {
            throw new (class VehicleCreateFailure {})();
          })
        })
      })
    );

    try {
      render(<VehiclesWindowNew {...defaultProps} />);

      await user.type(screen.getByLabelText('Make'), 'Tesla');
      await user.type(screen.getByLabelText('Model'), 'Model Y');
      await user.click(screen.getByRole('button', { name: 'Create Vehicle' }));

      await waitFor(() => {
        expect(screen.getByText('Failed to create')).toBeInTheDocument();
      });
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('routes creates to the active instance after a switch', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const staleRepository = createRepository({
      createVehicle: vi.fn(async () => createVehicle({ id: 'stale-vehicle' }))
    });
    const activeRepository = createRepository({
      createVehicle: vi.fn(async () => createVehicle({ id: 'active-vehicle' }))
    });

    let runtime = createRuntime({
      databaseState: { currentInstanceId: 'instance-a' },
      repository: staleRepository
    });

    mockUseVehiclesRuntime.mockImplementation(() => runtime);

    const { rerender } = render(
      <VehiclesWindowNew {...defaultProps} onCreated={onCreated} />
    );

    runtime = createRuntime({
      databaseState: { currentInstanceId: 'instance-b' },
      repository: activeRepository
    });

    await act(async () => {
      rerender(<VehiclesWindowNew {...defaultProps} onCreated={onCreated} />);
      instanceChangeCallback?.('instance-b', 'instance-a');
    });

    await user.type(screen.getByLabelText('Make'), 'Ford');
    await user.type(screen.getByLabelText('Model'), 'F-150');
    await user.click(screen.getByRole('button', { name: 'Create Vehicle' }));

    await waitFor(() => {
      expect(staleRepository.createVehicle).not.toHaveBeenCalled();
      expect(activeRepository.createVehicle).toHaveBeenCalledWith({
        make: 'Ford',
        model: 'F-150',
        year: null,
        color: null
      });
      expect(onCreated).toHaveBeenCalledWith('active-vehicle');
    });
  });

  it('ignores stale create success after an instance switch', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const pendingCreate = createDeferred<VehicleRecord | null>();

    let runtime = createRuntime({
      databaseState: { currentInstanceId: 'instance-a' },
      repository: createRepository({
        createVehicle: vi.fn(() => pendingCreate.promise)
      })
    });

    mockUseVehiclesRuntime.mockImplementation(() => runtime);

    const { rerender } = render(
      <VehiclesWindowNew {...defaultProps} onCreated={onCreated} />
    );

    await user.type(screen.getByLabelText('Make'), 'Tesla');
    await user.type(screen.getByLabelText('Model'), 'Model Y');
    await user.click(screen.getByRole('button', { name: 'Create Vehicle' }));

    runtime = createRuntime({
      databaseState: { currentInstanceId: 'instance-b' }
    });

    await act(async () => {
      rerender(<VehiclesWindowNew {...defaultProps} onCreated={onCreated} />);
      instanceChangeCallback?.('instance-b', 'instance-a');
    });

    await act(async () => {
      pendingCreate.resolve(createVehicle({ id: 'stale-vehicle-id' }));
      await Promise.resolve();
    });

    expect(onCreated).not.toHaveBeenCalled();
  });

  it('ignores stale create failures after an instance switch', async () => {
    const user = userEvent.setup();
    const pendingCreate = createDeferred<VehicleRecord | null>();
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    let runtime = createRuntime({
      databaseState: { currentInstanceId: 'instance-a' },
      repository: createRepository({
        createVehicle: vi.fn(() => pendingCreate.promise)
      })
    });

    mockUseVehiclesRuntime.mockImplementation(() => runtime);

    const { rerender } = render(<VehiclesWindowNew {...defaultProps} />);

    try {
      await user.type(screen.getByLabelText('Make'), 'Tesla');
      await user.type(screen.getByLabelText('Model'), 'Model Y');
      await user.click(screen.getByRole('button', { name: 'Create Vehicle' }));

      runtime = createRuntime({
        databaseState: { currentInstanceId: 'instance-b' }
      });

      await act(async () => {
        rerender(<VehiclesWindowNew {...defaultProps} />);
        instanceChangeCallback?.('instance-b', 'instance-a');
      });

      await act(async () => {
        pendingCreate.reject(new Error('stale failure'));
        await Promise.resolve();
      });

      expect(screen.queryByText('stale failure')).not.toBeInTheDocument();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
