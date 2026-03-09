import * as windowManagerModule from '@tearleads/window-manager';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { vi } from 'vitest';
import * as emailWindowMenuBarModule from '../components/EmailWindowMenuBar';

export function installEmailWindowModuleMocks() {
  vi.spyOn(windowManagerModule, 'FloatingWindow').mockImplementation(
    ({
      children,
      title,
      onClose
    }: {
      children: ReactNode;
      title: string;
      onClose: () => void;
    }) => (
      <div data-testid="floating-window">
        <div data-testid="window-title">{title}</div>
        <button type="button" onClick={onClose} data-testid="close-window">
          Close
        </button>
        {children}
      </div>
    )
  );

  vi.spyOn(windowManagerModule, 'WindowControlBar').mockImplementation(
    ({ children }: { children: ReactNode }) => (
      <div data-testid="control-bar">{children}</div>
    )
  );

  vi.spyOn(windowManagerModule, 'WindowControlGroup').mockImplementation(
    ({ children }: { children: ReactNode }) => <div>{children}</div>
  );

  vi.spyOn(windowManagerModule, 'WindowControlButton').mockImplementation(
    ({
      children,
      onClick,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode }) => (
      <button type="button" onClick={onClick} {...props}>
        {children}
      </button>
    )
  );

  vi.spyOn(windowManagerModule, 'useResizableSidebar').mockReturnValue({
    resizeHandleProps: {
      role: 'separator',
      tabIndex: 0,
      'aria-orientation': 'vertical',
      'aria-valuenow': 180,
      'aria-valuemin': 150,
      'aria-valuemax': 400,
      'aria-label': 'Resize sidebar',
      onMouseDown: vi.fn(),
      onKeyDown: vi.fn()
    }
  });

  vi.spyOn(emailWindowMenuBarModule, 'EmailWindowMenuBar').mockImplementation(
    ({
      viewMode,
      onViewModeChange,
      onRefresh,
      onCompose
    }: {
      viewMode: string;
      onViewModeChange: (mode: 'list' | 'table') => void;
      onRefresh: () => void;
      onCompose: () => void;
      onClose: () => void;
    }) => (
      <div data-testid="menu-bar">
        <span data-testid="current-view-mode">{viewMode}</span>
        <button type="button" onClick={onCompose} data-testid="compose">
          Compose
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange('table')}
          data-testid="switch-to-table"
        >
          Table
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange('list')}
          data-testid="switch-to-list"
        >
          List
        </button>
        <button type="button" onClick={onRefresh} data-testid="refresh">
          Refresh
        </button>
      </div>
    )
  );
}
