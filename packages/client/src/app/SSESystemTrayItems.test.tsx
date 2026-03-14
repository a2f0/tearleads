import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MouseEventHandler } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SSESystemTrayItems } from './SSESystemTrayItems';

const mockUseSSEContext = vi.fn();
let mockIsAuthenticated = true;

vi.mock('@tearleads/ui', () => ({
  cn: (...classes: Array<string | undefined>) =>
    classes.filter((value): value is string => Boolean(value)).join(' ')
}));

vi.mock('@tearleads/window-manager', () => {
  return {
    WindowConnectionIndicator: ({
      state,
      onContextMenu
    }: {
      state: string;
      onContextMenu?: MouseEventHandler<HTMLButtonElement>;
    }) => (
      <button
        type="button"
        data-testid="connection-indicator"
        onContextMenu={onContextMenu}
      >
        {state}
      </button>
    )
  };
});

vi.mock('../components/SSEConnectionDialog', () => ({
  SSEConnectionDialog: ({
    isOpen,
    onClose
  }: {
    isOpen: boolean;
    onClose: () => void;
    connectionState: string;
  }) =>
    isOpen ? (
      <div data-testid="sse-connection-dialog">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    ) : null
}));

vi.mock('../contexts/AuthContext', () => ({
  useOptionalAuth: () => ({ isAuthenticated: mockIsAuthenticated })
}));

vi.mock('../sse', () => ({
  useSSEContext: () => mockUseSSEContext()
}));

describe('SSESystemTrayItems', () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
  });

  it('returns null when SSE context is unavailable', () => {
    mockUseSSEContext.mockReturnValue(null);

    const { container } = render(<SSESystemTrayItems />);

    expect(container.innerHTML).toBe('');
  });

  it('returns null when user is not authenticated', () => {
    mockIsAuthenticated = false;
    mockUseSSEContext.mockReturnValue({ connectionState: 'connected' });

    const { container } = render(<SSESystemTrayItems />);

    expect(container.innerHTML).toBe('');
  });

  it('shows the connection indicator when authenticated with SSE', () => {
    mockUseSSEContext.mockReturnValue({ connectionState: 'connected' });

    render(<SSESystemTrayItems />);

    expect(screen.getByTestId('connection-indicator')).toHaveTextContent(
      'connected'
    );
  });

  describe('context menu', () => {
    beforeEach(() => {
      mockUseSSEContext.mockReturnValue({ connectionState: 'connected' });
    });

    function openContextMenu() {
      fireEvent.contextMenu(screen.getByTestId('connection-indicator'));
    }

    it('shows context menu on right-click of connection indicator', () => {
      render(<SSESystemTrayItems />);
      openContextMenu();

      expect(screen.getByText('Connection Details')).toBeInTheDocument();
    });

    it('opens SSE connection dialog when clicking Connection Details', async () => {
      const user = userEvent.setup();
      render(<SSESystemTrayItems />);
      openContextMenu();

      await user.click(screen.getByText('Connection Details'));

      expect(screen.getByTestId('sse-connection-dialog')).toBeInTheDocument();
    });

    it('closes context menu when clicking Connection Details', async () => {
      const user = userEvent.setup();
      render(<SSESystemTrayItems />);
      openContextMenu();

      await user.click(screen.getByText('Connection Details'));

      expect(screen.queryByText('Connection Details')).not.toBeInTheDocument();
    });

    it('closes context menu when pressing Escape', () => {
      render(<SSESystemTrayItems />);
      openContextMenu();

      expect(screen.getByText('Connection Details')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.queryByText('Connection Details')).not.toBeInTheDocument();
    });

    it('closes SSE connection dialog when onClose is called', async () => {
      const user = userEvent.setup();
      render(<SSESystemTrayItems />);
      openContextMenu();

      await user.click(screen.getByText('Connection Details'));
      expect(screen.getByTestId('sse-connection-dialog')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /close/i }));
      expect(
        screen.queryByTestId('sse-connection-dialog')
      ).not.toBeInTheDocument();
    });
  });
});
