import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesList } from './FilesList';

// Mock dependencies
vi.mock('@/audio', () => ({
  useAudio: () => ({
    currentTrack: null,
    isPlaying: false,
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn()
  })
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: 'test-instance'
  })
}));

let mockFiles: Array<{
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
  thumbnailPath: string | null;
  deleted: boolean;
}> = [];

vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        orderBy: () => Promise.resolve(mockFiles)
      })
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve()
      })
    })
  })
}));

vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: () => new Uint8Array(32)
  })
}));

vi.mock('@/storage/opfs', () => ({
  initializeFileStorage: vi.fn(),
  getFileStorage: () => ({
    measureRetrieve: vi.fn()
  }),
  createRetrieveLogger: vi.fn()
}));

const mockUploadFile = vi.fn();
vi.mock('@/hooks/vfs', () => ({
  useFileUpload: () => ({
    uploadFile: mockUploadFile
  })
}));

vi.mock('@/lib/navigation', () => ({
  useNavigateWithFrom: () => vi.fn()
}));

vi.mock('@/i18n', () => ({
  useTypedTranslation: () => ({
    t: (key: string) => key
  })
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: () => <div data-testid="inline-unlock">Unlock</div>
}));

vi.mock('@/components/ui/dropzone', () => ({
  Dropzone: ({
    onFilesSelected,
    disabled
  }: {
    onFilesSelected: (files: File[]) => void;
    disabled: boolean;
  }) => (
    <button
      type="button"
      data-testid="dropzone"
      data-disabled={disabled}
      onClick={() => {
        const file = new File(['test'], 'test.txt', { type: 'text/plain' });
        onFilesSelected([file]);
      }}
    >
      Dropzone
    </button>
  )
}));

vi.mock('@/components/ui/RefreshButton', () => ({
  RefreshButton: ({
    onClick,
    loading
  }: {
    onClick: () => void;
    loading: boolean;
  }) => (
    <button
      type="button"
      data-testid="refresh-button"
      data-loading={loading}
      onClick={onClick}
    >
      Refresh
    </button>
  )
}));

vi.mock('@/components/ui/VirtualListStatus', () => ({
  getVirtualListStatusText: () => 'Status',
  VirtualListStatus: () => <div data-testid="virtual-list-status">Status</div>
}));

const mockVirtualItems: Array<{
  index: number;
  start: number;
  size: number;
  key: number;
}> = [];
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => mockVirtualItems,
    getTotalSize: () => mockVirtualItems.length * 56,
    measureElement: vi.fn()
  })
}));

vi.mock('@/hooks/device', () => ({
  useVirtualVisibleRange: () => ({
    firstVisible: 0,
    lastVisible: 0
  })
}));

describe('FilesList', () => {
  const renderWithRouter = (ui: ReactElement) =>
    render(<MemoryRouter>{ui}</MemoryRouter>);

  beforeEach(() => {
    vi.clearAllMocks();
    mockFiles = [];
    mockVirtualItems.length = 0;
  });

  it('renders header when showHeader is true', () => {
    renderWithRouter(<FilesList showDeleted={false} showHeader={true} />);
    expect(screen.getByText('Files')).toBeInTheDocument();
  });

  it('does not render header when showHeader is false', () => {
    renderWithRouter(<FilesList showDeleted={false} showHeader={false} />);
    expect(screen.queryByText('Files')).not.toBeInTheDocument();
  });

  it('renders dropzone when unlocked', () => {
    renderWithRouter(<FilesList showDeleted={false} />);
    expect(screen.getByTestId('dropzone')).toBeInTheDocument();
  });

  it('renders refresh button when unlocked', () => {
    renderWithRouter(<FilesList showDeleted={false} showHeader={true} />);
    expect(screen.getByTestId('refresh-button')).toBeInTheDocument();
  });

  it('renders show deleted toggle when onShowDeletedChange is provided', () => {
    const onShowDeletedChange = vi.fn();
    renderWithRouter(
      <FilesList
        showDeleted={false}
        showHeader={true}
        onShowDeletedChange={onShowDeletedChange}
      />
    );
    expect(screen.getByText('Show deleted')).toBeInTheDocument();
  });

  it('calls onShowDeletedChange when toggle is clicked', async () => {
    const user = userEvent.setup();
    const onShowDeletedChange = vi.fn();
    renderWithRouter(
      <FilesList
        showDeleted={false}
        showHeader={true}
        onShowDeletedChange={onShowDeletedChange}
      />
    );

    await user.click(screen.getByRole('switch'));
    expect(onShowDeletedChange).toHaveBeenCalledWith(true);
  });

  it('shows loading state initially', () => {
    renderWithRouter(<FilesList showDeleted={false} />);
    expect(screen.getByText('Loading files...')).toBeInTheDocument();
  });

  describe('upload success badge', () => {
    beforeEach(() => {
      const fileId = 'test-file-id';
      mockFiles = [
        {
          id: fileId,
          name: 'test.txt',
          size: 100,
          mimeType: 'text/plain',
          uploadDate: new Date(),
          storagePath: '/test/path',
          thumbnailPath: null,
          deleted: false
        }
      ];
      mockVirtualItems.push({
        index: 0,
        start: 0,
        size: 56,
        key: 0
      });
      mockUploadFile.mockResolvedValue({ id: fileId, isDuplicate: false });
    });

    it('dismisses upload badge on click', async () => {
      const user = userEvent.setup();
      renderWithRouter(<FilesList showDeleted={false} />);

      // Trigger upload to show the success badge
      await user.click(screen.getByTestId('dropzone'));

      // Wait for the badge to appear
      const badge = await screen.findByTestId('upload-success-badge');
      expect(badge).toBeInTheDocument();

      // Click the badge to dismiss
      await user.click(badge);
      expect(
        screen.queryByTestId('upload-success-badge')
      ).not.toBeInTheDocument();
    });

    it('dismisses upload badge on Enter key', async () => {
      const user = userEvent.setup();
      renderWithRouter(<FilesList showDeleted={false} />);

      // Trigger upload to show the success badge
      await user.click(screen.getByTestId('dropzone'));

      // Wait for the badge to appear
      const badge = await screen.findByTestId('upload-success-badge');
      expect(badge).toBeInTheDocument();

      // Focus the badge and press Enter
      badge.focus();
      await user.keyboard('{Enter}');
      expect(
        screen.queryByTestId('upload-success-badge')
      ).not.toBeInTheDocument();
    });

    it('dismisses upload badge on Space key', async () => {
      const user = userEvent.setup();
      renderWithRouter(<FilesList showDeleted={false} />);

      // Trigger upload to show the success badge
      await user.click(screen.getByTestId('dropzone'));

      // Wait for the badge to appear
      const badge = await screen.findByTestId('upload-success-badge');
      expect(badge).toBeInTheDocument();

      // Focus the badge and press Space
      badge.focus();
      await user.keyboard(' ');
      expect(
        screen.queryByTestId('upload-success-badge')
      ).not.toBeInTheDocument();
    });
  });

  it('shows restore in context menu for deleted files', async () => {
    const user = userEvent.setup();
    mockFiles = [
      {
        id: 'deleted-file',
        name: 'deleted.txt',
        size: 100,
        mimeType: 'text/plain',
        uploadDate: new Date(),
        storagePath: '/deleted/path',
        thumbnailPath: null,
        deleted: true
      }
    ];
    mockVirtualItems.push({
      index: 0,
      start: 0,
      size: 56,
      key: 0
    });

    renderWithRouter(<FilesList showDeleted={true} />);

    const deletedRow = await screen.findByText('deleted.txt');
    await user.pointer({ keys: '[MouseRight]', target: deletedRow });

    expect(screen.getByText('restore')).toBeInTheDocument();
  });
});
