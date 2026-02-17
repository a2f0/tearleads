import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  BusinessesProvider,
  type BusinessesUIComponents
} from '../context/BusinessesContext.js';
import { BusinessesWindow } from './BusinessesWindow.js';

interface CapturedWindowProps {
  title: string;
  defaultWidth: number;
  defaultHeight: number;
  minWidth: number;
  minHeight: number;
  zIndex: number;
}

let capturedWindowProps: CapturedWindowProps | null = null;

vi.mock('@tearleads/window-manager', () => ({
  DesktopFloatingWindow: ({
    children,
    title,
    defaultWidth,
    defaultHeight,
    minWidth,
    minHeight,
    zIndex
  }: {
    children: ReactNode;
    title: string;
    defaultWidth: number;
    defaultHeight: number;
    minWidth: number;
    minHeight: number;
    zIndex: number;
  }) => {
    capturedWindowProps = {
      title,
      defaultWidth,
      defaultHeight,
      minWidth,
      minHeight,
      zIndex
    };
    return <div data-testid="floating-window">{children}</div>;
  },
  WindowControlBar: ({ children }: { children: ReactNode }) => (
    <div data-testid="window-control-bar">{children}</div>
  ),
  WindowMenuBar: ({ children }: { children: ReactNode }) => (
    <div data-testid="window-menu-bar">{children}</div>
  )
}));

const uiComponents: BusinessesUIComponents = {
  DropdownMenu: ({ trigger, children }) => (
    <div>
      <span>{trigger}</span>
      {children}
    </div>
  ),
  DropdownMenuItem: ({ children, onClick }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AboutMenuItem: ({ appName, closeLabel }) => (
    <span>
      {appName}:{closeLabel}
    </span>
  )
};

describe('BusinessesWindow', () => {
  it('renders menu bar and forwards window sizing defaults', () => {
    const onClose = vi.fn();

    render(
      <BusinessesProvider ui={uiComponents}>
        <BusinessesWindow
          id="businesses-window"
          onClose={onClose}
          onMinimize={vi.fn()}
          onFocus={vi.fn()}
          zIndex={42}
        >
          <div>Body content</div>
        </BusinessesWindow>
      </BusinessesProvider>
    );

    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
    expect(screen.getByText('File')).toBeInTheDocument();
    expect(screen.getByText('Help')).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeInTheDocument();
    expect(screen.getByTestId('window-control-bar')).toBeInTheDocument();

    expect(capturedWindowProps).toEqual({
      title: 'Businesses',
      defaultWidth: 860,
      defaultHeight: 560,
      minWidth: 620,
      minHeight: 420,
      zIndex: 42
    });
  });

  it('triggers close from the menu item', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <BusinessesProvider ui={uiComponents}>
        <BusinessesWindow
          id="businesses-window"
          onClose={onClose}
          onMinimize={vi.fn()}
          onFocus={vi.fn()}
          zIndex={1}
        />
      </BusinessesProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Businesses:Close')).toBeInTheDocument();
  });
});
