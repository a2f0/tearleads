import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VehiclesWindowNew } from './VehiclesWindowNew';

const mockUseDatabaseContext = vi.fn();
const mockCreateVehicle = vi.fn();

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@/db/vehicles', () => ({
  createVehicle: (data: unknown) => mockCreateVehicle(data)
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock {description}</div>
  )
}));

describe('VehiclesWindowNew', () => {
  const defaultProps = {
    onCreated: vi.fn(),
    onCancel: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });
    mockCreateVehicle.mockResolvedValue({
      id: 'new-vehicle-id',
      make: 'Tesla',
      model: 'Model Y',
      year: 2024,
      color: 'Midnight Silver',
      createdAt: new Date(),
      updatedAt: new Date()
    });
  });

  it('renders loading state when database is loading', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: false,
      isLoading: true
    });
    render(<VehiclesWindowNew {...defaultProps} />);
    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('renders unlock prompt when database is locked', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: false,
      isLoading: false
    });
    render(<VehiclesWindowNew {...defaultProps} />);
    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('renders new vehicle form when unlocked', () => {
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

  it('calls onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<VehiclesWindowNew {...defaultProps} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalled();
  });

  it('creates vehicle with valid input', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<VehiclesWindowNew {...defaultProps} onCreated={onCreated} />);

    await user.type(screen.getByLabelText('Make'), 'Tesla');
    await user.type(screen.getByLabelText('Model'), 'Model Y');
    await user.type(screen.getByLabelText('Year'), '2024');
    await user.type(screen.getByLabelText('Color'), 'Midnight Silver');

    await user.click(screen.getByRole('button', { name: 'Create Vehicle' }));

    await waitFor(() => {
      expect(mockCreateVehicle).toHaveBeenCalledWith({
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

  it('shows validation error for invalid year', async () => {
    const user = userEvent.setup();
    render(<VehiclesWindowNew {...defaultProps} />);

    await user.type(screen.getByLabelText('Make'), 'Tesla');
    await user.type(screen.getByLabelText('Model'), 'Model Y');
    await user.type(screen.getByLabelText('Year'), 'invalid');

    await user.click(screen.getByRole('button', { name: 'Create Vehicle' }));

    await waitFor(() => {
      expect(mockCreateVehicle).not.toHaveBeenCalled();
    });
  });

  it('shows error when create fails', async () => {
    const user = userEvent.setup();
    mockCreateVehicle.mockResolvedValue(null);
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

  it('creates vehicle with optional year empty', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    mockCreateVehicle.mockResolvedValue({
      id: 'new-vehicle-id',
      make: 'Tesla',
      model: 'Model Y',
      year: null,
      color: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    render(<VehiclesWindowNew {...defaultProps} onCreated={onCreated} />);

    await user.type(screen.getByLabelText('Make'), 'Tesla');
    await user.type(screen.getByLabelText('Model'), 'Model Y');

    await user.click(screen.getByRole('button', { name: 'Create Vehicle' }));

    await waitFor(() => {
      expect(mockCreateVehicle).toHaveBeenCalled();
      const callArg = mockCreateVehicle.mock.calls[0]?.[0] as {
        make: string;
        model: string;
        year: number | null;
        color: string | null;
      };
      expect(callArg?.make).toBe('Tesla');
      expect(callArg?.model).toBe('Model Y');
      expect(callArg?.year).toBeNull();
      expect(onCreated).toHaveBeenCalledWith('new-vehicle-id');
    });
  });

  it('shows creating button text while saving', async () => {
    const user = userEvent.setup();
    mockCreateVehicle.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        id: 'new-vehicle-id',
        make: 'Tesla',
        model: 'Model Y',
        year: null,
        color: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
    });

    render(<VehiclesWindowNew {...defaultProps} />);

    await user.type(screen.getByLabelText('Make'), 'Tesla');
    await user.type(screen.getByLabelText('Model'), 'Model Y');

    const createButton = screen.getByRole('button', { name: 'Create Vehicle' });
    await user.click(createButton);

    expect(screen.getByText('Creating...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText('Creating...')).not.toBeInTheDocument();
    });
  });
});
