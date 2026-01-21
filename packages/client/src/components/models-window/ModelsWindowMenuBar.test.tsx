import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelsWindowMenuBar } from './ModelsWindowMenuBar';

describe('ModelsWindowMenuBar', () => {
  const defaultProps = {
    viewMode: 'cards',
    onViewModeChange: vi.fn(),
    onClose: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders File and View menu triggers', () => {
    render(<ModelsWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('shows Close option in File menu', async () => {
    const user = userEvent.setup();
    render(<ModelsWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ModelsWindowMenuBar {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows Cards and Compact Table options in View menu', async () => {
    const user = userEvent.setup();
    render(<ModelsWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(screen.getByRole('menuitem', { name: 'Cards' })).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Compact Table' })
    ).toBeInTheDocument();
  });

  it('calls onViewModeChange when Compact Table is selected', async () => {
    const user = userEvent.setup();
    const onViewModeChange = vi.fn();
    render(
      <ModelsWindowMenuBar
        {...defaultProps}
        onViewModeChange={onViewModeChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Compact Table' }));

    expect(onViewModeChange).toHaveBeenCalledWith('table');
  });
});
