import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebugWindow } from './DebugWindow';

vi.mock('@tearleads/window-manager', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tearleads/window-manager')>();

  return {
    ...actual,
    DesktopFloatingWindow: ({
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
    ),
    WindowControlBar: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="window-control-bar">{children}</div>
    ),
    WindowControlButton: ({
      children,
      onClick,
      'data-testid': testId
    }: {
      children: React.ReactNode;
      onClick: () => void;
      'data-testid'?: string;
    }) => (
      <button type="button" onClick={onClick} data-testid={testId}>
        {children}
      </button>
    ),
    WindowControlGroup: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="window-control-group">{children}</div>
    )
  };
});

vi.mock('@tearleads/ui', () => ({
  cn: (...classes: Array<string | undefined>) =>
    classes.filter((value): value is string => Boolean(value)).join(' '),
  IconSquare: ({
    label,
    onClick,
    'data-testid': testId
  }: {
    label: string;
    onClick: () => void;
    'data-testid'?: string;
  }) => (
    <button type="button" onClick={onClick} data-testid={testId}>
      {label}
    </button>
  )
}));

vi.mock('@/pages/debug', () => ({
  Debug: ({ showTitle }: { showTitle?: boolean }) => (
    <div data-testid="debug-content" data-show-title={showTitle}>
      Debug Content
    </div>
  )
}));

vi.mock('@/pages/local-storage', () => ({
  LocalStorage: ({ showBackLink }: { showBackLink?: boolean }) => (
    <div data-testid="local-storage-content" data-show-back-link={showBackLink}>
      Local Storage Content
    </div>
  )
}));

vi.mock('@/pages/opfs', () => ({
  Opfs: ({ showBackLink }: { showBackLink?: boolean }) => (
    <div data-testid="opfs-content" data-show-back-link={showBackLink}>
      OPFS Content
    </div>
  )
}));

vi.mock('@/pages/cache-storage', () => ({
  CacheStorage: ({ showBackLink }: { showBackLink?: boolean }) => (
    <div data-testid="cache-storage-content" data-show-back-link={showBackLink}>
      Cache Storage Content
    </div>
  )
}));

describe('DebugWindow', () => {
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
    render(<DebugWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('displays the correct title for index view', () => {
    render(<DebugWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Debug');
  });

  it('renders options grid on index view', () => {
    render(<DebugWindow {...defaultProps} />);
    expect(screen.getByTestId('debug-option-system-info')).toBeInTheDocument();
    expect(screen.getByTestId('debug-option-browser')).toBeInTheDocument();
  });

  it('does not render back button on index view', () => {
    render(<DebugWindow {...defaultProps} />);
    expect(
      screen.queryByTestId('debug-window-control-back')
    ).not.toBeInTheDocument();
  });

  it('navigates to system-info view when System Info is clicked', async () => {
    const user = userEvent.setup();
    render(<DebugWindow {...defaultProps} />);

    await user.click(screen.getByTestId('debug-option-system-info'));

    expect(screen.getByTestId('window-title')).toHaveTextContent('System Info');
    expect(screen.getByTestId('debug-content')).toBeInTheDocument();
    expect(screen.getByTestId('debug-window-control-back')).toBeInTheDocument();
  });

  it('navigates to browser view when Browser is clicked', async () => {
    const user = userEvent.setup();
    render(<DebugWindow {...defaultProps} />);

    await user.click(screen.getByTestId('debug-option-browser'));

    expect(screen.getByTestId('window-title')).toHaveTextContent('Browser');
    expect(screen.getByTestId('debug-window-control-back')).toBeInTheDocument();
    expect(
      screen.getByTestId('debug-browser-local-storage')
    ).toBeInTheDocument();
    expect(screen.getByTestId('debug-browser-opfs')).toBeInTheDocument();
    expect(
      screen.getByTestId('debug-browser-cache-storage')
    ).toBeInTheDocument();
  });

  it('navigates back to index from system-info view using control bar', async () => {
    const user = userEvent.setup();
    render(<DebugWindow {...defaultProps} />);

    await user.click(screen.getByTestId('debug-option-system-info'));
    await user.click(screen.getByTestId('debug-window-control-back'));

    expect(screen.getByTestId('window-title')).toHaveTextContent('Debug');
    expect(screen.getByTestId('debug-option-system-info')).toBeInTheDocument();
  });

  it('navigates back to index from browser view using control bar', async () => {
    const user = userEvent.setup();
    render(<DebugWindow {...defaultProps} />);

    await user.click(screen.getByTestId('debug-option-browser'));
    await user.click(screen.getByTestId('debug-window-control-back'));

    expect(screen.getByTestId('window-title')).toHaveTextContent('Debug');
    expect(screen.getByTestId('debug-option-system-info')).toBeInTheDocument();
  });

  it('navigates to local-storage from browser view', async () => {
    const user = userEvent.setup();
    render(<DebugWindow {...defaultProps} />);

    await user.click(screen.getByTestId('debug-option-browser'));
    await user.click(screen.getByTestId('debug-browser-local-storage'));

    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'Local Storage'
    );
    expect(screen.getByTestId('local-storage-content')).toBeInTheDocument();
    expect(screen.getByTestId('debug-window-control-back')).toBeInTheDocument();
  });

  it('navigates back to browser from local-storage view using control bar', async () => {
    const user = userEvent.setup();
    render(<DebugWindow {...defaultProps} />);

    await user.click(screen.getByTestId('debug-option-browser'));
    await user.click(screen.getByTestId('debug-browser-local-storage'));
    await user.click(screen.getByTestId('debug-window-control-back'));

    expect(screen.getByTestId('window-title')).toHaveTextContent('Browser');
    expect(
      screen.getByTestId('debug-browser-local-storage')
    ).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DebugWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = { x: 120, y: 140, width: 520, height: 560 };
    render(
      <DebugWindow {...defaultProps} initialDimensions={initialDimensions} />
    );
    const window = screen.getByTestId('floating-window');
    const props = JSON.parse(window.dataset['props'] || '{}');
    expect(props.initialDimensions).toEqual(initialDimensions);
  });

  it('passes onDimensionsChange to FloatingWindow when provided', () => {
    const onDimensionsChange = vi.fn();
    render(
      <DebugWindow {...defaultProps} onDimensionsChange={onDimensionsChange} />
    );
    const window = screen.getByTestId('floating-window');
    const propKeys = JSON.parse(window.dataset['propsKeys'] || '[]');
    expect(propKeys).toContain('onDimensionsChange');
  });
});
