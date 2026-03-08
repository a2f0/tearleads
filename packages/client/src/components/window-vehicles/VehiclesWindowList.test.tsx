import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VehiclesWindowList } from './VehiclesWindowList';

const mockUseDatabaseContext = vi.fn();
const mockListVehicles = vi.fn();
const mockDeleteVehicle = vi.fn();
const mockUseVirtualizer = vi.fn();

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@/db/vehicles', () => ({
  listVehicles: () => mockListVehicles(),
  deleteVehicle: (id: string) => mockDeleteVehicle(id)
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => mockUseVirtualizer()
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock {description}</div>
  )
}));

describe('VehiclesWindowList', () => {
  const defaultProps = {
    onSelectVehicle: vi.fn(),
    onCreateVehicle: vi.fn(),
    refreshToken: 0,
    onRefresh: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });
    mockUseVirtualizer.mockReturnValue({
      getVirtualItems: () => [{ index: 0, start: 0 }],
      getTotalSize: () => 56,
      measureElement: vi.fn()
    });
    mockListVehicles.mockResolvedValue([
      {
        id: 'vehicle-1',
        make: 'Tesla',
        model: 'Model Y',
        year: 2024,
        color: 'Midnight Silver',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);
    mockDeleteVehicle.mockResolvedValue(true);
  });

  it('renders loading state when database is loading', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: false,
      isLoading: true
    });
    render(<VehiclesWindowList {...defaultProps} />);
    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('renders unlock prompt when database is locked', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: false,
      isLoading: false
    });
    render(<VehiclesWindowList {...defaultProps} />);
    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('renders empty state when no vehicles', async () => {
    mockListVehicles.mockResolvedValue([]);
    render(<VehiclesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('No vehicles yet')).toBeInTheDocument();
    });
  });

  it('renders vehicle list when data is available', async () => {
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

  it('calls onSelectVehicle when clicking a vehicle', async () => {
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

  it('opens context menu on right-click', async () => {
    render(<VehiclesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('2024 Tesla Model Y')).toBeInTheDocument();
    });

    const vehicleButton = screen.getByText('2024 Tesla Model Y').closest('div');
    if (vehicleButton) fireEvent.contextMenu(vehicleButton);

    expect(screen.getByTestId('context-menu-view')).toBeInTheDocument();
    expect(screen.getByTestId('context-menu-delete')).toBeInTheDocument();
  });

  it('selects vehicle when View is clicked from context menu', async () => {
    const onSelectVehicle = vi.fn();
    render(
      <VehiclesWindowList {...defaultProps} onSelectVehicle={onSelectVehicle} />
    );

    await waitFor(() => {
      expect(screen.getByText('2024 Tesla Model Y')).toBeInTheDocument();
    });

    const vehicleButton = screen.getByText('2024 Tesla Model Y').closest('div');
    if (vehicleButton) fireEvent.contextMenu(vehicleButton);
    fireEvent.click(screen.getByTestId('context-menu-view'));

    expect(onSelectVehicle).toHaveBeenCalledWith('vehicle-1');
  });

  it('deletes vehicle when Delete is clicked from context menu', async () => {
    render(<VehiclesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('2024 Tesla Model Y')).toBeInTheDocument();
    });

    const vehicleButton = screen.getByText('2024 Tesla Model Y').closest('div');
    if (vehicleButton) fireEvent.contextMenu(vehicleButton);
    fireEvent.click(screen.getByTestId('context-menu-delete'));

    await waitFor(() => {
      expect(mockDeleteVehicle).toHaveBeenCalledWith('vehicle-1');
    });
  });

  it('filters vehicles by search query', async () => {
    mockListVehicles.mockResolvedValue([
      {
        id: 'vehicle-1',
        make: 'Tesla',
        model: 'Model Y',
        year: 2024,
        color: 'Silver',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'vehicle-2',
        make: 'Ford',
        model: 'F-150',
        year: 2023,
        color: 'Blue',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);

    mockUseVirtualizer.mockReturnValue({
      getVirtualItems: () => [
        { index: 0, start: 0 },
        { index: 1, start: 56 }
      ],
      getTotalSize: () => 112,
      measureElement: vi.fn()
    });

    render(<VehiclesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('2024 Tesla Model Y')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('window-vehicles-search');
    fireEvent.change(searchInput, { target: { value: 'Tesla' } });

    expect(searchInput).toHaveValue('Tesla');
  });

  it('focuses search input on render', async () => {
    render(<VehiclesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByTestId('window-vehicles-search')
      );
    });
  });

  it('shows empty state context menu on right-click', async () => {
    mockListVehicles.mockResolvedValue([]);
    render(<VehiclesWindowList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('No vehicles yet')).toBeInTheDocument();
    });

    const emptyState = screen.getByText('No vehicles yet').closest('div');
    if (emptyState) fireEvent.contextMenu(emptyState);

    expect(screen.getByTestId('context-menu-new-vehicle')).toBeInTheDocument();
  });

  it('calls onCreateVehicle from empty space context menu', async () => {
    const onCreateVehicle = vi.fn();
    mockListVehicles.mockResolvedValue([]);
    render(
      <VehiclesWindowList {...defaultProps} onCreateVehicle={onCreateVehicle} />
    );

    await waitFor(() => {
      expect(screen.getByText('No vehicles yet')).toBeInTheDocument();
    });

    const emptyState = screen.getByText('No vehicles yet').closest('div');
    if (emptyState) fireEvent.contextMenu(emptyState);
    fireEvent.click(screen.getByTestId('context-menu-new-vehicle'));

    expect(onCreateVehicle).toHaveBeenCalled();
  });
});
