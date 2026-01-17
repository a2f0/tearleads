import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmailWindowMenuBar } from './EmailWindowMenuBar';

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({
    trigger,
    children
  }: {
    trigger: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div data-testid={`dropdown-${trigger}`}>
      <button type="button" data-testid={`trigger-${trigger}`}>
        {trigger}
      </button>
      <div data-testid={`menu-${trigger}`}>{children}</div>
    </div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
    checked
  }: {
    children: React.ReactNode;
    onClick: () => void;
    checked?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      data-checked={checked}
      data-testid={`menuitem-${children}`}
    >
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr data-testid="separator" />
}));

describe('EmailWindowMenuBar', () => {
  const defaultProps = {
    viewMode: 'list' as const,
    onViewModeChange: vi.fn(),
    onRefresh: vi.fn(),
    onClose: vi.fn()
  };

  it('renders File and View menus', () => {
    render(<EmailWindowMenuBar {...defaultProps} />);

    expect(screen.getByTestId('trigger-File')).toBeInTheDocument();
    expect(screen.getByTestId('trigger-View')).toBeInTheDocument();
  });

  it('calls onRefresh when Refresh is clicked', async () => {
    const user = userEvent.setup();
    render(<EmailWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByTestId('menuitem-Refresh'));

    expect(defaultProps.onRefresh).toHaveBeenCalled();
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    render(<EmailWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByTestId('menuitem-Close'));

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onViewModeChange with list when List is clicked', async () => {
    const user = userEvent.setup();
    render(<EmailWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByTestId('menuitem-List'));

    expect(defaultProps.onViewModeChange).toHaveBeenCalledWith('list');
  });

  it('calls onViewModeChange with table when Table is clicked', async () => {
    const user = userEvent.setup();
    render(<EmailWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByTestId('menuitem-Table'));

    expect(defaultProps.onViewModeChange).toHaveBeenCalledWith('table');
  });

  it('marks current view mode as checked', () => {
    const { rerender } = render(<EmailWindowMenuBar {...defaultProps} />);

    expect(screen.getByTestId('menuitem-List')).toHaveAttribute(
      'data-checked',
      'true'
    );
    expect(screen.getByTestId('menuitem-Table')).toHaveAttribute(
      'data-checked',
      'false'
    );

    rerender(<EmailWindowMenuBar {...defaultProps} viewMode="table" />);

    expect(screen.getByTestId('menuitem-List')).toHaveAttribute(
      'data-checked',
      'false'
    );
    expect(screen.getByTestId('menuitem-Table')).toHaveAttribute(
      'data-checked',
      'true'
    );
  });
});
