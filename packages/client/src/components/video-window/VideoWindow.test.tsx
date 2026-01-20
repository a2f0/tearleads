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
  const { useLocation } = await import('react-router-dom');
  return {
    VideoPage: ({
      onOpenVideo,
      hideBackLink,
      viewMode
    }: {
      onOpenVideo?: (
        videoId: string,
        options?: { autoPlay?: boolean | undefined }
      ) => void;
      hideBackLink?: boolean;
      viewMode?: 'list' | 'table';
    }) => {
      const location = useLocation();
      return (
        <>
          <div data-testid="video-location">{location.pathname}</div>
          <div data-testid="video-view-mode">{viewMode}</div>
          <button
            type="button"
            onClick={() => onOpenVideo?.('test-video')}
            data-testid="open-video"
          >
            Open Video
          </button>
          {hideBackLink && <div data-testid="back-link-hidden" />}
        </>
      );
    }
  };
});

vi.mock('@/pages/VideoDetail', () => ({
  VideoDetail: ({
    onBack,
    hideBackLink
  }: {
    onBack?: () => void;
    hideBackLink?: boolean;
  }) => (
    <div data-testid="video-detail">
      Video Detail
      {!hideBackLink && (
        <button type="button" onClick={onBack} data-testid="video-back">
          Back
        </button>
      )}
    </div>
  )
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
    expect(screen.getByTestId('video-location')).toHaveTextContent('/videos');
    expect(screen.getByTestId('video-view-mode')).toHaveTextContent('list');
    expect(screen.getByTestId('open-video')).toBeInTheDocument();
    expect(screen.getByTestId('back-link-hidden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
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
    expect(screen.getByTestId('video-back')).toBeInTheDocument();
  });

  it('returns to the list when back is clicked', async () => {
    const user = userEvent.setup();
    render(<VideoWindow {...defaultProps} />);

    await user.click(screen.getByTestId('open-video'));
    expect(screen.getByTestId('video-detail')).toBeInTheDocument();

    await user.click(screen.getByTestId('video-back'));
    expect(screen.getByTestId('open-video')).toBeInTheDocument();
  });

  it('switches to the table view from the menu', async () => {
    const user = userEvent.setup();
    render(<VideoWindow {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Table' }));

    expect(screen.getByTestId('video-view-mode')).toHaveTextContent('table');
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
