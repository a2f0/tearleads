import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WindowSidebarHeader } from './WindowSidebarHeader.js';

describe('WindowSidebarHeader', () => {
  it('renders title and action button', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();

    render(
      <WindowSidebarHeader
        title="Playlists"
        actionLabel="New Playlist"
        onAction={onAction}
        actionIcon={<span>+</span>}
      />
    );

    expect(screen.getByText('Playlists')).toBeInTheDocument();
    await user.click(screen.getByTitle('New Playlist'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
