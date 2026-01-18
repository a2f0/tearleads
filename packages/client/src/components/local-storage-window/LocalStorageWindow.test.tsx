import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalStorageWindow } from './LocalStorageWindow';

const localStorageRenderSpy = vi.fn();

vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({
    children,
    title,
    onClose
  }: {
    children: React.ReactNode;
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
}));

vi.mock('@/pages/local-storage', () => ({
  LocalStorage: () => {
    localStorageRenderSpy();
    return <div data-testid="local-storage">Local Storage</div>;
  }
}));

vi.mock('./LocalStorageWindowMenuBar', () => ({
  LocalStorageWindowMenuBar: ({
    onRefresh,
    onClose
  }: {
    onRefresh: () => void;
    onClose: () => void;
  }) => (
    <div>
      <button type="button" onClick={onRefresh} data-testid="refresh-button">
        Refresh
      </button>
      <button type="button" onClick={onClose} data-testid="close-button">
        Close
      </button>
    </div>
  )
}));

describe('LocalStorageWindow', () => {
  const defaultProps = {
    id: 'local-storage-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 120
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the floating window title and content', () => {
    render(<LocalStorageWindow {...defaultProps} />);

    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'Local Storage'
    );
    expect(screen.getByTestId('local-storage')).toBeInTheDocument();
  });

  it('triggers a refresh when the menu bar action is used', async () => {
    const user = userEvent.setup();
    render(<LocalStorageWindow {...defaultProps} />);

    const initialCalls = localStorageRenderSpy.mock.calls.length;
    await user.click(screen.getByTestId('refresh-button'));

    expect(localStorageRenderSpy.mock.calls.length).toBeGreaterThan(
      initialCalls
    );
  });

  it('forwards close actions to the parent handler', async () => {
    const user = userEvent.setup();
    render(<LocalStorageWindow {...defaultProps} />);

    await user.click(screen.getByTestId('close-button'));

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});
