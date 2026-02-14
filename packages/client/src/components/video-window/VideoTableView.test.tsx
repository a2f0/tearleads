import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoWithThumbnail } from '@/pages/Video';
import { VideoTableView } from './VideoTableView';

vi.mock('@tanstack/react-table', () => ({
  useReactTable: () => ({
    getHeaderGroups: () => [
      {
        id: 'header-group-1',
        headers: [
          {
            id: 'name',
            isPlaceholder: false,
            column: { columnDef: { header: 'Name' } },
            getContext: () => ({})
          }
        ]
      }
    ],
    getRowModel: () => ({
      rows: [
        {
          id: 'row-1',
          original: {
            id: 'video-1',
            name: 'test-video.mp4',
            size: 1024000,
            mimeType: 'video/mp4',
            uploadDate: new Date('2024-01-15'),
            storagePath: '/videos/test-video.mp4',
            thumbnailPath: null,
            thumbnailUrl: null
          },
          getVisibleCells: () => [
            {
              id: 'cell-1',
              column: {
                id: 'name',
                columnDef: { cell: () => 'test-video.mp4' }
              },
              getContext: () => ({})
            }
          ]
        }
      ]
    })
  }),
  flexRender: (content: unknown) =>
    typeof content === 'function' ? content() : content,
  getCoreRowModel: () => vi.fn()
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [{ index: 0, start: 0, size: 44, key: 'video-1' }],
    getTotalSize: () => 44,
    measureElement: vi.fn()
  })
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

vi.mock('@/hooks/useVirtualVisibleRange', () => ({
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
});
