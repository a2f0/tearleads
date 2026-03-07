import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailListContextMenu } from './EmailListContextMenu.js';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EmailListContextMenu', () => {
  it('renders at specified position', () => {
    render(
      <EmailListContextMenu
        x={100}
        y={200}

        onClose={vi.fn()}
        onComposeForMode={vi.fn()}
      />
    );

    const menu = screen.getByTestId('email-list-context-menu');
    expect(menu).toHaveStyle({ left: '100px', top: '200px' });
  });

  it('shows Reply, Reply All, and Forward options', () => {
    render(
      <EmailListContextMenu
        x={100}
        y={200}

        onClose={vi.fn()}
        onComposeForMode={vi.fn()}
      />
    );

    expect(screen.getByText('Reply')).toBeInTheDocument();
    expect(screen.getByText('Reply All')).toBeInTheDocument();
    expect(screen.getByText('Forward')).toBeInTheDocument();
  });

  it('calls onComposeForMode with reply and onClose when clicking Reply', async () => {
    const user = userEvent.setup();
    const onComposeForMode = vi.fn();
    const onClose = vi.fn();

    render(
      <EmailListContextMenu
        x={100}
        y={200}

        onClose={onClose}
        onComposeForMode={onComposeForMode}
      />
    );

    await user.click(screen.getByText('Reply'));
    expect(onComposeForMode).toHaveBeenCalledWith('reply');
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onComposeForMode with replyAll and onClose when clicking Reply All', async () => {
    const user = userEvent.setup();
    const onComposeForMode = vi.fn();
    const onClose = vi.fn();

    render(
      <EmailListContextMenu
        x={100}
        y={200}

        onClose={onClose}
        onComposeForMode={onComposeForMode}
      />
    );

    await user.click(screen.getByText('Reply All'));
    expect(onComposeForMode).toHaveBeenCalledWith('replyAll');
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onComposeForMode with forward and onClose when clicking Forward', async () => {
    const user = userEvent.setup();
    const onComposeForMode = vi.fn();
    const onClose = vi.fn();

    render(
      <EmailListContextMenu
        x={100}
        y={200}

        onClose={onClose}
        onComposeForMode={onComposeForMode}
      />
    );

    await user.click(screen.getByText('Forward'));
    expect(onComposeForMode).toHaveBeenCalledWith('forward');
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when clicking backdrop', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <EmailListContextMenu
        x={100}
        y={200}

        onClose={onClose}
        onComposeForMode={vi.fn()}
      />
    );

    await user.click(screen.getByTestId('email-list-context-menu-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders backdrop with correct z-index', () => {
    render(
      <EmailListContextMenu
        x={100}
        y={200}

        onClose={vi.fn()}
        onComposeForMode={vi.fn()}
      />
    );

    const backdrop = screen.getByTestId('email-list-context-menu-backdrop');
    expect(backdrop).toHaveStyle({ zIndex: '200' });

    const menu = screen.getByTestId('email-list-context-menu');
    expect(menu).toHaveStyle({ zIndex: '201' });
  });

  it('calls onClose when pressing Escape key', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <EmailListContextMenu
        x={100}
        y={200}

        onClose={onClose}
        onComposeForMode={vi.fn()}
      />
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
