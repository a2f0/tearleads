import type { Database } from '@tearleads/db/sqlite';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { NotesUIComponents } from '../context/NotesContext';
import { NotesProvider } from '../context/NotesContext';
import {
  createMockAuth,
  createMockDatabase,
  createMockDatabaseState,
  createMockFeatureFlags,
  createMockVfsApi,
  createMockVfsKeys
} from '../test/testUtils';
import { NotesWindow } from './NotesWindow';

vi.mock('@tearleads/window-manager', () => ({
  FloatingWindow: ({ children }: { children: ReactNode }) => (
    <div data-testid="floating-window">{children}</div>
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
  WindowPaneState: ({ title }: { title: string }) => (
    <div data-testid="window-pane-state">{title}</div>
  )
}));

function createClickableUI() {
  return {
    Button: ({
      children,
      onClick,
      ...props
    }: { children: ReactNode; onClick?: () => void } & Record<
      string,
      unknown
    >) => (
      <button type="button" onClick={onClick} {...props}>
        {children}
      </button>
    ),
    Input: (props: Record<string, unknown>) => <input {...props} />,
    ContextMenu: ({ children }: { children: ReactNode }) => (
      <div data-testid="context-menu">{children}</div>
    ),
    ContextMenuItem: ({ children }: { children: ReactNode }) => (
      <div data-testid="context-menu-item">{children}</div>
    ),
    ListRow: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    RefreshButton: () => <button type="button">Refresh</button>,
    VirtualListStatus: () => <div>Status</div>,
    InlineUnlock: () => <div data-testid="inline-unlock">Unlock</div>,
    EditableTitle: () => <div>Title</div>,
    DropdownMenu: ({
      trigger,
      children
    }: {
      trigger: string;
      children: ReactNode;
    }) => (
      <div data-testid={`dropdown-${trigger.toLowerCase()}`}>{children}</div>
    ),
    DropdownMenuItem: ({
      children,
      onClick
    }: {
      children: ReactNode;
      onClick?: () => void;
    }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
    DropdownMenuSeparator: () => <hr />,
    WindowOptionsMenuItem: () => <div>Options</div>,
    AboutMenuItem: () => <div>About</div>
  };
}

describe('NotesWindow', () => {
  function renderNotesWindow(options: { isUnlocked?: boolean } = {}) {
    const { isUnlocked = false } = options;
    const mockDb = createMockDatabase();
    mockDb.from.mockResolvedValue([]);
    mockDb.where.mockResolvedValue([]);

    return render(
      <NotesProvider
        databaseState={{ ...createMockDatabaseState(), isUnlocked }}
        getDatabase={() => mockDb as unknown as Database}
        ui={createClickableUI() as unknown as NotesUIComponents}
        t={(key) => key}
        tooltipZIndex={10000}
        vfsKeys={createMockVfsKeys()}
        auth={createMockAuth()}
        featureFlags={createMockFeatureFlags()}
        vfsApi={createMockVfsApi()}
      >
        <NotesWindow
          id="test-notes-window"
          onClose={vi.fn()}
          onMinimize={vi.fn()}
          onFocus={vi.fn()}
          zIndex={100}
        />
      </NotesProvider>
    );
  }

  it('renders the notes window', () => {
    renderNotesWindow();
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows unlock prompt when database is locked', () => {
    renderNotesWindow({ isUnlocked: false });
    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('renders the File dropdown menu', () => {
    renderNotesWindow({ isUnlocked: false });
    expect(screen.getByTestId('dropdown-file')).toBeInTheDocument();
  });

  it('renders the View dropdown menu', () => {
    renderNotesWindow({ isUnlocked: false });
    expect(screen.getByTestId('dropdown-view')).toBeInTheDocument();
  });

  it('renders control bar with disabled New action when locked', () => {
    renderNotesWindow({ isUnlocked: false });
    expect(screen.getByTestId('control-bar')).toBeInTheDocument();
    expect(screen.getByTestId('notes-window-control-new')).toBeDisabled();
  });

  it('renders enabled New action when unlocked', () => {
    renderNotesWindow({ isUnlocked: true });

    const newButton = screen.getByTestId('notes-window-control-new');
    expect(newButton).toBeEnabled();
    expect(screen.getByTestId('control-bar')).toBeInTheDocument();
  });
});
