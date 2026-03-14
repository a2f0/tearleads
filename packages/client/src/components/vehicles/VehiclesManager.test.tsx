import type { VehicleRecord, VehicleRepository } from '@tearleads/app-vehicles';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VehiclesManager } from './VehiclesManager';

const mockUseVehiclesRuntime = vi.fn();

let _instanceChangeCallback:
  | ((newInstanceId: string | null, previousInstanceId: string | null) => void)
  | null = null;

vi.mock('@tearleads/app-vehicles', async () => {
  const actual = await import('@tearleads/app-vehicles');

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
    color: 'Blue',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    ...overrides
  };
}

const BASE_VEHICLE = createVehicle();

describe('VehiclesManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _instanceChangeCallback = null;
    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          listVehicles: vi.fn(async () => [])
        })
      })
    );
  });

  it('renders an empty state when there are no vehicles', async () => {
    render(<VehiclesManager />);

    expect(await screen.findByText('No vehicles yet')).toBeInTheDocument();
    expect(
      screen.getByText('Add your first vehicle above.')
    ).toBeInTheDocument();
  });

  it('creates and renders a vehicle', async () => {
    const listVehicles = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([BASE_VEHICLE]);
    const createVehicleFn = vi.fn(async () => BASE_VEHICLE);

    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          listVehicles,
          createVehicle: createVehicleFn
        })
      })
    );

    const user = userEvent.setup();
    render(<VehiclesManager />);

    await user.type(screen.getByLabelText('Make'), 'Tesla');
    await user.type(screen.getByLabelText('Model'), 'Model Y');
    await user.type(screen.getByLabelText('Year'), '2024');
    await user.type(screen.getByLabelText('Color'), 'Blue');
    await user.click(screen.getByRole('button', { name: 'Save Vehicle' }));

    expect(createVehicleFn).toHaveBeenCalledWith({
      make: 'Tesla',
      model: 'Model Y',
      year: 2024,
      color: 'Blue'
    });

    await waitFor(() => {
      expect(screen.getByText('Tesla')).toBeInTheDocument();
      expect(screen.getByText('Model Y')).toBeInTheDocument();
    });
  });

  it('shows year validation errors before save', async () => {
    const createVehicleFn = vi.fn(async () => BASE_VEHICLE);

    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          listVehicles: vi.fn(async () => []),
          createVehicle: createVehicleFn
        })
      })
    );

    const user = userEvent.setup();

    render(<VehiclesManager />);

    await user.type(screen.getByLabelText('Make'), 'Tesla');
    await user.type(screen.getByLabelText('Model'), 'Model Y');
    await user.type(screen.getByLabelText('Year'), '2024.5');
    await user.click(screen.getByRole('button', { name: 'Save Vehicle' }));

    expect(
      await screen.findByText('Year must be a whole number')
    ).toBeInTheDocument();
    expect(createVehicleFn).not.toHaveBeenCalled();
  });

  it('loads an existing vehicle into the form and updates it', async () => {
    const updatedVehicle = createVehicle({
      model: 'Model Y Performance',
      year: 2025,
      color: 'Midnight Silver',
      updatedAt: new Date('2024-01-03T00:00:00.000Z')
    });
    const listVehicles = vi
      .fn()
      .mockResolvedValueOnce([BASE_VEHICLE])
      .mockResolvedValueOnce([updatedVehicle]);
    const updateVehicleFn = vi.fn(async () => updatedVehicle);

    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          listVehicles,
          updateVehicle: updateVehicleFn
        })
      })
    );

    const user = userEvent.setup();
    render(<VehiclesManager />);

    expect(await screen.findByText('Model Y')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Edit Tesla Model Y' })
    );

    const modelInput = screen.getByLabelText('Model');
    await user.clear(modelInput);
    await user.type(modelInput, 'Model Y Performance');

    const yearInput = screen.getByLabelText('Year');
    await user.clear(yearInput);
    await user.type(yearInput, '2025');

    const colorInput = screen.getByLabelText('Color');
    await user.clear(colorInput);
    await user.type(colorInput, 'Midnight Silver');

    await user.click(screen.getByRole('button', { name: 'Update Vehicle' }));

    expect(updateVehicleFn).toHaveBeenCalledWith('vehicle-1', {
      make: 'Tesla',
      model: 'Model Y Performance',
      year: 2025,
      color: 'Midnight Silver'
    });

    await waitFor(() => {
      expect(screen.getByText('Model Y Performance')).toBeInTheDocument();
    });
  });

  it('deletes a vehicle', async () => {
    const listVehicles = vi
      .fn()
      .mockResolvedValueOnce([BASE_VEHICLE])
      .mockResolvedValueOnce([]);
    const deleteVehicleFn = vi.fn(async () => true);

    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          listVehicles,
          deleteVehicle: deleteVehicleFn
        })
      })
    );

    const user = userEvent.setup();
    render(<VehiclesManager />);

    expect(await screen.findByText('Model Y')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Delete Tesla Model Y' })
    );

    expect(deleteVehicleFn).toHaveBeenCalledWith('vehicle-1');

    await waitFor(() => {
      expect(screen.getByText('No vehicles yet')).toBeInTheDocument();
    });
  });

  it('displays N/A for null year and color', async () => {
    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          listVehicles: vi.fn(async () => [
            createVehicle({ year: null, color: null })
          ])
        })
      })
    );

    render(<VehiclesManager />);

    await waitFor(() => {
      const naCells = screen.getAllByText('N/A');
      expect(naCells).toHaveLength(2);
    });
  });

  it('sorts vehicles by updatedAt, then make, then model', async () => {
    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          listVehicles: vi.fn(async () => [
            createVehicle({
              id: 'vehicle-1',
              make: 'Tesla',
              model: 'Model S',
              updatedAt: new Date('2024-01-01T00:00:00.000Z')
            }),
            createVehicle({
              id: 'vehicle-2',
              make: 'Tesla',
              model: 'Model 3',
              updatedAt: new Date('2024-01-01T00:00:00.000Z')
            }),
            createVehicle({
              id: 'vehicle-3',
              make: 'Ford',
              model: 'Mustang',
              updatedAt: new Date('2024-01-01T00:00:00.000Z')
            })
          ])
        })
      })
    );

    render(<VehiclesManager />);

    const table = await screen.findByTestId('vehicles-table');
    const rows = table.querySelectorAll('tbody tr');

    expect(rows[0]).toHaveTextContent('Ford');
    expect(rows[1]).toHaveTextContent('Model 3');
    expect(rows[2]).toHaveTextContent('Model S');
  });

  it('shows a form error when save fails', async () => {
    const createVehicleFn = vi.fn(async () => null);

    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          listVehicles: vi.fn(async () => []),
          createVehicle: createVehicleFn
        })
      })
    );

    const user = userEvent.setup();
    render(<VehiclesManager />);

    await user.type(screen.getByLabelText('Make'), 'Tesla');
    await user.type(screen.getByLabelText('Model'), 'Model Y');
    await user.click(screen.getByRole('button', { name: 'Save Vehicle' }));

    expect(
      await screen.findByText(
        'Unable to save vehicle right now. Please try again.'
      )
    ).toBeInTheDocument();
  });

  it('resets the form when deleting the selected vehicle', async () => {
    const listVehicles = vi
      .fn()
      .mockResolvedValueOnce([BASE_VEHICLE])
      .mockResolvedValueOnce([]);
    const deleteVehicleFn = vi.fn(async () => true);

    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          listVehicles,
          deleteVehicle: deleteVehicleFn
        })
      })
    );

    const user = userEvent.setup();
    render(<VehiclesManager />);

    await screen.findByText('Model Y');
    await user.click(
      screen.getByRole('button', { name: 'Edit Tesla Model Y' })
    );

    expect(screen.getByLabelText('Make')).toHaveValue('Tesla');

    await user.click(
      screen.getByRole('button', { name: 'Delete Tesla Model Y' })
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Make')).toHaveValue('');
    });
  });

  it('shows make validation errors', async () => {
    const user = userEvent.setup();

    render(<VehiclesManager />);

    await user.type(screen.getByLabelText('Model'), 'Model Y');
    await user.click(screen.getByRole('button', { name: 'Save Vehicle' }));

    expect(await screen.findByText('Make is required')).toBeInTheDocument();
  });

  it('shows model validation errors', async () => {
    const user = userEvent.setup();

    render(<VehiclesManager />);

    await user.type(screen.getByLabelText('Make'), 'Tesla');
    await user.click(screen.getByRole('button', { name: 'Save Vehicle' }));

    expect(await screen.findByText('Model is required')).toBeInTheDocument();
  });

  it('clears the form when New Vehicle is clicked', async () => {
    mockUseVehiclesRuntime.mockReturnValue(
      createRuntime({
        repository: createRepository({
          listVehicles: vi.fn(async () => [BASE_VEHICLE])
        })
      })
    );

    const user = userEvent.setup();
    render(<VehiclesManager />);

    await screen.findByText('Model Y');
    await user.click(
      screen.getByRole('button', { name: 'Edit Tesla Model Y' })
    );

    expect(screen.getByLabelText('Make')).toHaveValue('Tesla');

    await user.click(screen.getByRole('button', { name: 'New Vehicle' }));

    expect(screen.getByLabelText('Make')).toHaveValue('');
    expect(screen.getByLabelText('Model')).toHaveValue('');
    expect(screen.getByLabelText('Year')).toHaveValue('');
    expect(screen.getByLabelText('Color')).toHaveValue('');
  });
});
