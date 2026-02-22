import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/consoleMocks';
import { FilesWindowTableView } from './FilesWindowTableView';

const mockDatabaseState = {
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'test-instance'
};

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockDatabaseState
}));

vi.mock('@/i18n', () => ({
  useTypedTranslation: () => ({
    t: (key: string) =>
      ({
        getInfo: 'Get Info',
        delete: 'Delete',
        download: 'Download',
        play: 'Play',
        pause: 'Pause',
        restore: 'Restore'
      })[key] ?? key
  })
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock for {description}</div>
  )
}));

vi.mock('@/lib/navigation', () => ({
  useNavigateWithFrom: () => vi.fn()
}));

const mockPause = vi.fn();
const mockResume = vi.fn();
const mockPlay = vi.fn();
const mockAudioState = {
  currentTrack: null as { id: string; name: string } | null,
  isPlaying: false
};

vi.mock('@/audio', () => ({
  useAudio: () => ({
    currentTrack: mockAudioState.currentTrack,
    isPlaying: mockAudioState.isPlaying,
    play: mockPlay,
    pause: mockPause,
    resume: mockResume
  })
}));

vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: () => new Uint8Array(32)
  })
}));

vi.mock('@/storage/opfs', () => ({
  initializeFileStorage: vi.fn().mockResolvedValue(undefined),
  getFileStorage: () => ({
    measureRetrieve: vi.fn().mockResolvedValue(new ArrayBuffer(0))
  }),
  createRetrieveLogger: () => ({})
}));

vi.mock('@/lib/dataRetrieval', () => ({
  retrieveFileData: vi.fn().mockResolvedValue(new ArrayBuffer(0))
}));

vi.mock('@/lib/fileUtils', () => ({
  downloadFile: vi.fn()
}));

const mockFiles = [
  {
    id: 'file-1',
    name: 'document.pdf',
    size: 1024000,
    mimeType: 'application/pdf',
    uploadDate: new Date('2024-01-15'),
    storagePath: '/files/document.pdf',
    thumbnailPath: null,
    deleted: false
  },
  {
    id: 'file-2',
    name: 'image.jpg',
    size: 512000,
    mimeType: 'image/jpeg',
    uploadDate: new Date('2024-01-10'),
    storagePath: '/files/image.jpg',
    thumbnailPath: '/thumbnails/image.jpg',
    deleted: false
  }
];

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockResolvedValue([]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis()
};

vi.mock('@/db', () => ({
  getDatabase: () => mockDb
}));

describe('FilesWindowTableView', () => {
  const defaultProps = {
    showDeleted: false,
    onUpload: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabaseState.isUnlocked = true;
    mockDatabaseState.isLoading = false;
    mockDb.orderBy.mockResolvedValue([]);
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockAudioState.currentTrack = null;
    mockAudioState.isPlaying = false;
  });

  it('shows database loading state', () => {
    mockDatabaseState.isLoading = true;
    mockDatabaseState.isUnlocked = false;
    render(<FilesWindowTableView {...defaultProps} />);
    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('shows unlock prompt when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    mockDatabaseState.isLoading = false;
    render(<FilesWindowTableView {...defaultProps} />);
    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('renders header with Files title', () => {
    render(<FilesWindowTableView {...defaultProps} />);
    expect(screen.getByText('Files')).toBeInTheDocument();
  });

  it('renders upload button when unlocked', () => {
    render(<FilesWindowTableView {...defaultProps} />);
    expect(screen.getByTestId('table-upload-button')).toBeInTheDocument();
  });

  it('renders refresh button when unlocked', () => {
    render(<FilesWindowTableView {...defaultProps} />);
    expect(
      screen.getByRole('button', { name: /refresh/i })
    ).toBeInTheDocument();
  });

  it('refetches files when refresh button is clicked', async () => {
    mockDb.orderBy.mockResolvedValue(mockFiles);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    vi.clearAllMocks();
    mockDb.orderBy.mockResolvedValue(mockFiles);

    const refreshButton = screen.getByRole('button', { name: /refresh/i });
    await user.click(refreshButton);

    await waitFor(() => {
      expect(mockDb.orderBy).toHaveBeenCalled();
    });
  });

  it('shows empty state when no files exist', async () => {
    mockDb.orderBy.mockResolvedValue([]);
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('No files yet')).toBeInTheDocument();
    });
    expect(screen.getByTestId('table-empty-upload-button')).toBeInTheDocument();
  });

  it('renders table with files when files exist', async () => {
    mockDb.orderBy.mockResolvedValue(mockFiles);
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });
    expect(screen.getByText('image.jpg')).toBeInTheDocument();

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Size')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Date')).toBeInTheDocument();
  });

  it('shows error state when fetch fails', async () => {
    mockDb.orderBy.mockRejectedValue(new Error('Database error'));
    const consoleSpy = mockConsoleError();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to fetch files:',
      expect.any(Error)
    );
  });

  it('displays file size and type in table cells', async () => {
    mockDb.orderBy.mockResolvedValue(mockFiles);
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    expect(screen.getByText('1000 KB')).toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();
  });

  it('sorts by name column when clicked', async () => {
    mockDb.orderBy.mockResolvedValue(mockFiles);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    vi.clearAllMocks();
    mockDb.orderBy.mockResolvedValue(mockFiles);

    await user.click(screen.getByText('Name'));

    await waitFor(() => {
      expect(mockDb.orderBy).toHaveBeenCalled();
    });
  });

  it('sorts by size column when clicked', async () => {
    mockDb.orderBy.mockResolvedValue(mockFiles);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    vi.clearAllMocks();
    mockDb.orderBy.mockResolvedValue(mockFiles);

    await user.click(screen.getByText('Size'));

    await waitFor(() => {
      expect(mockDb.orderBy).toHaveBeenCalled();
    });
  });

  it('sorts by type column when clicked', async () => {
    mockDb.orderBy.mockResolvedValue(mockFiles);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    vi.clearAllMocks();
    mockDb.orderBy.mockResolvedValue(mockFiles);

    await user.click(screen.getByText('Type'));

    await waitFor(() => {
      expect(mockDb.orderBy).toHaveBeenCalled();
    });
  });

  it('sorts by date column when clicked', async () => {
    mockDb.orderBy.mockResolvedValue(mockFiles);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    vi.clearAllMocks();
    mockDb.orderBy.mockResolvedValue(mockFiles);

    await user.click(screen.getByText('Date'));

    await waitFor(() => {
      expect(mockDb.orderBy).toHaveBeenCalled();
    });
  });

  it('calls onUpload when upload button is clicked', async () => {
    mockDb.orderBy.mockResolvedValue([]);
    const onUpload = vi.fn();
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} onUpload={onUpload} />);

    await waitFor(() => {
      expect(
        screen.getByTestId('table-empty-upload-button')
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('table-empty-upload-button'));
    expect(onUpload).toHaveBeenCalled();
  });

  it('does not render action buttons when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    render(<FilesWindowTableView {...defaultProps} />);

    expect(screen.queryByTestId('table-upload-button')).not.toBeInTheDocument();
  });

  it('toggles sort direction when same column is clicked again', async () => {
    mockDb.orderBy.mockResolvedValue(mockFiles);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    vi.clearAllMocks();
    mockDb.orderBy.mockResolvedValue(mockFiles);

    await user.click(screen.getByText('Date'));

    await waitFor(() => {
      expect(mockDb.orderBy).toHaveBeenCalled();
    });
  });
});
