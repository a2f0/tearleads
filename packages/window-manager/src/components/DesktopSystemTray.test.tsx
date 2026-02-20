import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DesktopSystemTray } from './DesktopSystemTray';

describe('DesktopSystemTray', () => {
  it('renders children', () => {
    render(
      <DesktopSystemTray footerHeight={48}>
        <span data-testid="tray-item">Tray Item</span>
      </DesktopSystemTray>
    );

    expect(screen.getByTestId('tray-item')).toBeInTheDocument();
    expect(screen.getByText('Tray Item')).toBeInTheDocument();
  });

  it('has correct test id', () => {
    render(
      <DesktopSystemTray footerHeight={48}>
        <span>Content</span>
      </DesktopSystemTray>
    );

    expect(screen.getByTestId('system-tray')).toBeInTheDocument();
  });

  it('applies positioning based on footerHeight', () => {
    render(
      <DesktopSystemTray footerHeight={48}>
        <span>Content</span>
      </DesktopSystemTray>
    );

    const tray = screen.getByTestId('system-tray');
    // Check that the style contains the expected calculation values
    expect(tray.style.bottom).toContain('24px');
    expect(tray.style.bottom).toContain('0.75rem');
  });

  it('applies custom className', () => {
    render(
      <DesktopSystemTray footerHeight={48} className="custom-class">
        <span>Content</span>
      </DesktopSystemTray>
    );

    expect(screen.getByTestId('system-tray')).toHaveClass('custom-class');
  });

  it('applies custom style overrides', () => {
    render(
      <DesktopSystemTray footerHeight={48} style={{ backgroundColor: 'red' }}>
        <span>Content</span>
      </DesktopSystemTray>
    );

    const tray = screen.getByTestId('system-tray');
    expect(tray.style.backgroundColor).toBe('red');
  });

  it('has fixed positioning classes', () => {
    render(
      <DesktopSystemTray footerHeight={48}>
        <span>Content</span>
      </DesktopSystemTray>
    );

    const tray = screen.getByTestId('system-tray');
    expect(tray).toHaveClass('fixed');
    expect(tray).toHaveClass('z-50');
  });

  it('renders multiple children with gap', () => {
    render(
      <DesktopSystemTray footerHeight={48}>
        <span data-testid="item-1">Item 1</span>
        <span data-testid="item-2">Item 2</span>
        <span data-testid="item-3">Item 3</span>
      </DesktopSystemTray>
    );

    expect(screen.getByTestId('item-1')).toBeInTheDocument();
    expect(screen.getByTestId('item-2')).toBeInTheDocument();
    expect(screen.getByTestId('item-3')).toBeInTheDocument();
  });
});
