import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VehiclesWindow } from './VehiclesWindow';

vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({
    children,
    title,
    onClose,
    ...rest
  }: {
    children: React.ReactNode;
    title: string;
    onClose: () => void;
    [key: string]: unknown;
  }) => (
    <div
      data-testid="floating-window"
      data-props={JSON.stringify(rest)}
      data-props-keys={JSON.stringify(Object.keys(rest))}
    >
      <div data-testid="window-title">{title}</div>
      <button type="button" onClick={onClose} data-testid="close-window">
        Close
      </button>
      {children}
    </div>
  )
}));

vi.mock('./VehiclesWindowMenuBar', () => ({
  VehiclesWindowMenuBar: ({
    onNewVehicle,
    onClose,
    onViewModeChange,
    viewMode
  }: {
    viewMode: 'list' | 'table';
    onViewModeChange: (mode: 'list' | 'table') => void;
    onNewVehicle: () => void;
    onClose: () => void;
  }) => (
    <div data-testid="menu-bar">
      <span data-testid="menu-view-mode">{viewMode}</span>
      <button
        type="button"
        onClick={onNewVehicle}
        data-testid="menu-new-vehicle"
      >
        New Vehicle
      </button>
      <button type="button" onClick={onClose} data-testid="menu-close">
        Close
      </button>
      <button
        type="button"
        onClick={() => onViewModeChange('list')}
        data-testid="menu-view-list"
      >
        List View
      </button>
      <button
        type="button"
        onClick={() => onViewModeChange('table')}
        data-testid="menu-view-table"
      >
        Table View
      </button>
    </div>
  )
}));

vi.mock('./VehiclesWindowList', () => ({
  VehiclesWindowList: ({
    onSelectVehicle,
    onCreateVehicle,
    refreshToken,
    onRefresh
  }: {
    onSelectVehicle: (id: string) => void;
    onCreateVehicle: () => void;
    refreshToken: number;
    onRefresh: () => void;
  }) => (
    <div data-testid="vehicles-list">
      <span data-testid="list-refresh-token">{refreshToken}</span>
      <button
        type="button"
        onClick={() => onSelectVehicle('vehicle-123')}
        data-testid="select-vehicle-button"
      >
        Select Vehicle
      </button>
      <button
        type="button"
        onClick={onCreateVehicle}
        data-testid="list-create-button"
      >
        Create
      </button>
      <button type="button" onClick={onRefresh} data-testid="list-refresh">
        Refresh
      </button>
    </div>
  )
}));

vi.mock('./VehiclesWindowDetail', () => ({
  VehiclesWindowDetail: ({
    vehicleId,
    onBack,
    onDeleted
  }: {
    vehicleId: string;
    onBack: () => void;
    onDeleted: () => void;
  }) => (
    <div data-testid="vehicles-detail">
      <span data-testid="detail-vehicle-id">{vehicleId}</span>
      <button type="button" onClick={onBack} data-testid="detail-back">
        Back
      </button>
      <button type="button" onClick={onDeleted} data-testid="detail-delete">
        Delete
      </button>
    </div>
  )
}));

vi.mock('./VehiclesWindowNew', () => ({
  VehiclesWindowNew: ({
    onCreated,
    onCancel
  }: {
    onCreated: (id: string) => void;
    onCancel: () => void;
  }) => (
    <div data-testid="vehicles-new">
      <button
        type="button"
        onClick={() => onCreated('new-vehicle-456')}
        data-testid="new-create-button"
      >
        Create
      </button>
      <button type="button" onClick={onCancel} data-testid="new-cancel">
        Cancel
      </button>
    </div>
  )
}));

vi.mock('@/components/vehicles', () => ({
  VehiclesManager: () => <div data-testid="vehicles-manager">Manager</div>
}));

describe('VehiclesWindow', () => {
  const defaultProps = {
    id: 'vehicles-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the floating window and title', () => {
    render(<VehiclesWindow {...defaultProps} />);

    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
    expect(screen.getByTestId('window-title').textContent).toBe('Vehicles');
  });

  it('renders menu bar', () => {
    render(<VehiclesWindow {...defaultProps} />);
    expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
  });

  it('renders list view by default', () => {
    render(<VehiclesWindow {...defaultProps} />);
    expect(screen.getByTestId('vehicles-list')).toBeInTheDocument();
  });

  it('renders control bar with New and Refresh buttons in list view', () => {
    render(<VehiclesWindow {...defaultProps} />);
    expect(
      screen.getByTestId('vehicles-window-control-new')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('vehicles-window-control-refresh')
    ).toBeInTheDocument();
  });

  it('passes initialDimensions when provided', () => {
    const initialDimensions = { x: 90, y: 60, width: 900, height: 620 };
    render(
      <VehiclesWindow {...defaultProps} initialDimensions={initialDimensions} />
    );

    const window = screen.getByTestId('floating-window');
    const props = JSON.parse(window.dataset['props'] ?? '{}');
    expect(props.initialDimensions).toEqual(initialDimensions);
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<VehiclesWindow {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByTestId('close-window'));

    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when menu close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<VehiclesWindow {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByTestId('menu-close'));

    expect(onClose).toHaveBeenCalled();
  });

  it('navigates to detail view when vehicle is selected', async () => {
    const user = userEvent.setup();
    render(<VehiclesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-vehicle-button'));

    await waitFor(() => {
      expect(screen.getByTestId('vehicles-detail')).toBeInTheDocument();
      expect(screen.getByTestId('detail-vehicle-id')).toHaveTextContent(
        'vehicle-123'
      );
    });
  });

  it('shows back button in detail view', async () => {
    const user = userEvent.setup();
    render(<VehiclesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-vehicle-button'));

    await waitFor(() => {
      expect(
        screen.getByTestId('vehicles-window-control-back')
      ).toBeInTheDocument();
    });
  });

  it('returns to list view when back is clicked', async () => {
    const user = userEvent.setup();
    render(<VehiclesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-vehicle-button'));

    await waitFor(() => {
      expect(screen.getByTestId('vehicles-detail')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('vehicles-window-control-back'));

    await waitFor(() => {
      expect(screen.getByTestId('vehicles-list')).toBeInTheDocument();
    });
  });

  it('returns to list view when vehicle is deleted', async () => {
    const user = userEvent.setup();
    render(<VehiclesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-vehicle-button'));
    await user.click(screen.getByTestId('detail-delete'));

    await waitFor(() => {
      expect(screen.getByTestId('vehicles-list')).toBeInTheDocument();
    });
  });

  it('navigates to create view when new vehicle is requested', async () => {
    const user = userEvent.setup();
    render(<VehiclesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('menu-new-vehicle'));

    await waitFor(() => {
      expect(screen.getByTestId('vehicles-new')).toBeInTheDocument();
    });
  });

  it('shows back button in create view', async () => {
    const user = userEvent.setup();
    render(<VehiclesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('vehicles-window-control-new'));

    await waitFor(() => {
      expect(
        screen.getByTestId('vehicles-window-control-back')
      ).toBeInTheDocument();
    });
  });

  it('navigates to detail view after vehicle is created', async () => {
    const user = userEvent.setup();
    render(<VehiclesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('menu-new-vehicle'));
    await user.click(screen.getByTestId('new-create-button'));

    await waitFor(() => {
      expect(screen.getByTestId('vehicles-detail')).toBeInTheDocument();
      expect(screen.getByTestId('detail-vehicle-id')).toHaveTextContent(
        'new-vehicle-456'
      );
    });
  });

  it('returns to list view when create is cancelled', async () => {
    const user = userEvent.setup();
    render(<VehiclesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('menu-new-vehicle'));
    await user.click(screen.getByTestId('new-cancel'));

    await waitFor(() => {
      expect(screen.getByTestId('vehicles-list')).toBeInTheDocument();
    });
  });

  it('increments refresh token when refresh is clicked', async () => {
    const user = userEvent.setup();
    render(<VehiclesWindow {...defaultProps} />);

    expect(screen.getByTestId('list-refresh-token')).toHaveTextContent('0');

    await user.click(screen.getByTestId('vehicles-window-control-refresh'));

    expect(screen.getByTestId('list-refresh-token')).toHaveTextContent('1');
  });

  it('switches to table view when menu table is clicked', async () => {
    const user = userEvent.setup();
    render(<VehiclesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('menu-view-table'));

    await waitFor(() => {
      expect(screen.getByTestId('vehicles-manager')).toBeInTheDocument();
    });
  });

  it('switches back to list view when menu list is clicked', async () => {
    const user = userEvent.setup();
    render(<VehiclesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('menu-view-table'));
    await user.click(screen.getByTestId('menu-view-list'));

    await waitFor(() => {
      expect(screen.getByTestId('vehicles-list')).toBeInTheDocument();
    });
  });
});
