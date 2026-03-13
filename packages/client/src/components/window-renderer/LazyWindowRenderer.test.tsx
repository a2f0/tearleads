import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LazyWindowRenderer } from './LazyWindowRenderer';

const hoisted = {
  windows: [] as Array<{
    id: string;
    type: string;
    zIndex: number;
    isMinimized?: boolean;
  }>,
  suspendWindowRenderer: false
};

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManager: () => ({
    windows: hoisted.windows,
    closeWindow: vi.fn(),
    focusWindow: vi.fn(),
    minimizeWindow: vi.fn(),
    updateWindowDimensions: vi.fn(),
    saveWindowDimensionsForType: vi.fn(),
    renameWindow: vi.fn()
  })
}));

vi.mock('@tearleads/window-manager', () => ({
  DesktopFloatingWindow: ({
    id,
    children
  }: {
    id: string;
    children: ReactNode;
  }) => <div data-testid={`window-loading-shell-${id}`}>{children}</div>
}));

const pendingWindowRendererPromise = new Promise<never>(() => {});

vi.mock('./WindowRenderer', () => ({
  WindowRenderer: () => {
    if (hoisted.suspendWindowRenderer) {
      throw pendingWindowRendererPromise;
    }
    return <div data-testid="window-renderer" />;
  }
}));

describe('LazyWindowRenderer', () => {
  beforeEach(() => {
    hoisted.windows = [];
    hoisted.suspendWindowRenderer = false;
  });

  it('renders nothing when no visible windows exist', () => {
    hoisted.windows = [
      { id: 'notes-1', type: 'notes', zIndex: 100, isMinimized: true }
    ];
    const { container } = render(<LazyWindowRenderer />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('window-renderer')).not.toBeInTheDocument();
  });

  it('renders deferred WindowRenderer when a visible window exists', async () => {
    hoisted.windows = [
      { id: 'notes-1', type: 'notes', zIndex: 100, isMinimized: true },
      { id: 'sync-1', type: 'sync', zIndex: 101, isMinimized: false }
    ];

    render(<LazyWindowRenderer />);

    expect(await screen.findByTestId('window-renderer')).toBeInTheDocument();
  });

  it('renders the loading shell while window assets are still loading', () => {
    hoisted.suspendWindowRenderer = true;
    hoisted.windows = [
      { id: 'notes-1', type: 'notes', zIndex: 100, isMinimized: false }
    ];

    render(<LazyWindowRenderer />);

    expect(
      screen.getByTestId('window-loading-shell-notes-1')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('window-bundle-loading-indicator-notes-1')
    ).toHaveTextContent('Loading window assets...');
    expect(screen.queryByTestId('window-renderer')).not.toBeInTheDocument();
  });
});
