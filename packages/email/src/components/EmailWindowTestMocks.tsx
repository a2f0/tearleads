import type { ReactNode } from 'react';
import { vi } from 'vitest';

const windowManagerMock: Record<string, unknown> = {
  WINDOW_TABLE_TYPOGRAPHY: {
    table: 'w-full text-left text-xs',
    header: 'sticky top-0 border-b bg-muted/50 text-muted-foreground',
    headerCell: 'px-2 py-1.5 text-left font-medium',
    cell: 'px-2 py-1.5',
    mutedCell: 'px-2 py-1.5 text-muted-foreground'
  },
  FloatingWindow: ({
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
  ),
  WindowControlBar: ({ children }: { children: ReactNode }) => (
    <div data-testid="control-bar">{children}</div>
  ),
  WindowControlGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  WindowControlButton: ({
    children,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
  useResizableSidebar: () => ({
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
  }),
  WindowTableRow: ({
    children,
    isDimmed: _isDimmed,
    isSelected: _isSelected,
    ...props
  }: {
    children: ReactNode;
    isDimmed?: boolean;
    isSelected?: boolean;
  } & React.HTMLAttributes<HTMLTableRowElement>) => (
    <tr {...props}>{children}</tr>
  )
};

const EmailWindowMenuBarMock = ({
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
);

export { EmailWindowMenuBarMock, windowManagerMock };
