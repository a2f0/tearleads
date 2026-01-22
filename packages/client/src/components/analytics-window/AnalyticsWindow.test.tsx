import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsWindow } from './AnalyticsWindow';

vi.mock('@/db', () => ({
  getDatabase: () => ({})
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: 'test-instance'
  })
}));

vi.mock('@/db/analytics', () => ({
  getEvents: vi.fn().mockResolvedValue([]),
  getEventStats: vi.fn().mockResolvedValue([]),
  getDistinctEventTypes: vi.fn().mockResolvedValue([]),
  getEventCount: vi.fn().mockResolvedValue(0),
  clearEvents: vi.fn().mockResolvedValue(undefined),
  getEventDisplayName: (name: string) => name
}));

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
    <div data-testid="floating-window" data-props={JSON.stringify(rest)}>
      <div data-testid="window-title">{title}</div>
      <button type="button" onClick={onClose} data-testid="close-window">
        Close
      </button>
      {children}
    </div>
  )
}));

vi.mock('@/pages/analytics', () => ({
  Analytics: ({
    showBackLink,
    onExportCsvChange
  }: {
    showBackLink?: boolean;
    onExportCsvChange?: (
      handler: (() => Promise<void>) | null,
      exporting: boolean
    ) => void;
  }) => {
    void onExportCsvChange;
    return (
      <div
        data-testid="analytics-content"
        data-show-back-link={showBackLink ? 'true' : 'false'}
      >
        Analytics Content
      </div>
    );
  }
}));

vi.mock('./AnalyticsWindowMenuBar', () => ({
  AnalyticsWindowMenuBar: ({
    onClose,
    onExportCsv
  }: {
    onClose: () => void;
    onExportCsv?: () => void;
    exportCsvDisabled?: boolean;
  }) => (
    <div data-testid="menu-bar">
      <button type="button" onClick={onClose} data-testid="menu-close-button">
        Close
      </button>
      <button
        type="button"
        onClick={onExportCsv}
        data-testid="menu-export-button"
      >
        Export
      </button>
    </div>
  )
}));

describe('AnalyticsWindow', () => {
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
    render(<AnalyticsWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('displays the correct title', () => {
    render(<AnalyticsWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Analytics');
  });

  it('renders Analytics content', () => {
    render(<AnalyticsWindow {...defaultProps} />);
    expect(screen.getByTestId('analytics-content')).toBeInTheDocument();
    expect(screen.getByTestId('analytics-content')).toHaveAttribute(
      'data-show-back-link',
      'false'
    );
  });

  it('renders menu bar', () => {
    render(<AnalyticsWindow {...defaultProps} />);
    expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AnalyticsWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when menu close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AnalyticsWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('menu-close-button'));
    expect(onClose).toHaveBeenCalled();
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = { x: 100, y: 200, width: 700, height: 550 };
    render(
      <AnalyticsWindow
        {...defaultProps}
        initialDimensions={initialDimensions}
      />
    );
    const window = screen.getByTestId('floating-window');
    const props = JSON.parse(window.dataset['props'] || '{}');
    expect(props.initialDimensions).toEqual(initialDimensions);
  });
});
