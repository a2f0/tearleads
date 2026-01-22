import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LaserScreensaver } from './LaserScreensaver';
import { ScreensaverProvider, useScreensaver } from './ScreensaverContext';

const mockGetChartColors = vi.fn(() => [
  '#ff0000',
  '#00ff00',
  '#0000ff',
  '#ffff00'
]);

vi.mock('@/components/duration-chart/constants', () => ({
  getChartColors: () => mockGetChartColors()
}));

// Mock canvas context for animation tests
const mockContext = {
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
  lineCap: '',
  lineJoin: '',
  globalAlpha: 1,
  fillRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn()
} as unknown as CanvasRenderingContext2D;

// Store original getContext
const originalGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  vi.clearAllMocks();
  // Mock getContext to return our mock context
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => mockContext
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  // Restore original
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <ScreensaverProvider>{children}</ScreensaverProvider>;
}

function ActivatorButton() {
  const { activate } = useScreensaver();
  return (
    <button type="button" onClick={activate}>
      Activate
    </button>
  );
}

describe('LaserScreensaver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when inactive', () => {
    render(
      <TestWrapper>
        <LaserScreensaver />
      </TestWrapper>
    );

    expect(document.querySelector('canvas')).not.toBeInTheDocument();
  });

  it('renders canvas when active', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ActivatorButton />
        <LaserScreensaver />
      </TestWrapper>
    );

    await user.click(screen.getByText('Activate'));

    expect(document.querySelector('canvas')).toBeInTheDocument();
  });

  it('renders with correct styles when active', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ActivatorButton />
        <LaserScreensaver />
      </TestWrapper>
    );

    await user.click(screen.getByText('Activate'));

    const canvas = document.querySelector('canvas');
    expect(canvas).toHaveStyle({
      position: 'fixed',
      cursor: 'none'
    });
    expect(canvas).toHaveAttribute(
      'style',
      expect.stringContaining('background-color: black')
    );
  });

  it('dismisses on keydown', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ActivatorButton />
        <LaserScreensaver />
      </TestWrapper>
    );

    await user.click(screen.getByText('Activate'));
    expect(document.querySelector('canvas')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(document.querySelector('canvas')).not.toBeInTheDocument();
  });

  it('dismisses on mousedown', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ActivatorButton />
        <LaserScreensaver />
      </TestWrapper>
    );

    await user.click(screen.getByText('Activate'));
    expect(document.querySelector('canvas')).toBeInTheDocument();

    await user.click(document.body);
    expect(document.querySelector('canvas')).not.toBeInTheDocument();
  });

  it('dismisses on significant mouse movement', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ActivatorButton />
        <LaserScreensaver />
      </TestWrapper>
    );

    await user.click(screen.getByText('Activate'));
    expect(document.querySelector('canvas')).toBeInTheDocument();

    // Simulate mouse movement with significant movement
    await act(async () => {
      const event = new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        movementX: 10,
        movementY: 10
      });
      document.dispatchEvent(event);
    });

    expect(document.querySelector('canvas')).not.toBeInTheDocument();
  });

  it('does not dismiss on small mouse movement', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ActivatorButton />
        <LaserScreensaver />
      </TestWrapper>
    );

    await user.click(screen.getByText('Activate'));
    expect(document.querySelector('canvas')).toBeInTheDocument();

    // Simulate mouse movement with small movement (should be ignored)
    await act(async () => {
      const event = new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        movementX: 1,
        movementY: 1
      });
      document.dispatchEvent(event);
    });

    expect(document.querySelector('canvas')).toBeInTheDocument();
  });

  it('dismisses on touchstart', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ActivatorButton />
        <LaserScreensaver />
      </TestWrapper>
    );

    await user.click(screen.getByText('Activate'));
    expect(document.querySelector('canvas')).toBeInTheDocument();

    await act(async () => {
      const event = new TouchEvent('touchstart', {
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(event);
    });

    expect(document.querySelector('canvas')).not.toBeInTheDocument();
  });

  it('handles window resize', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ActivatorButton />
        <LaserScreensaver />
      </TestWrapper>
    );

    await user.click(screen.getByText('Activate'));

    const canvas = document.querySelector('canvas');
    expect(canvas).toBeInTheDocument();

    // Trigger resize event
    window.dispatchEvent(new Event('resize'));

    // Canvas should still be there after resize
    expect(document.querySelector('canvas')).toBeInTheDocument();
  });

  it('initializes animation when activated', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ActivatorButton />
        <LaserScreensaver />
      </TestWrapper>
    );

    await user.click(screen.getByText('Activate'));

    // Wait for animation frame
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Canvas context methods should have been called
    expect(mockContext.fillRect).toHaveBeenCalled();
  });

  it('cleans up animation on deactivation', async () => {
    const user = userEvent.setup();
    const cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame');

    render(
      <TestWrapper>
        <ActivatorButton />
        <LaserScreensaver />
      </TestWrapper>
    );

    await user.click(screen.getByText('Activate'));
    expect(document.querySelector('canvas')).toBeInTheDocument();

    // Dismiss the screensaver
    await user.keyboard('{Escape}');

    // Animation should be cancelled
    expect(cancelAnimationFrameSpy).toHaveBeenCalled();

    cancelAnimationFrameSpy.mockRestore();
  });

  it('uses fallback color when getChartColors returns empty array', async () => {
    // Override mock to return empty array
    mockGetChartColors.mockReturnValueOnce([]);

    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ActivatorButton />
        <LaserScreensaver />
      </TestWrapper>
    );

    await user.click(screen.getByText('Activate'));

    // Should still render without error
    expect(document.querySelector('canvas')).toBeInTheDocument();

    // Wait for animation to start
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(mockContext.fillRect).toHaveBeenCalled();
  });
});
