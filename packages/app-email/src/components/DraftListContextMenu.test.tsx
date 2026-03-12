import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftListContextMenu } from './DraftListContextMenu.js';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DraftListContextMenu', () => {
  it('renders at specified position', () => {
    render(
      <DraftListContextMenu
        x={100}
        y={200}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const menu = screen.getByTestId('draft-list-context-menu');
    expect(menu).toHaveStyle({ left: '100px', top: '200px' });
  });

  it('shows Edit and Delete options', () => {
    render(
      <DraftListContextMenu
        x={100}
        y={200}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('calls onEdit and onClose when clicking Edit', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onClose = vi.fn();

    render(
      <DraftListContextMenu
        x={100}
        y={200}
        onClose={onClose}
        onEdit={onEdit}
        onDelete={vi.fn()}
      />
    );

    await user.click(screen.getByText('Edit'));
    expect(onEdit).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onDelete and onClose when clicking Delete', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const onClose = vi.fn();

    render(
      <DraftListContextMenu
        x={100}
        y={200}
        onClose={onClose}
        onEdit={vi.fn()}
        onDelete={onDelete}
      />
    );

    await user.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when clicking backdrop', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <DraftListContextMenu
        x={100}
        y={200}
        onClose={onClose}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    await user.click(screen.getByTestId('draft-list-context-menu-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders backdrop with correct z-index', () => {
    render(
      <DraftListContextMenu
        x={100}
        y={200}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const backdrop = screen.getByTestId('draft-list-context-menu-backdrop');
    expect(backdrop).toHaveStyle({ zIndex: '200' });

    const menu = screen.getByTestId('draft-list-context-menu');
    expect(menu).toHaveStyle({ zIndex: '201' });
  });

  it('calls onClose when pressing Escape key', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <DraftListContextMenu
        x={100}
        y={200}
        onClose={onClose}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
