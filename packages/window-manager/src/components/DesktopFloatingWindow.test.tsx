import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_WINDOW_FOOTER_HEIGHT,
  DesktopFloatingWindow
} from './DesktopFloatingWindow.js';

describe('DesktopFloatingWindow', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024
    });
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 768
    });
  });

  it('passes through props and applies desktop footer height', () => {
    const onClose = vi.fn();
    const onMinimize = vi.fn();
    const onFocus = vi.fn();

    render(
      <DesktopFloatingWindow
        id="window-1"
        title="Desktop"
        onClose={onClose}
        onMinimize={onMinimize}
        onFocus={onFocus}
        zIndex={100}
        defaultWidth={720}
        defaultHeight={400}
      >
        <div>content</div>
      </DesktopFloatingWindow>
    );

    const dialog = screen.getByRole('dialog', { name: 'Desktop' });
    expect(dialog).toHaveStyle({ zIndex: '100', width: '720px' });
    expect(screen.getByText('content')).toBeInTheDocument();

    fireEvent.click(dialog);
    expect(onFocus).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /minimize/i }));
    expect(onMinimize).toHaveBeenCalledWith({
      width: 720,
      height: 400,
      x: 152,
      y: 184
    });

    fireEvent.doubleClick(screen.getByTestId('floating-window-window-1-title-bar'));
    expect(dialog).toHaveStyle({
      height: `${768 - DESKTOP_WINDOW_FOOTER_HEIGHT}px`
    });
  });
});
