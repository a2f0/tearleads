import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowManagerProvider } from '@/contexts/WindowManagerContext';
import { WindowRenderer } from './WindowRenderer';

vi.mock('@/components/notes-window', () => ({
  NotesWindow: ({
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
      data-testid={`notes-window-${id}`}
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

vi.mock('@/components/console-window', () => ({
  ConsoleWindow: ({
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
      data-testid={`console-window-${id}`}
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

vi.mock('@/contexts/WindowManagerContext', async () => {
  const actual = await vi.importActual('@/contexts/WindowManagerContext');
  return {
    ...actual,
    useWindowManager: () => ({
      windows: mockWindows,
      openWindow: mockOpenWindow,
      closeWindow: mockCloseWindow,
      focusWindow: mockFocusWindow,
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
});
