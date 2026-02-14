import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ClassicWindowMenuBar } from './ClassicWindowMenuBar';

vi.mock('@/components/window-menu/AboutMenuItem', () => ({
  AboutMenuItem: () => <div>About</div>
}));

vi.mock('@/components/window-menu/WindowOptionsMenuItem', () => ({
  WindowOptionsMenuItem: () => <div>Window Options</div>
}));

describe('ClassicWindowMenuBar', () => {
  const defaultProps = {
    onClose: vi.fn(),
    tagSortOrder: 'user-defined' as const,
    entrySortOrder: 'user-defined' as const,
    onTagSortOrderChange: vi.fn(),
    onEntrySortOrderChange: vi.fn()
  };

  it('renders top-level menu buttons', () => {
    render(<ClassicWindowMenuBar {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tags' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entries' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
  });

  it('invokes onClose from File menu', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ClassicWindowMenuBar {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('allows selecting New Entry without error', async () => {
    const user = userEvent.setup();
    render(<ClassicWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'New Entry' }));

    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
  });

  it('changes tag sort order from the Tags menu', async () => {
    const user = userEvent.setup();
    const onTagSortOrderChange = vi.fn();
    render(
      <ClassicWindowMenuBar
        {...defaultProps}
        onTagSortOrderChange={onTagSortOrderChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Tags' }));
    await user.click(
      screen.getByRole('menuitem', { name: 'Sort by Name (A-Z)' })
    );

    expect(onTagSortOrderChange).toHaveBeenCalledWith('name-asc');
  });

  it('changes entry sort order from the Entries menu', async () => {
    const user = userEvent.setup();
    const onEntrySortOrderChange = vi.fn();
    render(
      <ClassicWindowMenuBar
        {...defaultProps}
        onEntrySortOrderChange={onEntrySortOrderChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Entries' }));
    await user.click(
      screen.getByRole('menuitem', {
        name: 'Sort by Date Tagged (Newest First)'
      })
    );

    expect(onEntrySortOrderChange).toHaveBeenCalledWith('date-tagged-desc');
  });
});
