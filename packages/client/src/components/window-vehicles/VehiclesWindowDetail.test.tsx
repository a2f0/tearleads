import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VehiclesWindowDetail } from './VehiclesWindowDetail';

const mockUseDatabaseContext = vi.fn();
const mockGetVehicleById = vi.fn();
const mockUpdateVehicle = vi.fn();
const mockDeleteVehicle = vi.fn();

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@/db/vehicles', () => ({
  getVehicleById: (id: string) => mockGetVehicleById(id),
  updateVehicle: (id: string, data: unknown) => mockUpdateVehicle(id, data),
  deleteVehicle: (id: string) => mockDeleteVehicle(id)
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock {description}</div>
  )
}));

describe('VehiclesWindowDetail', () => {
  const mockVehicle = {
    id: 'vehicle-1',
    make: 'Tesla',
    model: 'Model Y',
    year: 2024,
    color: 'Midnight Silver',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-15')
  };

  const defaultProps = {
    vehicleId: 'vehicle-1',
    onDeleted: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });
    mockGetVehicleById.mockResolvedValue(mockVehicle);
    mockUpdateVehicle.mockResolvedValue(mockVehicle);
    mockDeleteVehicle.mockResolvedValue(true);
  });

  it('renders loading state when database is loading', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: false,
      isLoading: true
    });
    render(<VehiclesWindowDetail {...defaultProps} />);
    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('renders unlock prompt when database is locked', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: false,
      isLoading: false
    });
    render(<VehiclesWindowDetail {...defaultProps} />);
    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('renders vehicle not found error', async () => {
    mockGetVehicleById.mockResolvedValue(null);
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

  it('switches to edit mode when edit button is clicked', async () => {
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

  it('cancels edit and restores original values', async () => {
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

  it('saves changes when save button is clicked', async () => {
    const user = userEvent.setup();
    const updatedVehicle = { ...mockVehicle, make: 'Ford' };
    mockUpdateVehicle.mockResolvedValue(updatedVehicle);

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
      expect(mockUpdateVehicle).toHaveBeenCalled();
    });
  });

  it('shows validation errors on invalid input', async () => {
    const user = userEvent.setup();
    render(<VehiclesWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('vehicle-edit-button')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('vehicle-edit-button'));

    const makeInput = screen.getByLabelText('Make');
    await user.clear(makeInput);

    const modelInput = screen.getByLabelText('Model');
    await user.clear(modelInput);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByText('Make is required')).toBeInTheDocument();
    });
  });

  it('opens delete confirmation dialog', async () => {
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

  it('cancels delete when cancel button is clicked', async () => {
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

  it('deletes vehicle when confirmed', async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    render(<VehiclesWindowDetail {...defaultProps} onDeleted={onDeleted} />);

    await waitFor(() => {
      expect(screen.getByTestId('vehicle-delete-button')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('vehicle-delete-button'));
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    await user.click(deleteButtons[1] as HTMLElement);

    await waitFor(() => {
      expect(mockDeleteVehicle).toHaveBeenCalledWith('vehicle-1');
      expect(onDeleted).toHaveBeenCalled();
    });
  });

  it('displays "Not specified" for null year', async () => {
    mockGetVehicleById.mockResolvedValue({ ...mockVehicle, year: null });
    render(<VehiclesWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Not specified')).toBeInTheDocument();
    });
  });

  it('displays "Not specified" for null color', async () => {
    mockGetVehicleById.mockResolvedValue({ ...mockVehicle, color: null });
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
