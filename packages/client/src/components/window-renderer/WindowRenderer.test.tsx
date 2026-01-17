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
        onClick={() => onMinimize({ x: 0, y: 0, width: 800, height: 600 })}
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
        onClick={() => onMinimize({ x: 0, y: 0, width: 650, height: 500 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
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
      data-testid={`keychain-window-${id}`}
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

  it('renders backdrop when windows are open', () => {
    mockWindows = [{ id: 'test-1', type: 'notes', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('window-backdrop')).toBeInTheDocument();
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

  it('closes all windows when backdrop is clicked', async () => {
    const user = userEvent.setup();
    mockWindows = [
      { id: 'notes-1', type: 'notes', zIndex: 100 },
      { id: 'notes-2', type: 'notes', zIndex: 101 }
    ];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('window-backdrop'));
    expect(mockCloseWindow).toHaveBeenCalledWith('notes-1');
    expect(mockCloseWindow).toHaveBeenCalledWith('notes-2');
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
    // Should render backdrop but no window content
    expect(screen.getByTestId('window-backdrop')).toBeInTheDocument();
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

  it('renders all window types together', () => {
    mockWindows = [
      { id: 'notes-1', type: 'notes', zIndex: 100 },
      { id: 'console-1', type: 'console', zIndex: 101 },
      { id: 'settings-1', type: 'settings', zIndex: 102 },
      { id: 'email-1', type: 'email', zIndex: 103 },
      { id: 'photos-1', type: 'photos', zIndex: 104 }
    ];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('notes-window-notes-1')).toBeInTheDocument();
    expect(screen.getByTestId('console-window-console-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('settings-window-settings-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('email-window-email-1')).toBeInTheDocument();
    expect(screen.getByTestId('photos-window-photos-1')).toBeInTheDocument();
  });

  it('renders photos window for photos type', () => {
    mockWindows = [{ id: 'photos-1', type: 'photos', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('photos-window-photos-1')).toBeInTheDocument();
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

  it('renders contacts window for contacts type', () => {
    mockWindows = [{ id: 'contacts-1', type: 'contacts', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    expect(
      screen.getByTestId('contacts-window-contacts-1')
    ).toBeInTheDocument();
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

  it('renders keychain window for keychain type', () => {
    mockWindows = [{ id: 'keychain-1', type: 'keychain', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    expect(
      screen.getByTestId('keychain-window-keychain-1')
    ).toBeInTheDocument();
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
});
