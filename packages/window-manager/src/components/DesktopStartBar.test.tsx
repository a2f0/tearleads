import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DesktopStartBar } from './DesktopStartBar';

describe('DesktopStartBar', () => {
  it('renders children', () => {
    render(
      <DesktopStartBar>
        <span data-testid="child">Child content</span>
      </DesktopStartBar>
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('has correct test id', () => {
    render(
      <DesktopStartBar>
        <span>Content</span>
      </DesktopStartBar>
    );

    expect(screen.getByTestId('start-bar')).toBeInTheDocument();
  });

  it('calls onContextMenu when right-clicked', () => {
    const onContextMenu = vi.fn();

    render(
      <DesktopStartBar onContextMenu={onContextMenu}>
        <span>Content</span>
      </DesktopStartBar>
    );

    fireEvent.contextMenu(screen.getByTestId('start-bar'));

    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });

  it('applies custom className', () => {
    render(
      <DesktopStartBar className="custom-class">
        <span>Content</span>
      </DesktopStartBar>
    );

    expect(screen.getByTestId('start-bar')).toHaveClass('custom-class');
  });

  it('has default flex layout classes', () => {
    render(
      <DesktopStartBar>
        <span>Content</span>
      </DesktopStartBar>
    );

    const startBar = screen.getByTestId('start-bar');
    expect(startBar).toHaveClass('flex');
    expect(startBar).toHaveClass('items-center');
    expect(startBar).toHaveClass('gap-2');
  });
});
