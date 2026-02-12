import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WindowSidebarItem } from './WindowSidebarItem.js';

describe('WindowSidebarItem', () => {
  it('renders item text and count', () => {
    render(
      <WindowSidebarItem
        label="Favorites"
        icon={<span>i</span>}
        selected={true}
        onClick={() => {}}
        count={3}
        leadingSpacer
      />
    );

    expect(screen.getByRole('button', { name: /Favorites/i })).toHaveClass(
      'bg-accent',
      'text-accent-foreground'
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('supports pointer and drag handlers', () => {
    const onClick = vi.fn();
    const onContextMenu = vi.fn();
    const onDragOver = vi.fn();
    const onDragEnter = vi.fn();
    const onDragLeave = vi.fn();
    const onDrop = vi.fn();

    render(
      <WindowSidebarItem
        label="Inbox"
        icon={<span>i</span>}
        selected={false}
        onClick={onClick}
        className="ring-1"
        onContextMenu={onContextMenu}
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      />
    );

    const button = screen.getByRole('button', { name: /Inbox/i });

    fireEvent.click(button);
    fireEvent.contextMenu(button);
    fireEvent.dragOver(button);
    fireEvent.dragEnter(button);
    fireEvent.dragLeave(button);
    fireEvent.drop(button);

    expect(button).toHaveClass('hover:bg-accent/50', 'ring-1');
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onDragOver).toHaveBeenCalledTimes(1);
    expect(onDragEnter).toHaveBeenCalledTimes(1);
    expect(onDragLeave).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });
});
