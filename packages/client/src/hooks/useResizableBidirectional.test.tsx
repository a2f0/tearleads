import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useResizableBidirectional } from './useResizableBidirectional';

function BidirectionalHarness() {
  const {
    width,
    height,
    handleCornerMouseDown,
    handleCornerTouchStart,
    handleVerticalMouseDown,
    handleVerticalTouchStart
  } = useResizableBidirectional({
    defaultWidth: 400,
    defaultHeight: 200,
    minWidth: 200,
    minHeight: 100,
    maxWidthPercent: 0.6,
    maxHeightPercent: 0.5
  });

  return (
    <div>
      <div data-testid="width">{width}</div>
      <div data-testid="height">{height}</div>
      <button
        data-testid="corner-handle"
        onMouseDown={handleCornerMouseDown}
        onTouchStart={handleCornerTouchStart}
        type="button"
      >
        corner
      </button>
      <button
        data-testid="vertical-handle"
        onMouseDown={handleVerticalMouseDown}
        onTouchStart={handleVerticalTouchStart}
        type="button"
      >
        vertical
      </button>
    </div>
  );
}

describe('useResizableBidirectional', () => {
  it('updates both width and height on corner drag', () => {
    render(<BidirectionalHarness />);

    const handle = screen.getByTestId('corner-handle');
    const width = screen.getByTestId('width');
    const height = screen.getByTestId('height');

    act(() => {
      handle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: 500,
          clientY: 400
        })
      );
    });

    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 450,
          clientY: 350
        })
      );
    });

    expect(width.textContent).toBe('450');
    expect(height.textContent).toBe('250');

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
  });

  it('updates only height on vertical drag', () => {
    render(<BidirectionalHarness />);

    const handle = screen.getByTestId('vertical-handle');
    const width = screen.getByTestId('width');
    const height = screen.getByTestId('height');

    act(() => {
      handle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: 500,
          clientY: 400
        })
      );
    });

    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 450,
          clientY: 350
        })
      );
    });

    expect(width.textContent).toBe('400');
    expect(height.textContent).toBe('250');

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
  });

  it('does not update when dragging has not started', () => {
    render(<BidirectionalHarness />);

    const width = screen.getByTestId('width');
    const height = screen.getByTestId('height');

    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 300,
          clientY: 300
        })
      );
    });

    expect(width.textContent).toBe('400');
    expect(height.textContent).toBe('200');
  });

  it('ignores corner touch start events without touches', () => {
    render(<BidirectionalHarness />);

    const handle = screen.getByTestId('corner-handle');

    act(() => {
      const event = new Event('touchstart', { bubbles: true });
      Object.defineProperty(event, 'touches', { value: [] });
      handle.dispatchEvent(event);
    });

    const width = screen.getByTestId('width');
    const height = screen.getByTestId('height');
    expect(width.textContent).toBe('400');
    expect(height.textContent).toBe('200');
  });

  it('ignores vertical touch start events without touches', () => {
    render(<BidirectionalHarness />);

    const handle = screen.getByTestId('vertical-handle');

    act(() => {
      const event = new Event('touchstart', { bubbles: true });
      Object.defineProperty(event, 'touches', { value: [] });
      handle.dispatchEvent(event);
    });

    const width = screen.getByTestId('width');
    const height = screen.getByTestId('height');
    expect(width.textContent).toBe('400');
    expect(height.textContent).toBe('200');
  });

  it('ignores touch move without touches', () => {
    render(<BidirectionalHarness />);

    const handle = screen.getByTestId('corner-handle');

    act(() => {
      const touchStartEvent = new Event('touchstart', { bubbles: true });
      Object.defineProperty(touchStartEvent, 'touches', {
        value: [{ clientX: 500, clientY: 400 }]
      });
      handle.dispatchEvent(touchStartEvent);
    });

    act(() => {
      const touchMoveEvent = new Event('touchmove', { bubbles: true });
      Object.defineProperty(touchMoveEvent, 'touches', { value: [] });
      document.dispatchEvent(touchMoveEvent);
    });

    const width = screen.getByTestId('width');
    const height = screen.getByTestId('height');
    expect(width.textContent).toBe('400');
    expect(height.textContent).toBe('200');

    act(() => {
      document.dispatchEvent(new Event('touchend', { bubbles: true }));
    });
  });

  it('ignores drag moves after the drag has ended', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    render(<BidirectionalHarness />);

    const handle = screen.getByTestId('corner-handle');
    const width = screen.getByTestId('width');
    const height = screen.getByTestId('height');

    act(() => {
      handle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: 500,
          clientY: 400
        })
      );
    });

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    const moveHandler = addSpy.mock.calls.find(
      ([type]) => type === 'mousemove'
    )?.[1];

    if (typeof moveHandler === 'function') {
      act(() => {
        moveHandler(
          new MouseEvent('mousemove', {
            bubbles: true,
            clientX: 300,
            clientY: 300
          })
        );
      });
    }

    expect(width.textContent).toBe('400');
    expect(height.textContent).toBe('200');
    addSpy.mockRestore();
  });

  it('respects min dimensions', () => {
    render(<BidirectionalHarness />);

    const handle = screen.getByTestId('corner-handle');
    const width = screen.getByTestId('width');
    const height = screen.getByTestId('height');

    act(() => {
      handle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: 500,
          clientY: 400
        })
      );
    });

    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 800,
          clientY: 600
        })
      );
    });

    expect(width.textContent).toBe('200');
    expect(height.textContent).toBe('100');

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
  });

  it('handles touch drag on corner handle', () => {
    render(<BidirectionalHarness />);

    const handle = screen.getByTestId('corner-handle');
    const width = screen.getByTestId('width');
    const height = screen.getByTestId('height');

    act(() => {
      const touchStartEvent = new Event('touchstart', { bubbles: true });
      Object.defineProperty(touchStartEvent, 'touches', {
        value: [{ clientX: 500, clientY: 400 }]
      });
      handle.dispatchEvent(touchStartEvent);
    });

    act(() => {
      const touchMoveEvent = new Event('touchmove', { bubbles: true });
      Object.defineProperty(touchMoveEvent, 'touches', {
        value: [{ clientX: 450, clientY: 350 }]
      });
      document.dispatchEvent(touchMoveEvent);
    });

    expect(width.textContent).toBe('450');
    expect(height.textContent).toBe('250');

    act(() => {
      document.dispatchEvent(new Event('touchend', { bubbles: true }));
    });
  });

  it('handles touch drag on vertical handle', () => {
    render(<BidirectionalHarness />);

    const handle = screen.getByTestId('vertical-handle');
    const width = screen.getByTestId('width');
    const height = screen.getByTestId('height');

    act(() => {
      const touchStartEvent = new Event('touchstart', { bubbles: true });
      Object.defineProperty(touchStartEvent, 'touches', {
        value: [{ clientX: 500, clientY: 400 }]
      });
      handle.dispatchEvent(touchStartEvent);
    });

    act(() => {
      const touchMoveEvent = new Event('touchmove', { bubbles: true });
      Object.defineProperty(touchMoveEvent, 'touches', {
        value: [{ clientX: 450, clientY: 350 }]
      });
      document.dispatchEvent(touchMoveEvent);
    });

    expect(width.textContent).toBe('400');
    expect(height.textContent).toBe('250');

    act(() => {
      document.dispatchEvent(new Event('touchend', { bubbles: true }));
    });
  });

  it('respects max dimensions', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1000
    });
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 1000
    });

    render(<BidirectionalHarness />);

    const handle = screen.getByTestId('corner-handle');
    const widthEl = screen.getByTestId('width');
    const heightEl = screen.getByTestId('height');

    act(() => {
      handle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: 500,
          clientY: 400
        })
      );
    });

    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: -500,
          clientY: -500
        })
      );
    });

    // From harness: maxWidthPercent: 0.6, maxHeightPercent: 0.5
    // maxWidth = 1000 * 0.6 = 600
    // maxHeight = 1000 * 0.5 = 500
    expect(widthEl.textContent).toBe('600');
    expect(heightEl.textContent).toBe('500');

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
  });
});
