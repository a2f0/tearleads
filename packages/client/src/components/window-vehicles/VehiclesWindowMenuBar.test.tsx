import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VehiclesWindowMenuBar } from './VehiclesWindowMenuBar';

describe('VehiclesWindowMenuBar', () => {
  const defaultProps = {
    viewMode: 'list' as const,
    onViewModeChange: vi.fn(),
    onNewVehicle: vi.fn(),
    onClose: vi.fn()
  };

  it('renders File menu trigger', () => {
    render(<VehiclesWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
  });

  it('renders View menu trigger', () => {
    render(<VehiclesWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('shows New Vehicle and Close options in File menu', async () => {
    const user = userEvent.setup();
    render(<VehiclesWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(
      screen.getByRole('menuitem', { name: 'New Vehicle' })
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('calls onNewVehicle when New Vehicle is clicked', async () => {
    const user = userEvent.setup();
    const onNewVehicle = vi.fn();
    render(
      <VehiclesWindowMenuBar {...defaultProps} onNewVehicle={onNewVehicle} />
    );

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'New Vehicle' }));

    expect(onNewVehicle).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<VehiclesWindowMenuBar {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows List and Table options in View menu', async () => {
    const user = userEvent.setup();
    render(<VehiclesWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(screen.getByRole('menuitem', { name: 'List' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Table' })).toBeInTheDocument();
  });

  it('calls onViewModeChange with list when List is clicked', async () => {
    const user = userEvent.setup();
    const onViewModeChange = vi.fn();
    render(
      <VehiclesWindowMenuBar
        {...defaultProps}
        viewMode="table"
        onViewModeChange={onViewModeChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'List' }));

    expect(onViewModeChange).toHaveBeenCalledWith('list');
  });

  it('calls onViewModeChange with table when Table is clicked', async () => {
    const user = userEvent.setup();
    const onViewModeChange = vi.fn();
    render(
      <VehiclesWindowMenuBar
        {...defaultProps}
        viewMode="list"
        onViewModeChange={onViewModeChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Table' }));

    expect(onViewModeChange).toHaveBeenCalledWith('table');
  });

  it('shows checkmark on List when viewMode is list', async () => {
    const user = userEvent.setup();
    render(<VehiclesWindowMenuBar {...defaultProps} viewMode="list" />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    const listItem = screen.getByRole('menuitem', { name: 'List' });
    const checkSpan = listItem.querySelector('span.w-3');

    expect(checkSpan?.querySelector('svg')).toBeInTheDocument();
  });

  it('shows checkmark on Table when viewMode is table', async () => {
    const user = userEvent.setup();
    render(<VehiclesWindowMenuBar {...defaultProps} viewMode="table" />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    const tableItem = screen.getByRole('menuitem', { name: 'Table' });
    const checkSpan = tableItem.querySelector('span.w-3');

    expect(checkSpan?.querySelector('svg')).toBeInTheDocument();
  });
});
