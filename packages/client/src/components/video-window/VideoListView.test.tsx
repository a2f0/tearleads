import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoWithThumbnail } from '@/pages/Video';
import { VideoListView } from './VideoListView';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn((config) => ({
    getVirtualItems: () =>
      Array.from({ length: config.count }, (_, i) => ({
        index: i,
        start: i * 56,
        size: 56,
        key: `video-${i}`
      })),
    getTotalSize: () => config.count * 56,
    measureElement: vi.fn()
  }))
}));

vi.mock('@/i18n', () => ({
  useTypedTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        play: 'Play',
        getInfo: 'Get Info',
        delete: 'Delete'
      };
      return translations[key] ?? key;
    }
  })
}));

vi.mock('@/hooks/device', () => ({
  useVirtualVisibleRange: () => ({ firstVisible: 0, lastVisible: 0 })
}));

vi.mock('@/lib/mediaDragData', () => ({
  setMediaDragData: vi.fn()
}));

const mockVideo: VideoWithThumbnail = {
  id: 'video-1',
  name: 'test-video.mp4',
  size: 1024000,
  mimeType: 'video/mp4',
  uploadDate: new Date('2024-01-15'),
  storagePath: '/videos/test-video.mp4',
  thumbnailPath: null,
  thumbnailUrl: null
};

const mockVideoWithThumbnail: VideoWithThumbnail = {
  id: 'video-2',
  name: 'video-with-thumb.mp4',
  size: 2048000,
  mimeType: 'video/webm',
  uploadDate: new Date('2024-01-16'),
  storagePath: '/videos/video-with-thumb.mp4',
  thumbnailPath: '/thumbnails/thumb.jpg',
  thumbnailUrl: 'blob:http://localhost/thumb123'
};

describe('VideoListView', () => {
  const mockOnNavigateToDetail = vi.fn();
  const mockOnPlay = vi.fn();
  const mockOnGetInfo = vi.fn();
  const mockOnDelete = vi.fn().mockResolvedValue(undefined);
  const mockOnUpload = vi.fn();

  const defaultProps = {
    videos: [mockVideo],
    parentRef: { current: document.createElement('div') },
    isDesktopPlatform: true,
    onNavigateToDetail: mockOnNavigateToDetail,
    onPlay: mockOnPlay,
    onGetInfo: mockOnGetInfo,
    onDelete: mockOnDelete,
    onUpload: mockOnUpload
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders video list items', () => {
    render(<VideoListView {...defaultProps} />);
    expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
  });

  it('renders video with thumbnail', () => {
    render(
      <VideoListView {...defaultProps} videos={[mockVideoWithThumbnail]} />
    );
    expect(screen.getByText('video-with-thumb.mp4')).toBeInTheDocument();
  });

  it('renders video without thumbnail', () => {
    render(<VideoListView {...defaultProps} />);
    expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
  });

  it('shows context menu on right click', () => {
    render(<VideoListView {...defaultProps} />);
    const videoItem = screen.getByTestId('video-item-video-1');
    fireEvent.contextMenu(videoItem);
    expect(screen.getByText('Play')).toBeInTheDocument();
    expect(screen.getByText('Get Info')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('navigates to detail on double click for desktop', () => {
    render(<VideoListView {...defaultProps} />);
    const videoButton = screen.getByTestId('video-open-video-1');
    fireEvent.doubleClick(videoButton);
    expect(mockOnNavigateToDetail).toHaveBeenCalledWith('video-1');
  });

  it('navigates to detail on single click for mobile', () => {
    render(<VideoListView {...defaultProps} isDesktopPlatform={false} />);
    const videoButton = screen.getByTestId('video-open-video-1');
    fireEvent.click(videoButton);
    expect(mockOnNavigateToDetail).toHaveBeenCalledWith('video-1');
  });

  it('navigates to detail via chevron button', () => {
    render(<VideoListView {...defaultProps} />);
    const chevronButton = screen.getByRole('button', { name: 'View details' });
    fireEvent.click(chevronButton);
    expect(mockOnNavigateToDetail).toHaveBeenCalledWith('video-1');
  });

  it('calls onPlay when Play menu item is clicked', () => {
    render(<VideoListView {...defaultProps} />);
    const videoItem = screen.getByTestId('video-item-video-1');
    fireEvent.contextMenu(videoItem);
    fireEvent.click(screen.getByText('Play'));
    expect(mockOnPlay).toHaveBeenCalledWith(mockVideo);
  });

  it('calls onGetInfo when Get Info menu item is clicked', () => {
    render(<VideoListView {...defaultProps} />);
    const videoItem = screen.getByTestId('video-item-video-1');
    fireEvent.contextMenu(videoItem);
    fireEvent.click(screen.getByText('Get Info'));
    expect(mockOnGetInfo).toHaveBeenCalledWith(mockVideo);
  });

  it('calls onDelete when Delete menu item is clicked', async () => {
    render(<VideoListView {...defaultProps} />);
    const videoItem = screen.getByTestId('video-item-video-1');
    fireEvent.contextMenu(videoItem);
    fireEvent.click(screen.getByText('Delete'));
    expect(mockOnDelete).toHaveBeenCalledWith(mockVideo);
  });

  it('shows upload context menu when right-clicking blank space', () => {
    const { container } = render(<VideoListView {...defaultProps} />);
    const listContainer = container.querySelector('.overflow-auto');
    if (listContainer) {
      fireEvent.contextMenu(listContainer, { target: listContainer });
    }
    expect(screen.getByText('Upload')).toBeInTheDocument();
  });

  it('does not show upload menu when onUpload is not provided', () => {
    const { container } = render(
      <VideoListView {...defaultProps} onUpload={undefined} />
    );
    const listContainer = container.querySelector('.overflow-auto');
    if (listContainer) {
      fireEvent.contextMenu(listContainer, { target: listContainer });
    }
    expect(screen.queryByText('Upload')).not.toBeInTheDocument();
  });

  it('calls onUpload when Upload menu item is clicked', () => {
    const { container } = render(<VideoListView {...defaultProps} />);
    const listContainer = container.querySelector('.overflow-auto');
    if (listContainer) {
      fireEvent.contextMenu(listContainer, { target: listContainer });
    }
    fireEvent.click(screen.getByText('Upload'));
    expect(mockOnUpload).toHaveBeenCalled();
  });

  it('does not show upload menu when right-clicking on a video item', () => {
    render(<VideoListView {...defaultProps} />);
    const videoItem = screen.getByTestId('video-item-video-1');
    fireEvent.contextMenu(videoItem);
    expect(screen.queryByText('Upload')).not.toBeInTheDocument();
    expect(screen.getByText('Play')).toBeInTheDocument();
  });

  it('renders multiple videos', () => {
    render(
      <VideoListView
        {...defaultProps}
        videos={[mockVideo, mockVideoWithThumbnail]}
      />
    );
    expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
    expect(screen.getByText('video-with-thumb.mp4')).toBeInTheDocument();
  });

  it('renders empty list with no videos', () => {
    render(<VideoListView {...defaultProps} videos={[]} />);
    expect(screen.queryByText('test-video.mp4')).not.toBeInTheDocument();
  });
});
