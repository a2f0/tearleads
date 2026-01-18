import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoWindow } from './VideoWindow';

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

vi.mock('@/pages/Video', () => ({
  VideoPage: () => <div data-testid="video-content">Video Content</div>
}));

describe('VideoWindow', () => {
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
    render(<VideoWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('displays the correct title', () => {
    render(<VideoWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Videos');
  });

  it('renders video content', () => {
    render(<VideoWindow {...defaultProps} />);
    expect(screen.getByTestId('video-content')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<VideoWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = { x: 120, y: 140, width: 700, height: 550 };
    render(
      <VideoWindow {...defaultProps} initialDimensions={initialDimensions} />
    );
    const window = screen.getByTestId('floating-window');
    const props = JSON.parse(window.dataset['props'] || '{}');
    expect(props.initialDimensions).toEqual(initialDimensions);
  });

  it('passes onDimensionsChange to FloatingWindow when provided', () => {
    const onDimensionsChange = vi.fn();
    render(
      <VideoWindow {...defaultProps} onDimensionsChange={onDimensionsChange} />
    );
    const window = screen.getByTestId('floating-window');
    const propKeys = JSON.parse(window.dataset['propsKeys'] || '[]');
    expect(propKeys).toContain('onDimensionsChange');
  });
});
