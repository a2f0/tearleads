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
    const { retrieveFileData } = await import('@/lib/dataRetrieval');
    vi.mocked(retrieveFileData).mockRejectedValueOnce(
      new Error('Download failed')
    );
    const consoleSpy = mockConsoleError();
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

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to download file:',
      expect.any(Error)
    );
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
});
