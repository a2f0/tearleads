import type { VehicleRecord, VehicleRepository } from '@tearleads/vehicles';
import { render, screen, waitFor } from '@testing-library/react';
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

describe('VehiclesWindowNew', () => {
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

  it('renders loading state when the database is loading', () => {
    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        databaseState: {
          isUnlocked: false,
          isLoading: true,
          currentInstanceId: null
        },
        repository: null
      })
    );

    render(<VehiclesWindowNew {...defaultProps} />);

    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('renders an unlock prompt when the database is locked', () => {
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

    render(<VehiclesWindowNew {...defaultProps} />);

    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('renders the new vehicle form when unlocked', () => {
    render(<VehiclesWindowNew {...defaultProps} />);

    expect(screen.getByText('New Vehicle')).toBeInTheDocument();
    expect(screen.getByLabelText('Make')).toBeInTheDocument();
    expect(screen.getByLabelText('Model')).toBeInTheDocument();
    expect(screen.getByLabelText('Year')).toBeInTheDocument();
    expect(screen.getByLabelText('Color')).toBeInTheDocument();
  });

  it('auto-focuses the make input', () => {
    render(<VehiclesWindowNew {...defaultProps} />);

    expect(document.activeElement).toBe(screen.getByLabelText('Make'));
  });

  it('calls onCancel when cancel is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(<VehiclesWindowNew {...defaultProps} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalled();
  });

  it('creates a vehicle with valid input', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const createVehicleFn = vi.fn(async () => createVehicle());

    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          createVehicle: createVehicleFn
        })
      })
    );

    render(<VehiclesWindowNew {...defaultProps} onCreated={onCreated} />);

    await user.type(screen.getByLabelText('Make'), 'Tesla');
    await user.type(screen.getByLabelText('Model'), 'Model Y');
    await user.type(screen.getByLabelText('Year'), '2024');
    await user.type(screen.getByLabelText('Color'), 'Midnight Silver');
    await user.click(screen.getByRole('button', { name: 'Create Vehicle' }));

    await waitFor(() => {
      expect(createVehicleFn).toHaveBeenCalledWith({
        make: 'Tesla',
        model: 'Model Y',
        year: 2024,
        color: 'Midnight Silver'
      });
      expect(onCreated).toHaveBeenCalledWith('new-vehicle-id');
    });
  });

  it('shows validation errors for missing required fields', async () => {
    const user = userEvent.setup();

    render(<VehiclesWindowNew {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'Create Vehicle' }));

    await waitFor(() => {
      expect(screen.getAllByText(/required/i).length).toBeGreaterThan(0);
    });
  });

  it('rejects invalid years before calling the repository', async () => {
    const user = userEvent.setup();
    const createVehicleFn = vi.fn(async () => createVehicle());

    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          createVehicle: createVehicleFn
        })
      })
    );

    render(<VehiclesWindowNew {...defaultProps} />);

    await user.type(screen.getByLabelText('Make'), 'Tesla');
    await user.type(screen.getByLabelText('Model'), 'Model Y');
    await user.type(screen.getByLabelText('Year'), 'invalid');
    await user.click(screen.getByRole('button', { name: 'Create Vehicle' }));

    await waitFor(() => {
      expect(createVehicleFn).not.toHaveBeenCalled();
    });
  });

  it('shows an error when create fails', async () => {
    const user = userEvent.setup();

    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          createVehicle: vi.fn(async () => null)
        })
      })
    );

    render(<VehiclesWindowNew {...defaultProps} />);

    await user.type(screen.getByLabelText('Make'), 'Tesla');
    await user.type(screen.getByLabelText('Model'), 'Model Y');
    await user.click(screen.getByRole('button', { name: 'Create Vehicle' }));

    await waitFor(() => {
      expect(
        screen.getByText(/Unable to create vehicle right now/i)
      ).toBeInTheDocument();
    });
  });

  it('shows an error when no repository is available', async () => {
    const user = userEvent.setup();

    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: null
      })
    );

    render(<VehiclesWindowNew {...defaultProps} />);

    await user.type(screen.getByLabelText('Make'), 'Tesla');
    await user.type(screen.getByLabelText('Model'), 'Model Y');
    await user.click(screen.getByRole('button', { name: 'Create Vehicle' }));

    await waitFor(() => {
      expect(
        screen.getByText(/Unable to create vehicle right now/i)
      ).toBeInTheDocument();
    });
  });

  it('renders mocked color validation errors', async () => {
    const user = userEvent.setup();
    const vehiclesModule = await import('@tearleads/vehicles');
    const normalizeVehicleProfileSpy = vi
      .spyOn(vehiclesModule, 'normalizeVehicleProfile')
      .mockReturnValue({
        ok: false,
        errors: [{ field: 'color', error: 'Color is invalid' }]
      });

    try {
      render(<VehiclesWindowNew {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: 'Create Vehicle' }));

      await waitFor(() => {
        expect(screen.getByText('Color is invalid')).toBeInTheDocument();
      });
    } finally {
      normalizeVehicleProfileSpy.mockRestore();
    }
  });

  it('creates a vehicle when year is left empty', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const createVehicleFn = vi.fn(async () =>
      createVehicle({
        year: null,
        color: null
      })
    );

    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          createVehicle: createVehicleFn
        })
      })
    );

    render(<VehiclesWindowNew {...defaultProps} onCreated={onCreated} />);

    await user.type(screen.getByLabelText('Make'), 'Tesla');
    await user.type(screen.getByLabelText('Model'), 'Model Y');
    await user.click(screen.getByRole('button', { name: 'Create Vehicle' }));

    await waitFor(() => {
      expect(createVehicleFn).toHaveBeenCalledWith({
        make: 'Tesla',
        model: 'Model Y',
        year: null,
        color: null
      });
      expect(onCreated).toHaveBeenCalledWith('new-vehicle-id');
    });
  });

  it('shows creating text while saving', async () => {
    const user = userEvent.setup();

    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          createVehicle: vi.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return createVehicle({ year: null, color: null });
          })
        })
      })
    );

    render(<VehiclesWindowNew {...defaultProps} />);

    await user.type(screen.getByLabelText('Make'), 'Tesla');
    await user.type(screen.getByLabelText('Model'), 'Model Y');
    await user.click(screen.getByRole('button', { name: 'Create Vehicle' }));

    expect(screen.getByText('Creating...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText('Creating...')).not.toBeInTheDocument();
    });
  });

});
