import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NotesWindowMenuBar } from './NotesWindowMenuBar';

describe('NotesWindowMenuBar', () => {
  const defaultProps = {
    viewMode: 'list' as const,
    onViewModeChange: vi.fn(),
    showListTableOptions: true,
    showDeleted: false,
    onShowDeletedChange: vi.fn(),
    showMarkdownToolbarOption: true,
    showMarkdownToolbar: false,
    onToggleMarkdownToolbar: vi.fn(),
    onNewNote: vi.fn(),
    onClose: vi.fn()
  };

  it('renders File menu trigger', () => {
    render(<NotesWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
  });

  it('renders View menu trigger', () => {
    render(<NotesWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('shows New and Close options in File menu', async () => {
    const user = userEvent.setup();
    render(<NotesWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(screen.getByRole('menuitem', { name: 'New' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('calls onNewNote when New is clicked', async () => {
    const user = userEvent.setup();
    const onNewNote = vi.fn();
    render(<NotesWindowMenuBar {...defaultProps} onNewNote={onNewNote} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'New' }));

    expect(onNewNote).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<NotesWindowMenuBar {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows List and Table options in View menu', async () => {
    const user = userEvent.setup();
    render(<NotesWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(screen.getByRole('menuitem', { name: 'List' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Table' })).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Show Deleted' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Markdown Toolbar' })
    ).toBeInTheDocument();
  });

  it('hides List and Table options when disabled', async () => {
    const user = userEvent.setup();
    render(
      <NotesWindowMenuBar
        {...defaultProps}
        showListTableOptions={false}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(
      screen.queryByRole('menuitem', { name: 'List' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'Table' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'Show Deleted' })
    ).not.toBeInTheDocument();
  });

  it('toggles show deleted when clicked', async () => {
    const user = userEvent.setup();
    const onShowDeletedChange = vi.fn();
    render(
      <NotesWindowMenuBar
        {...defaultProps}
        onShowDeletedChange={onShowDeletedChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Show Deleted' }));

    expect(onShowDeletedChange).toHaveBeenCalledWith(true);
  });

  it('calls onViewModeChange with list when List is clicked', async () => {
    const user = userEvent.setup();
    const onViewModeChange = vi.fn();
    render(
      <NotesWindowMenuBar
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
      <NotesWindowMenuBar
        {...defaultProps}
        onViewModeChange={onViewModeChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Table' }));

    expect(onViewModeChange).toHaveBeenCalledWith('table');
  });

  it('shows checkmark on List when viewMode is list', async () => {
    const user = userEvent.setup();
    render(<NotesWindowMenuBar {...defaultProps} viewMode="list" />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    const listItem = screen.getByRole('menuitem', { name: 'List' });
    const tableItem = screen.getByRole('menuitem', { name: 'Table' });

    // List should have a check icon (first svg in the span with w-3 class)
    const listCheckSpan = listItem.querySelector('span.w-3');
    const tableCheckSpan = tableItem.querySelector('span.w-3');

    expect(listCheckSpan?.querySelector('svg')).toBeInTheDocument();
    expect(tableCheckSpan?.querySelector('svg')).not.toBeInTheDocument();
  });

  it('shows checkmark on Table when viewMode is table', async () => {
    const user = userEvent.setup();
    render(<NotesWindowMenuBar {...defaultProps} viewMode="table" />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    const listItem = screen.getByRole('menuitem', { name: 'List' });
    const tableItem = screen.getByRole('menuitem', { name: 'Table' });

    // Table should have the check icon, List should not
    const listCheckSpan = listItem.querySelector('span.w-3');
    const tableCheckSpan = tableItem.querySelector('span.w-3');

    expect(tableCheckSpan?.querySelector('svg')).toBeInTheDocument();
    expect(listCheckSpan?.querySelector('svg')).not.toBeInTheDocument();
  });

  it('toggles markdown toolbar visibility when clicked', async () => {
    const user = userEvent.setup();
    const onToggleMarkdownToolbar = vi.fn();
    render(
      <NotesWindowMenuBar
        {...defaultProps}
        onToggleMarkdownToolbar={onToggleMarkdownToolbar}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Markdown Toolbar' }));

    expect(onToggleMarkdownToolbar).toHaveBeenCalledTimes(1);
  });

  it('shows checkmark on Markdown Toolbar when enabled', async () => {
    const user = userEvent.setup();
    render(
      <NotesWindowMenuBar {...defaultProps} showMarkdownToolbar={true} />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));

    const toolbarItem = screen.getByRole('menuitem', {
      name: 'Markdown Toolbar'
    });
    const toolbarCheckSpan = toolbarItem.querySelector('span.w-3');

    expect(toolbarCheckSpan?.querySelector('svg')).toBeInTheDocument();
  });

  it('hides Markdown Toolbar option when disabled', async () => {
    const user = userEvent.setup();
    render(
      <NotesWindowMenuBar
        {...defaultProps}
        showMarkdownToolbarOption={false}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(
      screen.queryByRole('menuitem', { name: 'Markdown Toolbar' })
    ).not.toBeInTheDocument();
  });
});
