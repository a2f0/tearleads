import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('@/lib/data-retrieval', () => ({
  retrieveFileData: vi.fn().mockResolvedValue(new ArrayBuffer(0))
}));

vi.mock('@/lib/file-utils', () => ({
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
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument();
    });
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

  it('shows context menu on right click', async () => {
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
      expect(screen.getByText('Get Info')).toBeInTheDocument();
      expect(screen.getByText('Download')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });

  it('deletes file via context menu', async () => {
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
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  it('preserves other files when one is deleted', async () => {
    mockDb.orderBy.mockResolvedValue(mockFiles);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
      expect(screen.getByText('image.jpg')).toBeInTheDocument();
    });

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

    // Verify other file (image.jpg) is still visible and unchanged
    expect(screen.getByText('image.jpg')).toBeInTheDocument();
  });

  it('handles delete error gracefully', async () => {
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
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    mockDb.set.mockReturnThis();
    mockDb.where.mockRejectedValueOnce(new Error('Delete failed'));

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument();
    });
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

  it('shows play option for video files in context menu', async () => {
    const videoFile = {
      ...mockFiles[0],
      mimeType: 'video/mp4',
      name: 'video.mp4'
    };
    mockDb.orderBy.mockResolvedValue([videoFile]);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('video.mp4')).toBeInTheDocument();
    });

    const fileRow = screen.getByText('video.mp4').closest('tr');
    if (fileRow) {
      await user.pointer({ keys: '[MouseRight]', target: fileRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
    });
  });

  it('shows get info for viewable files in context menu', async () => {
    mockDb.orderBy.mockResolvedValue([mockFiles[1]]);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('image.jpg')).toBeInTheDocument();
    });

    const fileRow = screen.getByText('image.jpg').closest('tr');
    if (fileRow) {
      await user.pointer({ keys: '[MouseRight]', target: fileRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Get Info')).toBeInTheDocument();
    });
  });

  it('handles download error gracefully', async () => {
    const { retrieveFileData } = await import('@/lib/data-retrieval');
    vi.mocked(retrieveFileData).mockRejectedValueOnce(
      new Error('Download failed')
    );
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

    await waitFor(() => {
      expect(screen.getByText('Download failed')).toBeInTheDocument();
    });
  });

  it('closes context menu when clicking outside', async () => {
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
  });

  it('displays unknown file type correctly', async () => {
    const unknownFile = {
      ...mockFiles[0],
      mimeType: 'application/octet-stream',
      name: 'unknown.bin'
    };
    mockDb.orderBy.mockResolvedValue([unknownFile]);
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('unknown.bin')).toBeInTheDocument();
    });
    expect(screen.getByText('OCTET-STREAM')).toBeInTheDocument();
  });

  it('displays file icon for non-image files without thumbnail', async () => {
    mockDb.orderBy.mockResolvedValue([mockFiles[0]]);
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });
  });

  it('displays music icon for audio files', async () => {
    const audioFile = {
      ...mockFiles[0],
      mimeType: 'audio/mpeg',
      name: 'song.mp3',
      thumbnailPath: null
    };
    mockDb.orderBy.mockResolvedValue([audioFile]);
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('song.mp3')).toBeInTheDocument();
    });
  });

  it('handles file types with only main type', async () => {
    const simpleTypeFile = {
      ...mockFiles[0],
      mimeType: 'text',
      name: 'file.txt'
    };
    mockDb.orderBy.mockResolvedValue([simpleTypeFile]);
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('file.txt')).toBeInTheDocument();
    });
    expect(screen.getByText('TEXT')).toBeInTheDocument();
  });

  it('handles click on non-viewable file gracefully', async () => {
    const nonViewableFile = {
      ...mockFiles[0],
      mimeType: 'application/zip',
      name: 'archive.zip'
    };
    mockDb.orderBy.mockResolvedValue([nonViewableFile]);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('archive.zip')).toBeInTheDocument();
    });

    const fileRow = screen.getByText('archive.zip').closest('tr');
    if (fileRow) {
      await user.click(fileRow);
    }
  });

  it('handles click on deleted file gracefully', async () => {
    const deletedFile = { ...mockFiles[0], deleted: true };
    mockDb.orderBy.mockResolvedValue([deletedFile]);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} showDeleted={true} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    const fileRow = screen.getByText('document.pdf').closest('tr');
    if (fileRow) {
      await user.click(fileRow);
    }
  });

  it('navigates to photo viewer when clicking image file', async () => {
    mockDb.orderBy.mockResolvedValue([mockFiles[1]]);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('image.jpg')).toBeInTheDocument();
    });

    const fileRow = screen.getByText('image.jpg').closest('tr');
    if (fileRow) {
      await user.click(fileRow);
    }
  });

  it('navigates to audio viewer when clicking audio file', async () => {
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
      await user.click(fileRow);
    }
  });

  it('navigates to video viewer when clicking video file', async () => {
    const videoFile = {
      ...mockFiles[0],
      mimeType: 'video/mp4',
      name: 'video.mp4'
    };
    mockDb.orderBy.mockResolvedValue([videoFile]);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('video.mp4')).toBeInTheDocument();
    });

    const fileRow = screen.getByText('video.mp4').closest('tr');
    if (fileRow) {
      await user.click(fileRow);
    }
  });

  it('navigates to document viewer when clicking PDF file', async () => {
    mockDb.orderBy.mockResolvedValue([mockFiles[0]]);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    const fileRow = screen.getByText('document.pdf').closest('tr');
    if (fileRow) {
      await user.click(fileRow);
    }
  });

  it('filters out deleted files when showDeleted is false', async () => {
    const filesWithDeleted = [
      { ...mockFiles[0], deleted: false },
      { ...mockFiles[1], deleted: true }
    ];
    mockDb.orderBy.mockResolvedValue(filesWithDeleted);
    render(<FilesWindowTableView {...defaultProps} showDeleted={false} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    expect(screen.queryByText('image.jpg')).not.toBeInTheDocument();
  });

  it('shows both deleted and non-deleted files when showDeleted is true', async () => {
    const filesWithDeleted = [
      { ...mockFiles[0], deleted: false },
      { ...mockFiles[1], deleted: true }
    ];
    mockDb.orderBy.mockResolvedValue(filesWithDeleted);
    render(<FilesWindowTableView {...defaultProps} showDeleted={true} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    expect(screen.getByText('image.jpg')).toBeInTheDocument();
  });

  it('plays audio file via context menu', async () => {
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

    await user.click(screen.getByText('Play'));
  });

  it('views image via context menu Get Info', async () => {
    mockDb.orderBy.mockResolvedValue([mockFiles[1]]);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('image.jpg')).toBeInTheDocument();
    });

    const fileRow = screen.getByText('image.jpg').closest('tr');
    if (fileRow) {
      await user.pointer({ keys: '[MouseRight]', target: fileRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Get Info')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Get Info'));
  });

  it('plays video via context menu', async () => {
    const videoFile = {
      ...mockFiles[0],
      mimeType: 'video/mp4',
      name: 'video.mp4'
    };
    mockDb.orderBy.mockResolvedValue([videoFile]);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('video.mp4')).toBeInTheDocument();
    });

    const fileRow = screen.getByText('video.mp4').closest('tr');
    if (fileRow) {
      await user.pointer({ keys: '[MouseRight]', target: fileRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Play'));
  });

  it('handles various file type displays', async () => {
    const variousFiles = [
      { ...mockFiles[0], mimeType: 'image/gif', name: 'anim.gif' },
      { ...mockFiles[0], mimeType: 'image/webp', name: 'image.webp' },
      { ...mockFiles[0], mimeType: 'image/svg+xml', name: 'icon.svg' },
      { ...mockFiles[0], mimeType: 'audio/wav', name: 'sound.wav' },
      { ...mockFiles[0], mimeType: 'audio/ogg', name: 'music.ogg' },
      { ...mockFiles[0], mimeType: 'audio/flac', name: 'lossless.flac' },
      { ...mockFiles[0], mimeType: 'video/webm', name: 'video.webm' },
      { ...mockFiles[0], mimeType: 'video/quicktime', name: 'movie.mov' },
      { ...mockFiles[0], mimeType: 'text/plain', name: 'readme.txt' },
      { ...mockFiles[0], mimeType: 'application/json', name: 'data.json' }
    ];
    mockDb.orderBy.mockResolvedValue(variousFiles);
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('anim.gif')).toBeInTheDocument();
    });

    expect(screen.getByText('GIF')).toBeInTheDocument();
    expect(screen.getByText('WebP')).toBeInTheDocument();
    expect(screen.getByText('SVG')).toBeInTheDocument();
    expect(screen.getByText('WAV')).toBeInTheDocument();
    expect(screen.getByText('OGG')).toBeInTheDocument();
    expect(screen.getByText('FLAC')).toBeInTheDocument();
    expect(screen.getByText('WebM')).toBeInTheDocument();
    expect(screen.getByText('MOV')).toBeInTheDocument();
    expect(screen.getByText('Text')).toBeInTheDocument();
    expect(screen.getByText('JSON')).toBeInTheDocument();
  });

  it('handles files with thumbnails', async () => {
    mockDb.orderBy.mockResolvedValue([mockFiles[1]]);
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('image.jpg')).toBeInTheDocument();
    });
  });

  it('refetches when sort changes', async () => {
    mockDb.orderBy.mockResolvedValue(mockFiles);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    const initialCallCount = mockDb.orderBy.mock.calls.length;

    await user.click(screen.getByText('Name'));

    await waitFor(() => {
      expect(mockDb.orderBy.mock.calls.length).toBeGreaterThan(
        initialCallCount
      );
    });
  });

  it('does not show context menu actions for deleted files except restore', async () => {
    const deletedFile = { ...mockFiles[0], deleted: true };
    mockDb.orderBy.mockResolvedValue([deletedFile]);
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

    expect(screen.queryByText('Download')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('pauses currently playing audio when clicking pause', async () => {
    const audioFile = {
      id: 'audio-1',
      name: 'song.mp3',
      size: 1024000,
      mimeType: 'audio/mpeg',
      uploadDate: new Date('2024-01-15'),
      storagePath: '/files/song.mp3',
      thumbnailPath: null,
      deleted: false
    };
    mockAudioState.currentTrack = { id: 'audio-1', name: 'song.mp3' };
    mockAudioState.isPlaying = true;
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
      expect(screen.getByText('Pause')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Pause'));

    expect(mockPause).toHaveBeenCalled();
  });

  it('resumes paused audio when clicking play', async () => {
    const audioFile = {
      id: 'audio-1',
      name: 'song.mp3',
      size: 1024000,
      mimeType: 'audio/mpeg',
      uploadDate: new Date('2024-01-15'),
      storagePath: '/files/song.mp3',
      thumbnailPath: null,
      deleted: false
    };
    mockAudioState.currentTrack = { id: 'audio-1', name: 'song.mp3' };
    mockAudioState.isPlaying = false;
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

    await user.click(screen.getByText('Play'));

    expect(mockResume).toHaveBeenCalled();
  });

  it('handles audio play error gracefully', async () => {
    const { retrieveFileData } = await import('@/lib/data-retrieval');
    vi.mocked(retrieveFileData).mockRejectedValueOnce(
      new Error('Audio load failed')
    );
    const audioFile = {
      id: 'audio-2',
      name: 'broken.mp3',
      size: 1024000,
      mimeType: 'audio/mpeg',
      uploadDate: new Date('2024-01-15'),
      storagePath: '/files/broken.mp3',
      thumbnailPath: null,
      deleted: false
    };
    mockDb.orderBy.mockResolvedValue([audioFile]);
    const user = userEvent.setup();
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('broken.mp3')).toBeInTheDocument();
    });

    const fileRow = screen.getByText('broken.mp3').closest('tr');
    if (fileRow) {
      await user.pointer({ keys: '[MouseRight]', target: fileRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Play'));

    await waitFor(() => {
      expect(screen.getByText('Audio load failed')).toBeInTheDocument();
    });
  });

  it('handles edge case with empty mimeType subtype', async () => {
    const noSubtypeFile = {
      id: 'file-edge',
      name: 'unknown',
      size: 1024,
      mimeType: 'application',
      uploadDate: new Date('2024-01-15'),
      storagePath: '/files/unknown',
      thumbnailPath: null,
      deleted: false
    };
    mockDb.orderBy.mockResolvedValue([noSubtypeFile]);
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('unknown')).toBeInTheDocument();
    });

    expect(screen.getByText('APPLICATION')).toBeInTheDocument();
  });

  it('renders files with various known MIME types correctly', async () => {
    const knownMimeFiles = [
      { ...mockFiles[0], mimeType: 'image/jpeg', name: 'photo.jpeg', id: 'f1' }
    ];
    mockDb.orderBy.mockResolvedValue(knownMimeFiles);
    render(<FilesWindowTableView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('photo.jpeg')).toBeInTheDocument();
    });
    expect(screen.getByText('JPEG')).toBeInTheDocument();
  });
});
