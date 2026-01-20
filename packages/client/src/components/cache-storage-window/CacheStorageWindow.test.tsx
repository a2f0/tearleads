import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheStorageWindow } from './CacheStorageWindow';

vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({
    children,
    title,
    onClose,
    ...rest
  }: {
    children: React.ReactNode;
    title: string;
    onClose: () => void;
    [key: string]: unknown;
  }) => (
    <div
      data-testid="floating-window"
      data-props={JSON.stringify(rest)}
      data-props-keys={JSON.stringify(Object.keys(rest))}
    >
      <div data-testid="window-title">{title}</div>
      <button type="button" onClick={onClose} data-testid="close-window">
        Close
      </button>
      {children}
    </div>
  )
}));

vi.mock('@/pages/cache-storage', async () => {
  const { useLocation } = await import('react-router-dom');
  return {
    CacheStorage: ({ showBackLink }: { showBackLink?: boolean }) => {
      const location = useLocation();
      return (
        <div data-testid="cache-storage-content">
          <span data-testid="cache-storage-location">{location.pathname}</span>
          <span data-testid="cache-storage-backlink">
            {showBackLink ? 'true' : 'false'}
          </span>
        </div>
      );
    }
  };
});

vi.mock('./CacheStorageWindowMenuBar', () => ({
  CacheStorageWindowMenuBar: ({
    onRefresh,
    onClose
  }: {
    onRefresh: () => void;
    onClose: () => void;
  }) => (
    <div data-testid="menu-bar">
      <button type="button" onClick={onRefresh} data-testid="refresh-button">
        Refresh
      </button>
      <button type="button" onClick={onClose} data-testid="menu-close-button">
        Close
      </button>
    </div>
  )
}));

describe('CacheStorageWindow', () => {
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
    render(<CacheStorageWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('displays the correct title', () => {
    render(<CacheStorageWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'Cache Storage'
    );
  });

  it('renders cache storage content', () => {
    render(<CacheStorageWindow {...defaultProps} />);
    expect(screen.getByTestId('cache-storage-location')).toHaveTextContent(
      '/cache-storage'
    );
    expect(screen.getByTestId('cache-storage-backlink')).toHaveTextContent(
      'false'
    );
  });

  it('renders menu bar', () => {
    render(<CacheStorageWindow {...defaultProps} />);
    expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CacheStorageWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('triggers refresh when refresh button is clicked', async () => {
    const user = userEvent.setup();
    render(<CacheStorageWindow {...defaultProps} />);

    await user.click(screen.getByTestId('refresh-button'));
    // The refresh changes the key on the container, re-rendering content
    expect(screen.getByTestId('cache-storage-content')).toBeInTheDocument();
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = { x: 100, y: 100, width: 650, height: 500 };
    render(
      <CacheStorageWindow
        {...defaultProps}
        initialDimensions={initialDimensions}
      />
    );
    const window = screen.getByTestId('floating-window');
    const props = JSON.parse(window.dataset['props'] || '{}');
    expect(props.initialDimensions).toEqual(initialDimensions);
  });

  it('passes onDimensionsChange to FloatingWindow when provided', () => {
    const onDimensionsChange = vi.fn();
    render(
      <CacheStorageWindow
        {...defaultProps}
        onDimensionsChange={onDimensionsChange}
      />
    );
    const window = screen.getByTestId('floating-window');
    const propKeys = JSON.parse(window.dataset['propsKeys'] || '[]');
    expect(propKeys).toContain('onDimensionsChange');
  });
});
