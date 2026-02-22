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

  it('preserves other files when one is deleted', async () => {
    mockDb.orderBy.mockResolvedValue(mockFiles);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
      expect(screen.getByText('image.jpg')).toBeInTheDocument();
    });

    // Verify both files are shown before delete
    const imageRowBefore = screen.getByText('image.jpg').closest('tr');
    expect(imageRowBefore).toBeInTheDocument();

    const fileRow = screen.getByText('document.pdf').closest('tr');
    if (fileRow) {
      await user.pointer({ keys: '[MouseRight]', target: fileRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(mockDb.update).toHaveBeenCalled();
    });

    // Verify other file (image.jpg) is still visible, unchanged, and in the document
    const imageRowAfter = screen.getByText('image.jpg').closest('tr');
    expect(imageRowAfter).toBeInTheDocument();
    expect(screen.getByText('500 KB')).toBeInTheDocument(); // image.jpg size
  });

  it('handles delete error gracefully', async () => {
    mockDb.orderBy.mockResolvedValue(mockFiles);
    const consoleSpy = mockConsoleError();
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    const fileRow = screen.getByText('document.pdf').closest('tr');
    if (fileRow) {
      await user.pointer({ keys: '[MouseRight]', target: fileRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    mockDb.set.mockReturnThis();
    mockDb.where.mockRejectedValueOnce(new Error('Delete failed'));

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to delete file:',
      expect.any(Error)
    );
  });

  it('calls onUpload when header upload button is clicked', async () => {
    mockDb.orderBy.mockResolvedValue(mockFiles);
    const onUpload = vi.fn();
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} onUpload={onUpload} />);

    await waitFor(() => {
      expect(screen.getByTestId('table-upload-button')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('table-upload-button'));
    expect(onUpload).toHaveBeenCalled();
  });

  it('calls onUpload from blank-space context menu in table view', async () => {
    mockDb.orderBy.mockResolvedValue(mockFiles);
    const onUpload = vi.fn();
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} onUpload={onUpload} />);

    await waitFor(() => {
      expect(screen.getByTestId('files-table-container')).toBeInTheDocument();
    });

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByTestId('files-table-container')
    });

    await user.click(screen.getByRole('button', { name: 'Upload' }));
    expect(onUpload).toHaveBeenCalled();
  });

  it('displays different file type labels correctly', async () => {
    const filesWithVariousTypes = [
      { ...mockFiles[0], mimeType: 'image/png', name: 'image.png' },
      { ...mockFiles[1], mimeType: 'audio/mpeg', name: 'song.mp3' }
    ];
    mockDb.orderBy.mockResolvedValue(filesWithVariousTypes);
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('image.png')).toBeInTheDocument();
    });
    expect(screen.getByText('PNG')).toBeInTheDocument();
    expect(screen.getByText('MP3')).toBeInTheDocument();
  });

  it('shows deleted files with strikethrough when showDeleted is true', async () => {
    const filesWithDeleted = [{ ...mockFiles[0], deleted: true }];
    mockDb.orderBy.mockResolvedValue(filesWithDeleted);
    render(<FilesWindowTableView {...defaultProps} showDeleted={true} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    const nameSpan = screen.getByText('document.pdf');
    expect(nameSpan).toHaveClass('line-through');
  });

  it('shows restore option in context menu for deleted files', async () => {
    const filesWithDeleted = [{ ...mockFiles[0], deleted: true }];
    mockDb.orderBy.mockResolvedValue(filesWithDeleted);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} showDeleted={true} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    const fileRow = screen.getByText('document.pdf').closest('tr');
    if (fileRow) {
      await user.pointer({ keys: '[MouseRight]', target: fileRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Restore')).toBeInTheDocument();
    });
  });

  it('restores file via context menu', async () => {
    const filesWithDeleted = [{ ...mockFiles[0], deleted: true }];
    mockDb.orderBy.mockResolvedValue(filesWithDeleted);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} showDeleted={true} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    const fileRow = screen.getByText('document.pdf').closest('tr');
    if (fileRow) {
      await user.pointer({ keys: '[MouseRight]', target: fileRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Restore')).toBeInTheDocument();
    });

    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();

    await user.click(screen.getByText('Restore'));

    await waitFor(() => {
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  it('preserves other files when one is restored', async () => {
    const filesWithDeleted = [
      { ...mockFiles[0], deleted: true },
      { ...mockFiles[1], deleted: true }
    ];
    mockDb.orderBy.mockResolvedValue(filesWithDeleted);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} showDeleted={true} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
      expect(screen.getByText('image.jpg')).toBeInTheDocument();
    });

    const fileRow = screen.getByText('document.pdf').closest('tr');
    if (fileRow) {
      await user.pointer({ keys: '[MouseRight]', target: fileRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Restore')).toBeInTheDocument();
    });

    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();

    await user.click(screen.getByText('Restore'));

    await waitFor(() => {
      expect(mockDb.update).toHaveBeenCalled();
    });

    // Verify other file (image.jpg) is still visible
    expect(screen.getByText('image.jpg')).toBeInTheDocument();
  });

  it('handles restore error gracefully', async () => {
    const filesWithDeleted = [{ ...mockFiles[0], deleted: true }];
    mockDb.orderBy.mockResolvedValue(filesWithDeleted);
    const consoleSpy = mockConsoleError();
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} showDeleted={true} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    const fileRow = screen.getByText('document.pdf').closest('tr');
    if (fileRow) {
      await user.pointer({ keys: '[MouseRight]', target: fileRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Restore')).toBeInTheDocument();
    });

    mockDb.set.mockReturnThis();
    mockDb.where.mockRejectedValueOnce(new Error('Restore failed'));

    await user.click(screen.getByText('Restore'));

    await waitFor(() => {
      expect(screen.getByText('Restore failed')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to restore file:',
      expect.any(Error)
    );
  });

  it('downloads file via context menu', async () => {
    mockDb.orderBy.mockResolvedValue(mockFiles);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    const fileRow = screen.getByText('document.pdf').closest('tr');
    if (fileRow) {
      await user.pointer({ keys: '[MouseRight]', target: fileRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Download')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Download'));
  });

  it('shows play option for audio files in context menu', async () => {
    const audioFile = {
      ...mockFiles[0],
      mimeType: 'audio/mpeg',
      name: 'song.mp3'
    };
    mockDb.orderBy.mockResolvedValue([audioFile]);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('song.mp3')).toBeInTheDocument();
    });

    const fileRow = screen.getByText('song.mp3').closest('tr');
    if (fileRow) {
      await user.pointer({ keys: '[MouseRight]', target: fileRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
    });
  });
});
