import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createVehicle,
  deleteVehicle,
  listVehicles,
  updateVehicle,
  type VehicleRecord
} from '@/db/vehicles';
import { VehiclesManager } from './VehiclesManager';

vi.mock('@/db/vehicles', () => ({
  listVehicles: vi.fn(),
  createVehicle: vi.fn(),
  updateVehicle: vi.fn(),
  deleteVehicle: vi.fn()
}));

const mockListVehicles = vi.mocked(listVehicles);
const mockCreateVehicle = vi.mocked(createVehicle);
const mockUpdateVehicle = vi.mocked(updateVehicle);
const mockDeleteVehicle = vi.mocked(deleteVehicle);

const BASE_VEHICLE: VehicleRecord = {
  id: 'vehicle-1',
  make: 'Tesla',
  model: 'Model Y',
  year: 2024,
  color: 'Blue',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-02T00:00:00.000Z')
};

describe('VehiclesManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListVehicles.mockResolvedValue([]);
  });

  it('renders empty state when there are no vehicles', async () => {
    render(<VehiclesManager />);

    expect(await screen.findByText('No vehicles yet')).toBeInTheDocument();
    expect(
      screen.getByText('Add your first vehicle above.')
    ).toBeInTheDocument();
  });

  it('creates and renders a vehicle', async () => {
    mockListVehicles
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([BASE_VEHICLE]);
    mockCreateVehicle.mockResolvedValue(BASE_VEHICLE);

    const user = userEvent.setup();
    render(<VehiclesManager />);

    await user.type(screen.getByLabelText('Make'), 'Tesla');
    await user.type(screen.getByLabelText('Model'), 'Model Y');
    await user.type(screen.getByLabelText('Year'), '2024');
    await user.type(screen.getByLabelText('Color'), 'Blue');
    await user.click(screen.getByRole('button', { name: 'Save Vehicle' }));

    expect(mockCreateVehicle).toHaveBeenCalledWith({
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
    const user = userEvent.setup();
    render(<VehiclesManager />);

    await user.type(screen.getByLabelText('Make'), 'Tesla');
    await user.type(screen.getByLabelText('Model'), 'Model Y');
    await user.type(screen.getByLabelText('Year'), '2024.5');
    await user.click(screen.getByRole('button', { name: 'Save Vehicle' }));

    expect(
      await screen.findByText('Year must be a whole number')
    ).toBeInTheDocument();
    expect(mockCreateVehicle).not.toHaveBeenCalled();
  });

  it('loads an existing vehicle into the form and updates it', async () => {
    const updatedVehicle: VehicleRecord = {
      ...BASE_VEHICLE,
      model: 'Model Y Performance',
      year: 2025,
      color: 'Midnight Silver',
      updatedAt: new Date('2024-01-03T00:00:00.000Z')
    };

    mockListVehicles
      .mockResolvedValueOnce([BASE_VEHICLE])
      .mockResolvedValueOnce([updatedVehicle]);
    mockUpdateVehicle.mockResolvedValue(updatedVehicle);

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

    expect(mockUpdateVehicle).toHaveBeenCalledWith('vehicle-1', {
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
    mockListVehicles
      .mockResolvedValueOnce([BASE_VEHICLE])
      .mockResolvedValueOnce([]);
    mockDeleteVehicle.mockResolvedValue(true);

    const user = userEvent.setup();
    render(<VehiclesManager />);

    expect(await screen.findByText('Model Y')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Delete Tesla Model Y' })
    );

    expect(mockDeleteVehicle).toHaveBeenCalledWith('vehicle-1');

    await waitFor(() => {
      expect(screen.getByText('No vehicles yet')).toBeInTheDocument();
    });
  });
});
