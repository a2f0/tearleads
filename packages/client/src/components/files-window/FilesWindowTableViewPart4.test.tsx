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
      { mimeType: 'image/gif', name: 'anim.gif' },
      { mimeType: 'image/webp', name: 'image.webp' },
      { mimeType: 'image/svg+xml', name: 'icon.svg' },
      { mimeType: 'audio/wav', name: 'sound.wav' },
      { mimeType: 'audio/ogg', name: 'music.ogg' },
      { mimeType: 'audio/flac', name: 'lossless.flac' },
      { mimeType: 'video/webm', name: 'video.webm' },
      { mimeType: 'video/quicktime', name: 'movie.mov' },
      { mimeType: 'text/plain', name: 'readme.txt' },
      { mimeType: 'application/json', name: 'data.json' }
    ].map((entry, index) => ({
      ...mockFiles[0],
      ...entry,
      id: `file-${index + 1}`
    }));
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
    const { retrieveFileData } = await import('@/lib/dataRetrieval');
    vi.mocked(retrieveFileData).mockRejectedValueOnce(
      new Error('Audio load failed')
    );
    const consoleSpy = mockConsoleError();
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

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to load audio:',
      expect.any(Error)
    );
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
});
