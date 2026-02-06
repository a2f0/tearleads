import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmptySpaceContextMenu } from './EmptySpaceContextMenu';

describe('EmptySpaceContextMenu', () => {
  it('renders at specified position', () => {
    render(
      <EmptySpaceContextMenu
        x={100}
        y={200}
        onClose={vi.fn()}
        onNewFolder={vi.fn()}
      />
    );

    const menu = screen.getByTestId('empty-space-context-menu');
    expect(menu).toHaveStyle({ left: '100px', top: '200px' });
  });

  it('shows New Folder option', () => {
    render(
      <EmptySpaceContextMenu
        x={100}
        y={200}
        onClose={vi.fn()}
        onNewFolder={vi.fn()}
      />
    );

    expect(screen.getByText('New Folder')).toBeInTheDocument();
  });

  it('calls onNewFolder and onClose when clicking New Folder', async () => {
    const user = userEvent.setup();
    const onNewFolder = vi.fn();
    const onClose = vi.fn();

    render(
      <EmptySpaceContextMenu
        x={100}
        y={200}
        onClose={onClose}
        onNewFolder={onNewFolder}
      />
    );

    await user.click(screen.getByText('New Folder'));
    expect(onNewFolder).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when clicking backdrop', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <EmptySpaceContextMenu
        x={100}
        y={200}
        onClose={onClose}
        onNewFolder={vi.fn()}
      />
    );

    await user.click(screen.getByTestId('empty-space-context-menu-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders with correct z-index', () => {
    render(
      <EmptySpaceContextMenu
        x={100}
        y={200}
        onClose={vi.fn()}
        onNewFolder={vi.fn()}
      />
    );

    const backdrop = screen.getByTestId('empty-space-context-menu-backdrop');
    expect(backdrop).toHaveStyle({ zIndex: '200' });

    const menu = screen.getByTestId('empty-space-context-menu');
    expect(menu).toHaveStyle({ zIndex: '201' });
  });
});
