import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useResizableSidebar } from './useResizableSidebar.js';

interface TestSidebarProps {
  onWidthChange?: (width: number) => void;
  resizeFrom?: 'left' | 'right';
}

function TestSidebar({ onWidthChange, resizeFrom }: TestSidebarProps) {
  const [width, setWidth] = useState(200);

  const { resizeHandleProps } = useResizableSidebar({
    width,
    ariaLabel: 'Resize test sidebar',
    ...(resizeFrom ? { resizeFrom } : {}),
    onWidthChange: (nextWidth) => {
      setWidth(nextWidth);
      onWidthChange?.(nextWidth);
    }
  });

  return (
    <div style={{ width }}>
      <hr data-testid="resize-handle" {...resizeHandleProps} />
      <span data-testid="current-width">{width}</span>
    </div>
  );
}

describe('useResizableSidebar', () => {
  it('supports keyboard resize', async () => {
    const user = userEvent.setup();
    const onWidthChange = vi.fn();
    render(<TestSidebar onWidthChange={onWidthChange} />);

    const handle = screen.getByRole('separator', {
      name: 'Resize test sidebar'
    });
    handle.focus();

    await user.keyboard('{ArrowRight}');
    expect(onWidthChange).toHaveBeenCalledWith(210);

    await user.keyboard('{ArrowLeft}');
    expect(onWidthChange).toHaveBeenCalledWith(200);
  });

  it('inverts keyboard resize for left edge handles', async () => {
    const user = userEvent.setup();
    const onWidthChange = vi.fn();
    render(<TestSidebar onWidthChange={onWidthChange} resizeFrom="left" />);

    const handle = screen.getByRole('separator', {
      name: 'Resize test sidebar'
    });
    handle.focus();

    await user.keyboard('{ArrowRight}');
    expect(onWidthChange).toHaveBeenCalledWith(190);

    await user.keyboard('{ArrowLeft}');
    expect(onWidthChange).toHaveBeenCalledWith(200);
  });

  it('clamps width to defaults', async () => {
    const user = userEvent.setup();
    render(<TestSidebar />);

    const handle = screen.getByRole('separator', {
      name: 'Resize test sidebar'
    });
    handle.focus();

    for (let i = 0; i < 15; i += 1) {
      await user.keyboard('{ArrowLeft}');
    }

    expect(screen.getByTestId('current-width')).toHaveTextContent('150');
  });

  it('supports mouse drag resize', async () => {
    const user = userEvent.setup();
    const onWidthChange = vi.fn();
    render(<TestSidebar onWidthChange={onWidthChange} />);

    const handle = screen.getByTestId('resize-handle');
    await user.pointer({ keys: '[MouseLeft>]', target: handle });
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 240 }));
      document.dispatchEvent(new MouseEvent('mouseup'));
    });

    expect(onWidthChange).toHaveBeenCalled();
  });
});
