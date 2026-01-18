import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowManagerProvider } from '@/contexts/WindowManagerContext';
import { WindowRenderer } from './WindowRenderer';

interface WindowDimensions {
  x: number;
  y: number;
  width: number;
  height: number;
}

vi.mock('@/components/notes-window', () => ({
  NotesWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`notes-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 400, height: 300 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/console-window', () => ({
  ConsoleWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`console-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 600, height: 400 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/email-window', () => ({
  EmailWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`email-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 550, height: 450 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/settings-window', () => ({
  SettingsWindow: ({
    id,
    onClose,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`settings-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
    </div>
  )
}));

vi.mock('@/components/photos-window', () => ({
  PhotosWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`photos-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 700, height: 550 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/keychain-window', () => ({
  KeychainWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`keychain-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 600, height: 500 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/files-window', () => ({
  FilesWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`files-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 500, height: 400 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/tables-window', () => ({
  TablesWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`tables-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 750, height: 500 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/documents-window', () => ({
  DocumentsWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`documents-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 700, height: 550 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/video-window', () => ({
  VideoWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`video-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 720, height: 520 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/contacts-window', () => ({
  ContactsWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`contacts-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 600, height: 500 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/sqlite-window', () => ({
  SqliteWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`sqlite-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 600, height: 500 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/cache-storage-window', () => ({
  CacheStorageWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`cache-storage-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 650, height: 500 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/opfs-window', () => ({
  OpfsWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`opfs-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 720, height: 560 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/analytics-window', () => ({
  AnalyticsWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`analytics-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 700, height: 550 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/audio-window', () => ({
  AudioWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`audio-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 600, height: 500 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/admin-window', () => ({
  AdminWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`admin-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 700, height: 600 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/chat-window', () => ({
  ChatWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`chat-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 700, height: 600 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

const mockOpenWindow = vi.fn();
const mockCloseWindow = vi.fn();
const mockFocusWindow = vi.fn();
const mockMinimizeWindow = vi.fn();

vi.mock('@/contexts/WindowManagerContext', async () => {
  const actual = await vi.importActual('@/contexts/WindowManagerContext');
  return {
    ...actual,
    useWindowManager: () => ({
      windows: mockWindows,
      openWindow: mockOpenWindow,
      closeWindow: mockCloseWindow,
      focusWindow: mockFocusWindow,
      minimizeWindow: mockMinimizeWindow,
      isWindowOpen: vi.fn(),
      getWindow: vi.fn()
    })
  };
});

let mockWindows: Array<{ id: string; type: string; zIndex: number }> = [];

function wrapper({ children }: { children: ReactNode }) {
  return <WindowManagerProvider>{children}</WindowManagerProvider>;
}

describe('WindowRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWindows = [];
  });

  it('renders nothing when no windows are open', () => {
    mockWindows = [];
    const { container } = render(<WindowRenderer />, { wrapper });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders notes window for notes type', () => {
    mockWindows = [{ id: 'notes-1', type: 'notes', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('notes-window-notes-1')).toBeInTheDocument();
  });

  it('renders multiple windows', () => {
    mockWindows = [
      { id: 'notes-1', type: 'notes', zIndex: 100 },
      { id: 'notes-2', type: 'notes', zIndex: 101 }
    ];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('notes-window-notes-1')).toBeInTheDocument();
    expect(screen.getByTestId('notes-window-notes-2')).toBeInTheDocument();
  });

  it('calls closeWindow when close button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'notes-1', type: 'notes', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('close-notes-1'));
    expect(mockCloseWindow).toHaveBeenCalledWith('notes-1');
  });

  it('calls focusWindow when window is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'notes-1', type: 'notes', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('notes-window-notes-1'));
    expect(mockFocusWindow).toHaveBeenCalledWith('notes-1');
  });

  it('passes correct zIndex to windows', () => {
    mockWindows = [
      { id: 'notes-1', type: 'notes', zIndex: 100 },
      { id: 'notes-2', type: 'notes', zIndex: 105 }
    ];
    render(<WindowRenderer />, { wrapper });

    expect(screen.getByTestId('notes-window-notes-1')).toHaveAttribute(
      'data-zindex',
      '100'
    );
    expect(screen.getByTestId('notes-window-notes-2')).toHaveAttribute(
      'data-zindex',
      '105'
    );
  });

  it('renders nothing for unknown window types', () => {
    mockWindows = [{ id: 'unknown-1', type: 'unknown' as string, zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    // Should render fragment but no window content
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders console window for console type', () => {
    mockWindows = [{ id: 'console-1', type: 'console', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('console-window-console-1')).toBeInTheDocument();
  });

  it('calls closeWindow when console close button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'console-1', type: 'console', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('close-console-1'));
    expect(mockCloseWindow).toHaveBeenCalledWith('console-1');
  });

  it('renders mixed window types', () => {
    mockWindows = [
      { id: 'notes-1', type: 'notes', zIndex: 100 },
      { id: 'console-1', type: 'console', zIndex: 101 }
    ];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('notes-window-notes-1')).toBeInTheDocument();
    expect(screen.getByTestId('console-window-console-1')).toBeInTheDocument();
  });

  it('renders settings window for settings type', () => {
    mockWindows = [{ id: 'settings-1', type: 'settings', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    expect(
      screen.getByTestId('settings-window-settings-1')
    ).toBeInTheDocument();
  });

  it('calls closeWindow when settings close button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'settings-1', type: 'settings', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('close-settings-1'));
    expect(mockCloseWindow).toHaveBeenCalledWith('settings-1');
  });

  it('renders email window for email type', () => {
    mockWindows = [{ id: 'email-1', type: 'email', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('email-window-email-1')).toBeInTheDocument();
  });

  it('calls closeWindow when email close button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'email-1', type: 'email', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('close-email-1'));
    expect(mockCloseWindow).toHaveBeenCalledWith('email-1');
  });

  it('calls focusWindow when email window is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'email-1', type: 'email', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('email-window-email-1'));
    expect(mockFocusWindow).toHaveBeenCalledWith('email-1');
  });

  it('renders all four window types together', () => {
    mockWindows = [
      { id: 'notes-1', type: 'notes', zIndex: 100 },
      { id: 'console-1', type: 'console', zIndex: 101 },
      { id: 'settings-1', type: 'settings', zIndex: 102 },
      { id: 'email-1', type: 'email', zIndex: 103 }
    ];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('notes-window-notes-1')).toBeInTheDocument();
    expect(screen.getByTestId('console-window-console-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('settings-window-settings-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('email-window-email-1')).toBeInTheDocument();
  });

  it('calls minimizeWindow when notes minimize button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'notes-1', type: 'notes', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('minimize-notes-1'));
    expect(mockMinimizeWindow).toHaveBeenCalledWith('notes-1', {
      x: 0,
      y: 0,
      width: 400,
      height: 300
    });
  });

  it('calls minimizeWindow when console minimize button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'console-1', type: 'console', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('minimize-console-1'));
    expect(mockMinimizeWindow).toHaveBeenCalledWith('console-1', {
      x: 0,
      y: 0,
      width: 600,
      height: 400
    });
  });

  it('calls minimizeWindow when email minimize button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'email-1', type: 'email', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('minimize-email-1'));
    expect(mockMinimizeWindow).toHaveBeenCalledWith('email-1', {
      x: 0,
      y: 0,
      width: 550,
      height: 450
    });
  });

  it('renders files window for files type', () => {
    mockWindows = [{ id: 'files-1', type: 'files', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('files-window-files-1')).toBeInTheDocument();
  });

  it('renders documents window for documents type', () => {
    mockWindows = [{ id: 'documents-1', type: 'documents', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    expect(
      screen.getByTestId('documents-window-documents-1')
    ).toBeInTheDocument();
  });

  it('renders tables window for tables type', () => {
    mockWindows = [{ id: 'tables-1', type: 'tables', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('tables-window-tables-1')).toBeInTheDocument();
  });

  it('renders photos window for photos type', () => {
    mockWindows = [{ id: 'photos-1', type: 'photos', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('photos-window-photos-1')).toBeInTheDocument();
  });

  it('renders keychain window for keychain type', () => {
    mockWindows = [{ id: 'keychain-1', type: 'keychain', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    expect(
      screen.getByTestId('keychain-window-keychain-1')
    ).toBeInTheDocument();
  });

  it('renders contacts window for contacts type', () => {
    mockWindows = [{ id: 'contacts-1', type: 'contacts', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    expect(
      screen.getByTestId('contacts-window-contacts-1')
    ).toBeInTheDocument();
  });

  it('renders sqlite window for sqlite type', () => {
    mockWindows = [{ id: 'sqlite-1', type: 'sqlite', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('sqlite-window-sqlite-1')).toBeInTheDocument();
  });

  it('renders opfs window for opfs type', () => {
    mockWindows = [{ id: 'opfs-1', type: 'opfs', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('opfs-window-opfs-1')).toBeInTheDocument();
  });

  it('calls closeWindow when contacts close button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'contacts-1', type: 'contacts', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('close-contacts-1'));
    expect(mockCloseWindow).toHaveBeenCalledWith('contacts-1');
  });

  it('calls focusWindow when contacts window is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'contacts-1', type: 'contacts', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('contacts-window-contacts-1'));
    expect(mockFocusWindow).toHaveBeenCalledWith('contacts-1');
  });

  it('calls minimizeWindow when contacts minimize button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'contacts-1', type: 'contacts', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('minimize-contacts-1'));
    expect(mockMinimizeWindow).toHaveBeenCalledWith('contacts-1', {
      x: 0,
      y: 0,
      width: 600,
      height: 500
    });
  });

  it('calls closeWindow when sqlite close button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'sqlite-1', type: 'sqlite', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('close-sqlite-1'));
    expect(mockCloseWindow).toHaveBeenCalledWith('sqlite-1');
  });

  it('calls focusWindow when sqlite window is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'sqlite-1', type: 'sqlite', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('sqlite-window-sqlite-1'));
    expect(mockFocusWindow).toHaveBeenCalledWith('sqlite-1');
  });

  it('calls minimizeWindow when sqlite minimize button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'sqlite-1', type: 'sqlite', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('minimize-sqlite-1'));
    expect(mockMinimizeWindow).toHaveBeenCalledWith('sqlite-1', {
      x: 0,
      y: 0,
      width: 600,
      height: 500
    });
  });

  it('calls closeWindow when opfs close button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'opfs-1', type: 'opfs', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('close-opfs-1'));
    expect(mockCloseWindow).toHaveBeenCalledWith('opfs-1');
  });

  it('calls minimizeWindow when opfs minimize button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'opfs-1', type: 'opfs', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('minimize-opfs-1'));
    expect(mockMinimizeWindow).toHaveBeenCalledWith('opfs-1', {
      x: 0,
      y: 0,
      width: 720,
      height: 560
    });
  });

  it('calls closeWindow when files close button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'files-1', type: 'files', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('close-files-1'));
    expect(mockCloseWindow).toHaveBeenCalledWith('files-1');
  });

  it('calls closeWindow when documents close button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'documents-1', type: 'documents', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('close-documents-1'));
    expect(mockCloseWindow).toHaveBeenCalledWith('documents-1');
  });

  it('calls focusWindow when files window is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'files-1', type: 'files', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('files-window-files-1'));
    expect(mockFocusWindow).toHaveBeenCalledWith('files-1');
  });

  it('calls focusWindow when documents window is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'documents-1', type: 'documents', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('documents-window-documents-1'));
    expect(mockFocusWindow).toHaveBeenCalledWith('documents-1');
  });

  it('calls minimizeWindow when files minimize button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'files-1', type: 'files', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('minimize-files-1'));
    expect(mockMinimizeWindow).toHaveBeenCalledWith('files-1', {
      x: 0,
      y: 0,
      width: 500,
      height: 400
    });
  });

  it('calls minimizeWindow when documents minimize button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'documents-1', type: 'documents', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('minimize-documents-1'));
    expect(mockMinimizeWindow).toHaveBeenCalledWith('documents-1', {
      x: 0,
      y: 0,
      width: 700,
      height: 550
    });
  });

  it('calls closeWindow when tables close button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'tables-1', type: 'tables', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('close-tables-1'));
    expect(mockCloseWindow).toHaveBeenCalledWith('tables-1');
  });

  it('calls focusWindow when tables window is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'tables-1', type: 'tables', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('tables-window-tables-1'));
    expect(mockFocusWindow).toHaveBeenCalledWith('tables-1');
  });

  it('calls minimizeWindow when tables minimize button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'tables-1', type: 'tables', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('minimize-tables-1'));
    expect(mockMinimizeWindow).toHaveBeenCalledWith('tables-1', {
      x: 0,
      y: 0,
      width: 750,
      height: 500
    });
  });

  it('calls closeWindow when photos close button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'photos-1', type: 'photos', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('close-photos-1'));
    expect(mockCloseWindow).toHaveBeenCalledWith('photos-1');
  });

  it('calls focusWindow when photos window is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'photos-1', type: 'photos', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('photos-window-photos-1'));
    expect(mockFocusWindow).toHaveBeenCalledWith('photos-1');
  });

  it('calls minimizeWindow when photos minimize button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'photos-1', type: 'photos', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('minimize-photos-1'));
    expect(mockMinimizeWindow).toHaveBeenCalledWith('photos-1', {
      x: 0,
      y: 0,
      width: 700,
      height: 550
    });
  });

  it('calls closeWindow when keychain close button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'keychain-1', type: 'keychain', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('close-keychain-1'));
    expect(mockCloseWindow).toHaveBeenCalledWith('keychain-1');
  });

  it('calls focusWindow when keychain window is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'keychain-1', type: 'keychain', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('keychain-window-keychain-1'));
    expect(mockFocusWindow).toHaveBeenCalledWith('keychain-1');
  });

  it('calls minimizeWindow when keychain minimize button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'keychain-1', type: 'keychain', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('minimize-keychain-1'));
    expect(mockMinimizeWindow).toHaveBeenCalledWith('keychain-1', {
      x: 0,
      y: 0,
      width: 600,
      height: 500
    });
  });

  it('renders analytics window for analytics type', () => {
    mockWindows = [{ id: 'analytics-1', type: 'analytics', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    expect(
      screen.getByTestId('analytics-window-analytics-1')
    ).toBeInTheDocument();
  });

  it('calls closeWindow when analytics close button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'analytics-1', type: 'analytics', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('close-analytics-1'));
    expect(mockCloseWindow).toHaveBeenCalledWith('analytics-1');
  });

  it('calls focusWindow when analytics window is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'analytics-1', type: 'analytics', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('analytics-window-analytics-1'));
    expect(mockFocusWindow).toHaveBeenCalledWith('analytics-1');
  });

  it('calls minimizeWindow when analytics minimize button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'analytics-1', type: 'analytics', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('minimize-analytics-1'));
    expect(mockMinimizeWindow).toHaveBeenCalledWith('analytics-1', {
      x: 0,
      y: 0,
      width: 700,
      height: 550
    });
  });

  it('renders audio window for audio type', () => {
    mockWindows = [{ id: 'audio-1', type: 'audio', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('audio-window-audio-1')).toBeInTheDocument();
  });

  it('calls closeWindow when audio close button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'audio-1', type: 'audio', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('close-audio-1'));
    expect(mockCloseWindow).toHaveBeenCalledWith('audio-1');
  });

  it('calls focusWindow when audio window is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'audio-1', type: 'audio', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('audio-window-audio-1'));
    expect(mockFocusWindow).toHaveBeenCalledWith('audio-1');
  });

  it('calls minimizeWindow when audio minimize button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'audio-1', type: 'audio', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('minimize-audio-1'));
    expect(mockMinimizeWindow).toHaveBeenCalledWith('audio-1', {
      x: 0,
      y: 0,
      width: 600,
      height: 500
    });
  });

  it('renders admin window for admin type', () => {
    mockWindows = [{ id: 'admin-1', type: 'admin', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('admin-window-admin-1')).toBeInTheDocument();
  });

  it('calls closeWindow when admin close button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'admin-1', type: 'admin', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('close-admin-1'));
    expect(mockCloseWindow).toHaveBeenCalledWith('admin-1');
  });

  it('calls focusWindow when admin window is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'admin-1', type: 'admin', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('admin-window-admin-1'));
    expect(mockFocusWindow).toHaveBeenCalledWith('admin-1');
  });

  it('calls minimizeWindow when admin minimize button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'admin-1', type: 'admin', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('minimize-admin-1'));
    expect(mockMinimizeWindow).toHaveBeenCalledWith('admin-1', {
      x: 0,
      y: 0,
      width: 700,
      height: 600
    });
  });

  it('renders chat window for chat type', () => {
    mockWindows = [{ id: 'chat-1', type: 'chat', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('chat-window-chat-1')).toBeInTheDocument();
  });

  it('calls closeWindow when chat close button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'chat-1', type: 'chat', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('close-chat-1'));
    expect(mockCloseWindow).toHaveBeenCalledWith('chat-1');
  });

  it('calls focusWindow when chat window is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'chat-1', type: 'chat', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('chat-window-chat-1'));
    expect(mockFocusWindow).toHaveBeenCalledWith('chat-1');
  });

  it('calls minimizeWindow when chat minimize button is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'chat-1', type: 'chat', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('minimize-chat-1'));
    expect(mockMinimizeWindow).toHaveBeenCalledWith('chat-1', {
      x: 0,
      y: 0,
      width: 700,
      height: 600
    });
  });

  it('renders all sixteen window types together', () => {
    mockWindows = [
      { id: 'notes-1', type: 'notes', zIndex: 100 },
      { id: 'console-1', type: 'console', zIndex: 101 },
      { id: 'settings-1', type: 'settings', zIndex: 102 },
      { id: 'email-1', type: 'email', zIndex: 103 },
      { id: 'files-1', type: 'files', zIndex: 104 },
      { id: 'documents-1', type: 'documents', zIndex: 105 },
      { id: 'tables-1', type: 'tables', zIndex: 106 },
      { id: 'videos-1', type: 'videos', zIndex: 107 },
      { id: 'photos-1', type: 'photos', zIndex: 108 },
      { id: 'keychain-1', type: 'keychain', zIndex: 109 },
      { id: 'contacts-1', type: 'contacts', zIndex: 110 },
      { id: 'sqlite-1', type: 'sqlite', zIndex: 111 },
      { id: 'chat-1', type: 'chat', zIndex: 112 },
      { id: 'analytics-1', type: 'analytics', zIndex: 113 },
      { id: 'audio-1', type: 'audio', zIndex: 114 },
      { id: 'admin-1', type: 'admin', zIndex: 115 }
    ];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('notes-window-notes-1')).toBeInTheDocument();
    expect(screen.getByTestId('console-window-console-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('settings-window-settings-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('email-window-email-1')).toBeInTheDocument();
    expect(screen.getByTestId('files-window-files-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('documents-window-documents-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('tables-window-tables-1')).toBeInTheDocument();
    expect(screen.getByTestId('video-window-videos-1')).toBeInTheDocument();
    expect(screen.getByTestId('photos-window-photos-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('keychain-window-keychain-1')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('contacts-window-contacts-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('sqlite-window-sqlite-1')).toBeInTheDocument();
    expect(screen.getByTestId('chat-window-chat-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('analytics-window-analytics-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('audio-window-audio-1')).toBeInTheDocument();
    expect(screen.getByTestId('admin-window-admin-1')).toBeInTheDocument();
  });
});
