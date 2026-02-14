import { render } from '@testing-library/react';
import {
  DESKTOP_WINDOW_FOOTER_HEIGHT,
  DesktopFloatingWindow
} from './DesktopFloatingWindow.js';
import type { FloatingWindowProps } from './FloatingWindow.js';

const renderedProps: FloatingWindowProps[] = [];

vi.mock('./FloatingWindow.js', () => ({
  FloatingWindow: (props: FloatingWindowProps) => {
    renderedProps.push(props);
    return <div data-testid="floating-window">{props.children}</div>;
  }
}));

describe('DesktopFloatingWindow', () => {
  beforeEach(() => {
    renderedProps.length = 0;
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
      >
        <div>content</div>
      </DesktopFloatingWindow>
    );

    expect(renderedProps).toHaveLength(1);
    expect(renderedProps[0]?.id).toBe('window-1');
    expect(renderedProps[0]?.title).toBe('Desktop');
    expect(renderedProps[0]?.zIndex).toBe(100);
    expect(renderedProps[0]?.defaultWidth).toBe(720);
    expect(renderedProps[0]?.footerHeight).toBe(DESKTOP_WINDOW_FOOTER_HEIGHT);
  });
});
