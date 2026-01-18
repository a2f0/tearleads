import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { VideoWindow } from './VideoWindow';

vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({
    children,
    title,
    onClose,
    initialDimensions
  }: {
    children: React.ReactNode;
    title: string;
    onClose: () => void;
    initialDimensions?: { width: number; height: number; x: number; y: number };
  }) => (
    <div
      data-testid="floating-window"
      data-initial-dimensions={
        initialDimensions ? JSON.stringify(initialDimensions) : undefined
      }
    >
      <div data-testid="window-title">{title}</div>
      <button type="button" onClick={onClose} data-testid="close-window">
        Close
      </button>
      {children}
    </div>
  )
}));

vi.mock('@/pages/Video', async () => {
  const { useNavigate } = await import('react-router-dom');
  return {
    VideoPage: () => {
      const navigate = useNavigate();
      return (
        <button
          type="button"
          onClick={() => navigate('/videos/test-video')}
          data-testid="open-video"
        >
          Open Video
        </button>
      );
    }
  };
});

vi.mock('@/pages/VideoDetail', () => ({
  VideoDetail: () => <div data-testid="video-detail">Video Detail</div>
}));

describe('VideoWindow', () => {
  const defaultProps = {
    id: 'video-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  it('renders in FloatingWindow', () => {
    render(<VideoWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows Videos as title', () => {
    render(<VideoWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Videos');
  });

  it('renders the VideoPage content', () => {
    render(<VideoWindow {...defaultProps} />);
    expect(screen.getByTestId('open-video')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<VideoWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders video detail when navigating to a video', async () => {
    const user = userEvent.setup();
    render(<VideoWindow {...defaultProps} />);

    await user.click(screen.getByTestId('open-video'));
    expect(screen.getByTestId('video-detail')).toBeInTheDocument();
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = {
      width: 640,
      height: 480,
      x: 120,
      y: 80
    };
    render(
      <VideoWindow {...defaultProps} initialDimensions={initialDimensions} />
    );
    const floatingWindow = screen.getByTestId('floating-window');
    expect(floatingWindow).toHaveAttribute(
      'data-initial-dimensions',
      JSON.stringify(initialDimensions)
    );
  });
});
