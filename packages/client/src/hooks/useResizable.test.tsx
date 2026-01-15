import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useResizable } from './useResizable';

function ResizableHarness() {
  const { height, handleMouseDown, handleTouchStart } = useResizable({
    defaultHeight: 200,
    minHeight: 100,
    maxHeightPercent: 0.5
  });

  return (
    <div>
      <div data-testid="height">{height}</div>
      <button
        data-testid="handle"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        type="button"
      >
        handle
      </button>
    </div>
  );
}

describe('useResizable', () => {
  it('updates height on mouse drag', () => {
    render(<ResizableHarness />);

    const handle = screen.getByTestId('handle');
    const height = screen.getByTestId('height');

    act(() => {
      handle.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientY: 400 })
      );
    });

    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientY: 350 })
      );
    });

    expect(height.textContent).toBe('250');

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
  });

  it('does not update height when dragging has not started', () => {
    render(<ResizableHarness />);

    const height = screen.getByTestId('height');

    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientY: 300 })
      );
    });

    expect(height.textContent).toBe('200');
  });

  it('ignores touch start events without touches', () => {
    render(<ResizableHarness />);

    const handle = screen.getByTestId('handle');

    act(() => {
      const event = new Event('touchstart', { bubbles: true });
      Object.defineProperty(event, 'touches', { value: [] });
      handle.dispatchEvent(event);
    });

    const height = screen.getByTestId('height');
    expect(height.textContent).toBe('200');
  });

  it('ignores drag moves after the drag has ended', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    render(<ResizableHarness />);

    const handle = screen.getByTestId('handle');
    const height = screen.getByTestId('height');

    act(() => {
      handle.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientY: 400 })
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
          new MouseEvent('mousemove', { bubbles: true, clientY: 300 })
        );
      });
    }

    expect(height.textContent).toBe('200');
    addSpy.mockRestore();
  });
});
