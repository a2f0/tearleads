import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchWindow } from './SearchWindow';

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

vi.mock('./SearchWindowMenuBar', () => ({
  SearchWindowMenuBar: ({
    onClose,
    onViewModeChange
  }: {
    onClose: () => void;
    onViewModeChange: (mode: 'list' | 'table') => void;
  }) => (
    <div data-testid="menu-bar">
      <button type="button" onClick={onClose} data-testid="menu-close-button">
        Close
      </button>
      <button
        type="button"
        onClick={() => onViewModeChange('table')}
        data-testid="menu-table-button"
      >
        Table
      </button>
    </div>
  )
}));

vi.mock('./SearchWindowContent', () => ({
  SearchWindowContent: () => (
    <div data-testid="search-content">Search Content</div>
  )
}));

describe('SearchWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders in FloatingWindow', () => {
    render(<SearchWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('displays correct title', () => {
    render(<SearchWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Search');
  });

  it('renders menu bar', () => {
    render(<SearchWindow {...defaultProps} />);
    expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
  });

  it('renders search content', () => {
    render(<SearchWindow {...defaultProps} />);
    expect(screen.getByTestId('search-content')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SearchWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when menu close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SearchWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('menu-close-button'));
    expect(onClose).toHaveBeenCalled();
  });
});
