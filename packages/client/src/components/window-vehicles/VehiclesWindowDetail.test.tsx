import type { VehicleRecord, VehicleRepository } from '@tearleads/app-vehicles';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VehiclesWindowDetail } from './VehiclesWindowDetail';

const mockUseVehiclesRuntime = vi.fn();

let _instanceChangeCallback:
  | ((newInstanceId: string | null, previousInstanceId: string | null) => void)
  | null = null;

vi.mock('@tearleads/app-vehicles', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tearleads/app-vehicles')>();

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
    _instanceChangeCallback = callback;
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
    updatedAt: new Date('2024-01-15T00:00:00.000Z'),
    ...overrides
  };
}

describe('VehiclesWindowDetail', () => {
  const defaultProps = {
    vehicleId: 'vehicle-1',
    onDeleted: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    _instanceChangeCallback = null;

    const vehicle = createVehicle();

    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          getVehicleById: vi.fn(async () => vehicle),
          updateVehicle: vi.fn(async () => vehicle),
          deleteVehicle: vi.fn(async () => true)
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

    render(<VehiclesWindowDetail {...defaultProps} />);

    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('renders unlock prompt when the database is locked', () => {
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

    render(<VehiclesWindowDetail {...defaultProps} />);

    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('renders a vehicle not found error', async () => {
    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          getVehicleById: vi.fn(async () => null)
        })
      })
    );

    render(<VehiclesWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Vehicle not found')).toBeInTheDocument();
    });
  });

  it('displays vehicle details in view mode', async () => {
    render(<VehiclesWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('2024 Tesla Model Y')).toBeInTheDocument();
      expect(screen.getByText('Tesla')).toBeInTheDocument();
      expect(screen.getByText('Model Y')).toBeInTheDocument();
      expect(screen.getByText('2024')).toBeInTheDocument();
      expect(screen.getByText('Midnight Silver')).toBeInTheDocument();
    });
  });

  it('displays edit and delete buttons in view mode', async () => {
    render(<VehiclesWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('vehicle-edit-button')).toBeInTheDocument();
      expect(screen.getByTestId('vehicle-delete-button')).toBeInTheDocument();
    });
  });

  it('switches to edit mode when edit is clicked', async () => {
    const user = userEvent.setup();

    render(<VehiclesWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('vehicle-edit-button')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('vehicle-edit-button'));

    expect(screen.getByText('Edit Vehicle')).toBeInTheDocument();
    expect(screen.getByLabelText('Make')).toHaveValue('Tesla');
    expect(screen.getByLabelText('Model')).toHaveValue('Model Y');
    expect(screen.getByLabelText('Year')).toHaveValue('2024');
    expect(screen.getByLabelText('Color')).toHaveValue('Midnight Silver');
  });

  it('cancels edit and restores the original values', async () => {
    const user = userEvent.setup();

    render(<VehiclesWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('vehicle-edit-button')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('vehicle-edit-button'));

    const makeInput = screen.getByLabelText('Make');
    await user.clear(makeInput);
    await user.type(makeInput, 'Ford');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByText('Edit Vehicle')).not.toBeInTheDocument();
      expect(screen.getByText('Tesla')).toBeInTheDocument();
    });
  });

  it('saves changes when save is clicked', async () => {
    const user = userEvent.setup();
    const updatedVehicle = createVehicle({ make: 'Ford' });
    const updateVehicleFn = vi.fn(async () => updatedVehicle);

    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          getVehicleById: vi.fn(async () => createVehicle()),
          updateVehicle: updateVehicleFn,
          deleteVehicle: vi.fn(async () => true)
        })
      })
    );

    render(<VehiclesWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('vehicle-edit-button')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('vehicle-edit-button'));

    const makeInput = screen.getByLabelText('Make');
    await user.clear(makeInput);
    await user.type(makeInput, 'Ford');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateVehicleFn).toHaveBeenCalledWith('vehicle-1', {
        make: 'Ford',
        model: 'Model Y',
        year: 2024,
        color: 'Midnight Silver'
      });
    });
  });

  it('shows validation errors on invalid input', async () => {
    const user = userEvent.setup();

    render(<VehiclesWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('vehicle-edit-button')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('vehicle-edit-button'));
    await user.clear(screen.getByLabelText('Make'));
    await user.clear(screen.getByLabelText('Model'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByText('Make is required')).toBeInTheDocument();
    });
  });

  it('opens the delete confirmation dialog', async () => {
    const user = userEvent.setup();

    render(<VehiclesWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('vehicle-delete-button')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('vehicle-delete-button'));

    expect(screen.getByText('Delete Vehicle')).toBeInTheDocument();
    expect(
      screen.getByText(/Are you sure you want to delete this vehicle/i)
    ).toBeInTheDocument();
  });

  it('cancels delete when cancel is clicked', async () => {
    const user = userEvent.setup();

    render(<VehiclesWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('vehicle-delete-button')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('vehicle-delete-button'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(
      screen.queryByText(/Are you sure you want to delete/i)
    ).not.toBeInTheDocument();
  });

  it('deletes the vehicle when confirmed', async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    const deleteVehicleFn = vi.fn(async () => true);

    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          getVehicleById: vi.fn(async () => createVehicle()),
          updateVehicle: vi.fn(async () => createVehicle()),
          deleteVehicle: deleteVehicleFn
        })
      })
    );

    render(<VehiclesWindowDetail {...defaultProps} onDeleted={onDeleted} />);

    await waitFor(() => {
      expect(screen.getByTestId('vehicle-delete-button')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('vehicle-delete-button'));
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    await user.click(deleteButtons[1] as HTMLElement);

    await waitFor(() => {
      expect(deleteVehicleFn).toHaveBeenCalledWith('vehicle-1');
      expect(onDeleted).toHaveBeenCalled();
    });
  });

  it('displays Not specified for a null year', async () => {
    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          getVehicleById: vi.fn(async () => createVehicle({ year: null }))
        })
      })
    );

    render(<VehiclesWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Not specified')).toBeInTheDocument();
    });
  });

  it('displays Not specified for a null color', async () => {
    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          getVehicleById: vi.fn(async () => createVehicle({ color: null }))
        })
      })
    );

    render(<VehiclesWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Not specified')).toBeInTheDocument();
    });
  });

  it('displays created and updated dates', async () => {
    render(<VehiclesWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/Created:/)).toBeInTheDocument();
      expect(screen.getByText(/Updated:/)).toBeInTheDocument();
    });
  });
});
