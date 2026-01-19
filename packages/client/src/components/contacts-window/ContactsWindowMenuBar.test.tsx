import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ContactsWindowMenuBar } from './ContactsWindowMenuBar';

describe('ContactsWindowMenuBar', () => {
  const defaultProps = {
    viewMode: 'list' as const,
    onViewModeChange: vi.fn(),
    onNewContact: vi.fn(),
    onClose: vi.fn()
  };

  it('renders File menu trigger', () => {
    render(<ContactsWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
  });

  it('renders View menu trigger', () => {
    render(<ContactsWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('shows New and Close options in File menu', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(screen.getByRole('menuitem', { name: 'New' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('calls onNewContact when New is clicked', async () => {
    const user = userEvent.setup();
    const onNewContact = vi.fn();
    render(
      <ContactsWindowMenuBar {...defaultProps} onNewContact={onNewContact} />
    );

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'New' }));

    expect(onNewContact).toHaveBeenCalledTimes(1);
  });

  it('disables New when requested', async () => {
    const user = userEvent.setup();
    const onNewContact = vi.fn();
    render(
      <ContactsWindowMenuBar
        {...defaultProps}
        onNewContact={onNewContact}
        isNewContactDisabled={true}
      />
    );

    await user.click(screen.getByRole('button', { name: 'File' }));

    const newItem = screen.getByRole('menuitem', { name: 'New' });
    expect(newItem).toBeDisabled();

    await user.click(newItem);
    expect(onNewContact).not.toHaveBeenCalled();
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ContactsWindowMenuBar {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows List and Table options in View menu', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(screen.getByRole('menuitem', { name: 'List' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Table' })).toBeInTheDocument();
  });

  it('calls onViewModeChange with list when List is clicked', async () => {
    const user = userEvent.setup();
    const onViewModeChange = vi.fn();
    render(
      <ContactsWindowMenuBar
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
      <ContactsWindowMenuBar
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
    render(<ContactsWindowMenuBar {...defaultProps} viewMode="list" />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    const listItem = screen.getByRole('menuitem', { name: 'List' });
    const tableItem = screen.getByRole('menuitem', { name: 'Table' });

    const listCheckSpan = listItem.querySelector('span.w-3');
    const tableCheckSpan = tableItem.querySelector('span.w-3');

    expect(listCheckSpan?.querySelector('svg')).toBeInTheDocument();
    expect(tableCheckSpan?.querySelector('svg')).not.toBeInTheDocument();
  });

  it('shows checkmark on Table when viewMode is table', async () => {
    const user = userEvent.setup();
    render(<ContactsWindowMenuBar {...defaultProps} viewMode="table" />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    const listItem = screen.getByRole('menuitem', { name: 'List' });
    const tableItem = screen.getByRole('menuitem', { name: 'Table' });

    const listCheckSpan = listItem.querySelector('span.w-3');
    const tableCheckSpan = tableItem.querySelector('span.w-3');

    expect(tableCheckSpan?.querySelector('svg')).toBeInTheDocument();
    expect(listCheckSpan?.querySelector('svg')).not.toBeInTheDocument();
  });
});
