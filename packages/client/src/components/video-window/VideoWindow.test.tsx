import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoWindow } from './VideoWindow';

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManager: () => ({
    windowOpenRequests: {}
  })
}));

const mockUploadFile = vi.fn();

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

vi.mock('@/hooks/useFileUpload', () => ({
  useFileUpload: () => ({ uploadFile: mockUploadFile })
}));

vi.mock('@/pages/Video', () => ({
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
  }) => (
    <>
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
  )
}));

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

  beforeEach(() => {
    mockUploadFile.mockClear();
  });

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
    expect(screen.getByTestId('video-view-mode')).toHaveTextContent('list');
    expect(screen.getByTestId('open-video')).toBeInTheDocument();
    expect(screen.getByTestId('back-link-hidden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('wraps list content in a scrollable container', () => {
    render(<VideoWindow {...defaultProps} />);
    const container = screen.getByTestId('video-view-mode').parentElement;
    expect(container).toHaveClass('overflow-auto');
    expect(container).toHaveClass('h-full');
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

  it('uploads selected files from the file input', async () => {
    const user = userEvent.setup();
    render(<VideoWindow {...defaultProps} />);

    const fileInput = screen.getByTestId(
      'video-file-input'
    ) as HTMLInputElement;
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledWith(file);
    });
  });

  it('opens the file picker from the menu upload action', async () => {
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');

    render(<VideoWindow {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Upload' }));

    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockRestore();
  });

  it('renders without error when inside a router context (WindowRenderer is inside BrowserRouter)', () => {
    expect(() =>
      render(
        <MemoryRouter>
          <VideoWindow {...defaultProps} />
        </MemoryRouter>
      )
    ).not.toThrow();
    expect(screen.getByTestId('video-view-mode')).toBeInTheDocument();
  });
});
