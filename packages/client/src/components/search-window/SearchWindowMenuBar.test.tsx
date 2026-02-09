import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchWindowMenuBar } from './SearchWindowMenuBar';

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({
    trigger,
    children
  }: {
    trigger: string;
    children: React.ReactNode;
  }) => (
    <div data-testid={`dropdown-${trigger.toLowerCase()}`}>
      <span>{trigger}</span>
      {children}
    </div>
  ),
  DropdownMenuItem: ({
    onClick,
    children
  }: {
    onClick?: () => void;
    children: React.ReactNode;
  }) => (
    <button type="button" onClick={onClick} data-testid="dropdown-item">
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <div data-testid="dropdown-separator" />
}));

vi.mock('@/components/window-menu/WindowOptionsMenuItem', () => ({
  WindowOptionsMenuItem: () => <div data-testid="window-options">Options</div>
}));

describe('SearchWindowMenuBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders File and View menus', () => {
    render(
      <SearchWindowMenuBar
        viewMode="list"
        onViewModeChange={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId('dropdown-file')).toBeInTheDocument();
    expect(screen.getByTestId('dropdown-view')).toBeInTheDocument();
  });

  it('renders Close option in File menu', () => {
    render(
      <SearchWindowMenuBar
        viewMode="list"
        onViewModeChange={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Close')).toBeInTheDocument();
  });

  it('renders Table and List options in View menu', () => {
    render(
      <SearchWindowMenuBar
        viewMode="list"
        onViewModeChange={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Table' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'List' })).toBeInTheDocument();
  });

  it('renders WindowOptionsMenuItem in View menu', () => {
    render(
      <SearchWindowMenuBar
        viewMode="list"
        onViewModeChange={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId('window-options')).toBeInTheDocument();
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SearchWindowMenuBar
        viewMode="list"
        onViewModeChange={vi.fn()}
        onClose={onClose}
      />
    );

    await user.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onViewModeChange with table when Table is clicked', async () => {
    const user = userEvent.setup();
    const onViewModeChange = vi.fn();
    render(
      <SearchWindowMenuBar
        viewMode="list"
        onViewModeChange={onViewModeChange}
        onClose={vi.fn()}
      />
    );

    await user.click(screen.getByText('Table'));
    expect(onViewModeChange).toHaveBeenCalledWith('table');
  });

  it('calls onViewModeChange with list when List is clicked', async () => {
    const user = userEvent.setup();
    const onViewModeChange = vi.fn();
    render(
      <SearchWindowMenuBar
        viewMode="table"
        onViewModeChange={onViewModeChange}
        onClose={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'List' }));
    expect(onViewModeChange).toHaveBeenCalledWith('list');
  });
});
