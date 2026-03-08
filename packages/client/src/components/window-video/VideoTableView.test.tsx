import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoWithThumbnail } from '@/pages/Video';
import { VideoTableView } from './VideoTableView';

vi.mock('@tanstack/react-table', () => ({
  useReactTable: vi.fn((config) => {
    const rows = config.data.map(
      (video: VideoWithThumbnail, index: number) => ({
        id: `row-${index}`,
        original: video,
        getVisibleCells: () =>
          config.columns.map(
            (col: { id: string; columnDef: { cell: unknown } }) => ({
              id: `cell-${col.id}`,
              column: {
                id: col.id,
                columnDef: col
              },
              getContext: () => ({
                row: { original: video }
              })
            })
          )
      })
    );
    return {
      getHeaderGroups: () => [
        {
          id: 'header-group-1',
          headers: config.columns.map(
            (col: { id: string; columnDef: { header: string } }) => ({
              id: col.id,
              isPlaceholder: false,
              column: { columnDef: col },
              getContext: () => ({})
            })
          )
        }
      ],
      getRowModel: () => ({ rows })
    };
  }),
  flexRender: (content: unknown, context: { row?: { original: unknown } }) => {
    if (typeof content === 'function') {
      return content(context);
    }
    return content;
  },
  getCoreRowModel: () => vi.fn()
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn((config) => ({
    getVirtualItems: () =>
      Array.from({ length: config.count }, (_, i) => ({
        index: i,
        start: i * 44,
        size: 44,
        key: `virtual-${i}`
      })),
    getTotalSize: () => config.count * 44,
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

describe('VideoTableView', () => {
  const mockOnNavigateToDetail = vi.fn();
  const mockOnPlay = vi.fn();
  const mockOnGetInfo = vi.fn();
  const mockOnDelete = vi.fn().mockResolvedValue(undefined);
  const mockOnUpload = vi.fn();

  const defaultProps = {
    videos: [mockVideo],
    tableParentRef: { current: document.createElement('div') },
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

  it('renders table with header', () => {
    render(<VideoTableView {...defaultProps} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
  });

  it('renders video list status', () => {
    render(<VideoTableView {...defaultProps} />);
    expect(screen.getByText(/1 of 1/)).toBeInTheDocument();
  });

  it('renders video with thumbnail image', () => {
    render(
      <VideoTableView {...defaultProps} videos={[mockVideoWithThumbnail]} />
    );
    expect(screen.getByText('video-with-thumb.mp4')).toBeInTheDocument();
  });

  it('renders video without thumbnail', () => {
    render(<VideoTableView {...defaultProps} />);
    expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
  });

  it('shows context menu on right click', () => {
    render(<VideoTableView {...defaultProps} />);
    const row = screen.getByText('test-video.mp4').closest('tr');
    expect(row).toBeInTheDocument();
    if (row) {
      fireEvent.contextMenu(row);
    }
    expect(screen.getByText('Play')).toBeInTheDocument();
    expect(screen.getByText('Get Info')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('navigates to detail on double click for desktop', () => {
    render(<VideoTableView {...defaultProps} />);
    const row = screen.getByText('test-video.mp4').closest('tr');
    if (row) {
      fireEvent.doubleClick(row);
    }
    expect(mockOnNavigateToDetail).toHaveBeenCalledWith('video-1');
  });

  it('navigates to detail on single click for mobile', () => {
    render(<VideoTableView {...defaultProps} isDesktopPlatform={false} />);
    const row = screen.getByText('test-video.mp4').closest('tr');
    if (row) {
      fireEvent.click(row);
    }
    expect(mockOnNavigateToDetail).toHaveBeenCalledWith('video-1');
  });

  it('calls onPlay when Play menu item is clicked', () => {
    render(<VideoTableView {...defaultProps} />);
    const row = screen.getByText('test-video.mp4').closest('tr');
    if (row) {
      fireEvent.contextMenu(row);
    }
    fireEvent.click(screen.getByText('Play'));
    expect(mockOnPlay).toHaveBeenCalledWith(mockVideo);
  });

  it('calls onGetInfo when Get Info menu item is clicked', () => {
    render(<VideoTableView {...defaultProps} />);
    const row = screen.getByText('test-video.mp4').closest('tr');
    if (row) {
      fireEvent.contextMenu(row);
    }
    fireEvent.click(screen.getByText('Get Info'));
    expect(mockOnGetInfo).toHaveBeenCalledWith(mockVideo);
  });

  it('calls onDelete when Delete menu item is clicked', async () => {
    render(<VideoTableView {...defaultProps} />);
    const row = screen.getByText('test-video.mp4').closest('tr');
    if (row) {
      fireEvent.contextMenu(row);
    }
    fireEvent.click(screen.getByText('Delete'));
    expect(mockOnDelete).toHaveBeenCalledWith(mockVideo);
  });

  it('shows upload context menu when right-clicking blank space', () => {
    const { container } = render(<VideoTableView {...defaultProps} />);
    const tableContainer = container.querySelector('.overflow-auto');
    if (tableContainer) {
      fireEvent.contextMenu(tableContainer, {
        target: tableContainer
      });
    }
    expect(
      screen.getByRole('button', {
        name: /upload/i
      })
    ).toBeInTheDocument();
  });

  it('does not show upload menu when onUpload is not provided', () => {
    const { container } = render(
      <VideoTableView {...defaultProps} onUpload={undefined} />
    );
    const tableContainer = container.querySelector('.overflow-auto');
    if (tableContainer) {
      fireEvent.contextMenu(tableContainer, { target: tableContainer });
    }
    expect(
      screen.queryByRole('button', {
        name: /upload/i
      })
    ).not.toBeInTheDocument();
  });

  it('calls onUpload when Upload menu item is clicked', () => {
    const { container } = render(<VideoTableView {...defaultProps} />);
    const tableContainer = container.querySelector('.overflow-auto');
    if (tableContainer) {
      fireEvent.contextMenu(tableContainer, { target: tableContainer });
    }
    fireEvent.click(
      screen.getByRole('button', {
        name: /upload/i
      })
    );
    expect(mockOnUpload).toHaveBeenCalled();
  });

  it('does not show upload menu when right-clicking on a row', () => {
    render(<VideoTableView {...defaultProps} />);
    const row = screen.getByText('test-video.mp4').closest('tr');
    if (row) {
      fireEvent.contextMenu(row);
    }
    expect(
      screen.queryByRole('button', {
        name: /upload/i
      })
    ).not.toBeInTheDocument();
    expect(screen.getByText('Play')).toBeInTheDocument();
  });

  it('renders multiple videos', () => {
    render(
      <VideoTableView
        {...defaultProps}
        videos={[mockVideo, mockVideoWithThumbnail]}
      />
    );
    expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
    expect(screen.getByText('video-with-thumb.mp4')).toBeInTheDocument();
  });

  it('renders empty table with no videos', () => {
    render(<VideoTableView {...defaultProps} videos={[]} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.queryByText('test-video.mp4')).not.toBeInTheDocument();
  });

  it('uses different class for name column cells', () => {
    render(<VideoTableView {...defaultProps} />);
    const cells = screen.getAllByRole('cell');
    expect(cells[0]).toHaveClass('px-3', 'py-2');
  });
});
