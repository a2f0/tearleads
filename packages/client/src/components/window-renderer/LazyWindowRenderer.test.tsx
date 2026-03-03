import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LazyWindowRenderer } from './LazyWindowRenderer';

const hoisted = vi.hoisted(() => ({
  windows: [] as Array<{ isMinimized?: boolean }>
}));

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManager: () => ({
    windows: hoisted.windows
  })
}));

vi.mock('./WindowRenderer', () => ({
  WindowRenderer: () => <div data-testid="window-renderer" />
}));

describe('LazyWindowRenderer', () => {
  beforeEach(() => {
    hoisted.windows = [];
  });

  it('renders nothing when no visible windows exist', () => {
    hoisted.windows = [{ isMinimized: true }];
    const { container } = render(<LazyWindowRenderer />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('window-renderer')).not.toBeInTheDocument();
  });

  it('renders deferred WindowRenderer when a visible window exists', async () => {
    hoisted.windows = [{ isMinimized: true }, { isMinimized: false }];

    render(<LazyWindowRenderer />);

    expect(await screen.findByTestId('window-renderer')).toBeInTheDocument();
  });
});
