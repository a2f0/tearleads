import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/console-mocks';
import { FilesWindowDetail } from './FilesWindowDetail';

const mockDatabaseState = {
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'test-instance'
};

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockDatabaseState
}));

const mockImageFile = {
  id: 'file-1',
  name: 'test-image.jpg',
  size: 1024,
  mimeType: 'image/jpeg',
  uploadDate: new Date('2024-01-01'),
  storagePath: '/files/file-1.jpg'
};

const mockAudioFile = {
  id: 'file-2',
  name: 'test-audio.mp3',
  size: 2048,
  mimeType: 'audio/mpeg',
  uploadDate: new Date('2024-01-02'),
  storagePath: '/files/file-2.mp3'
};

const mockVideoFile = {
  id: 'file-3',
  name: 'test-video.mp4',
  size: 4096,
  mimeType: 'video/mp4',
  uploadDate: new Date('2024-01-03'),
  storagePath: '/files/file-3.mp4'
};

const mockTextFile = {
  id: 'file-5',
  name: 'test-text.txt',
  size: 512,
  mimeType: 'text/plain',
  uploadDate: new Date('2024-01-05'),
  storagePath: '/files/file-5.txt'
};

const mockUnknownFile = {
  id: 'file-6',
  name: 'test-unknown.xyz',
  size: 256,
  mimeType: 'application/octet-stream',
  uploadDate: new Date('2024-01-06'),
  storagePath: '/files/file-6.xyz'
};

const mockPdfFile = {
  id: 'file-7',
  name: 'test-document.pdf',
  size: 3072,
  mimeType: 'application/pdf',
  uploadDate: new Date('2024-01-07'),
  storagePath: '/files/file-7.pdf'
};

const pendingPromise = new Promise(() => {});
let limitResult: unknown = pendingPromise;
let updateError: Error | null = null;
let shouldResolve = false;

vi.mock('@/db', () => ({
  getDatabase: () => {
    const chainable = {
      select: vi.fn(() => chainable),
      from: vi.fn(() => chainable),
      where: vi.fn(() => {
        if (updateError) {
          return Promise.reject(updateError);
        }
        return chainable;
      }),
      limit: vi.fn(() => {
        if (shouldResolve) {
          return Promise.resolve(limitResult);
        }
        return pendingPromise;
      }),
      update: vi.fn(() => chainable),
      set: vi.fn(() => chainable),
      catch: vi.fn(() => Promise.resolve())
    };
    return chainable;
  }
}));

vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: () => new Uint8Array(32)
  })
}));

vi.mock('@/storage/opfs', () => ({
  isFileStorageInitialized: () => true,
  initializeFileStorage: vi.fn(),
  getFileStorage: () => ({
    retrieve: () => Promise.resolve(new ArrayBuffer(100)),
    measureRetrieve: () => Promise.resolve(new ArrayBuffer(100))
  }),
  createRetrieveLogger: () => () => {}
}));

const { mockDownloadFile, mockShareFile, getMockCanShare, setMockCanShare } =
  vi.hoisted(() => {
    let mockCanShare = false;
    return {
      mockDownloadFile: vi.fn(),
      mockShareFile: vi.fn().mockResolvedValue(true),
      getMockCanShare: () => mockCanShare,
      setMockCanShare: (value: boolean) => {
        mockCanShare = value;
      }
    };
  });

vi.mock('@/lib/file-utils', () => ({
  canShareFiles: () => getMockCanShare(),
  downloadFile: mockDownloadFile,
  shareFile: mockShareFile
}));

const mockAudioContext = {
  currentTrack: null as { id: string; name: string } | null,
  isPlaying: false,
  play: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn()
};

vi.mock('@/audio', () => ({
  useAudio: () => mockAudioContext
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock for {description}</div>
  )
}));

vi.mock('@/components/DeleteFileDialog', () => ({
  DeleteFileDialog: ({
    open,
    onDelete,
    fileName
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDelete: () => void;
    fileName: string;
  }) =>
    open ? (
      <div data-testid="delete-dialog">
        <span>Delete {fileName}?</span>
        <button type="button" onClick={onDelete} data-testid="confirm-delete">
          Confirm
        </button>
      </div>
    ) : null
}));

vi.mock('@/components/pdf', () => ({
  PdfViewer: ({ data }: { data: Uint8Array }) => (
    <div data-testid="pdf-viewer">PDF Viewer ({data.byteLength} bytes)</div>
  )
}));

const mockObjectUrl = 'blob:http://localhost/test-file';
vi.stubGlobal('URL', {
  createObjectURL: () => mockObjectUrl,
  revokeObjectURL: () => {}
});

describe('FilesWindowDetail', () => {
  const defaultProps = {
    fileId: 'file-1',
    onBack: vi.fn(),
    onDeleted: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabaseState.isUnlocked = true;
    mockDatabaseState.isLoading = false;
    limitResult = [mockImageFile];
    updateError = null;
    shouldResolve = false;
    setMockCanShare(false);
    mockDownloadFile.mockClear();
    mockShareFile.mockClear().mockResolvedValue(true);
    mockAudioContext.currentTrack = null;
    mockAudioContext.isPlaying = false;
    mockAudioContext.play.mockClear();
    mockAudioContext.pause.mockClear();
    mockAudioContext.resume.mockClear();
  });

  it('renders back button', () => {
    render(<FilesWindowDetail {...defaultProps} />);
    expect(screen.getByTestId('window-file-back')).toBeInTheDocument();
  });

  it('calls onBack when back button is clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<FilesWindowDetail {...defaultProps} onBack={onBack} />);

    await user.click(screen.getByTestId('window-file-back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('shows database loading state', () => {
    mockDatabaseState.isLoading = true;
    mockDatabaseState.isUnlocked = false;
    render(<FilesWindowDetail {...defaultProps} />);
    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('shows unlock prompt when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    mockDatabaseState.isLoading = false;
    render(<FilesWindowDetail {...defaultProps} />);
    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('displays image file details after successful fetch', async () => {
    shouldResolve = true;
    limitResult = [mockImageFile];

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByText('test-image.jpg')).toBeInTheDocument();
    });
    expect(screen.getByText('image/jpeg')).toBeInTheDocument();
  });

  it('shows image preview for image files', async () => {
    shouldResolve = true;
    limitResult = [mockImageFile];

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      const img = screen.getByTestId('file-detail-image');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', mockObjectUrl);
    });
  });

  it('shows video player for video files', async () => {
    shouldResolve = true;
    limitResult = [mockVideoFile];

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} fileId="file-3" />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('file-detail-video')).toBeInTheDocument();
    });
  });

  it('shows audio controls for audio files', async () => {
    shouldResolve = true;
    limitResult = [mockAudioFile];

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} fileId="file-2" />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('file-detail-audio-play')).toBeInTheDocument();
    });
  });

  it('plays audio when play button is clicked', async () => {
    shouldResolve = true;
    limitResult = [mockAudioFile];
    const user = userEvent.setup();

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} fileId="file-2" />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('file-detail-audio-play')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('file-detail-audio-play'));

    expect(mockAudioContext.play).toHaveBeenCalledWith({
      id: 'file-2',
      name: 'test-audio.mp3',
      objectUrl: mockObjectUrl,
      mimeType: 'audio/mpeg'
    });
  });

  it('pauses audio when pause button is clicked while playing', async () => {
    shouldResolve = true;
    limitResult = [mockAudioFile];
    mockAudioContext.currentTrack = { id: 'file-2', name: 'test-audio.mp3' };
    mockAudioContext.isPlaying = true;
    const user = userEvent.setup();

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} fileId="file-2" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Pause')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('file-detail-audio-play'));

    expect(mockAudioContext.pause).toHaveBeenCalled();
  });

  it('resumes audio when play button is clicked while paused', async () => {
    shouldResolve = true;
    limitResult = [mockAudioFile];
    mockAudioContext.currentTrack = { id: 'file-2', name: 'test-audio.mp3' };
    mockAudioContext.isPlaying = false;
    const user = userEvent.setup();

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} fileId="file-2" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('file-detail-audio-play'));

    expect(mockAudioContext.resume).toHaveBeenCalled();
  });

  it('shows text content for text files', async () => {
    shouldResolve = true;
    limitResult = [mockTextFile];

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} fileId="file-5" />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('file-detail-text')).toBeInTheDocument();
    });
  });

  it('shows error when file is not found', async () => {
    shouldResolve = true;
    limitResult = [];

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByText('File not found')).toBeInTheDocument();
    });
  });

  it('shows error when fetch fails', async () => {
    const consoleSpy = mockConsoleError();
    shouldResolve = true;
    limitResult = Promise.reject(new Error('Database error'));

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to fetch file:',
      expect.any(Error)
    );
  });

  it('renders delete button when file is loaded', async () => {
    shouldResolve = true;
    limitResult = [mockImageFile];

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-file-delete')).toBeInTheDocument();
    });
  });

  it('opens delete dialog when delete button is clicked', async () => {
    shouldResolve = true;
    limitResult = [mockImageFile];
    const user = userEvent.setup();

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-file-delete')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-file-delete'));

    await waitFor(() => {
      expect(screen.getByTestId('delete-dialog')).toBeInTheDocument();
    });
  });

  it('calls onDeleted when delete is confirmed', async () => {
    shouldResolve = true;
    limitResult = [mockImageFile];
    const user = userEvent.setup();
    const onDeleted = vi.fn();

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} onDeleted={onDeleted} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-file-delete')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-file-delete'));

    await waitFor(() => {
      expect(screen.getByTestId('confirm-delete')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('confirm-delete'));

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalled();
    });
  });

  it('renders download button when file is loaded', async () => {
    shouldResolve = true;
    limitResult = [mockImageFile];

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-file-download')).toBeInTheDocument();
    });
  });

  it('displays file details section', async () => {
    shouldResolve = true;
    limitResult = [mockImageFile];

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Details')).toBeInTheDocument();
    });
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Size')).toBeInTheDocument();
    expect(screen.getByText('Uploaded')).toBeInTheDocument();
  });

  it('shows loading state while fetching file', async () => {
    shouldResolve = false;
    mockDatabaseState.isUnlocked = true;

    render(<FilesWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Loading file...')).toBeInTheDocument();
    });
  });

  it('handles download button click', async () => {
    shouldResolve = true;
    limitResult = [mockImageFile];
    const user = userEvent.setup();

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-file-download')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-file-download'));

    await waitFor(() => {
      expect(mockDownloadFile).toHaveBeenCalled();
    });
  });

  it('does not show share button when sharing is not supported', async () => {
    shouldResolve = true;
    limitResult = [mockImageFile];
    setMockCanShare(false);

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-file-download')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('window-file-share')).not.toBeInTheDocument();
  });

  it('shows share button when sharing is supported', async () => {
    shouldResolve = true;
    limitResult = [mockImageFile];
    setMockCanShare(true);

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-file-share')).toBeInTheDocument();
    });
  });

  it('handles share button click', async () => {
    shouldResolve = true;
    limitResult = [mockImageFile];
    setMockCanShare(true);
    const user = userEvent.setup();

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-file-share')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-file-share'));

    await waitFor(() => {
      expect(mockShareFile).toHaveBeenCalled();
    });
  });

  it('formats file size in details section', async () => {
    shouldResolve = true;
    limitResult = [mockImageFile];

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByText('1 KB')).toBeInTheDocument();
    });
  });

  it('handles share failure gracefully', async () => {
    shouldResolve = true;
    limitResult = [mockImageFile];
    setMockCanShare(true);
    mockShareFile.mockResolvedValue(false);
    const user = userEvent.setup();

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-file-share')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-file-share'));

    await waitFor(() => {
      expect(screen.getByText(/Sharing is not supported/)).toBeInTheDocument();
    });
  });

  it('handles share AbortError gracefully without showing error', async () => {
    shouldResolve = true;
    limitResult = [mockImageFile];
    setMockCanShare(true);
    const abortError = new Error('User cancelled');
    abortError.name = 'AbortError';
    mockShareFile.mockRejectedValue(abortError);
    const user = userEvent.setup();

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-file-share')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-file-share'));

    await waitFor(() => {
      expect(screen.queryByText(/User cancelled/)).not.toBeInTheDocument();
    });
  });

  it('handles download error', async () => {
    shouldResolve = true;
    limitResult = [mockImageFile];
    mockDownloadFile.mockImplementation(() => {
      throw new Error('Download failed');
    });
    const consoleSpy = mockConsoleError();
    const user = userEvent.setup();

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-file-download')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-file-download'));

    await waitFor(() => {
      expect(screen.getByText('Download failed')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to download file:',
      expect.any(Error)
    );
  });

  it('shows PDF viewer for PDF files', async () => {
    shouldResolve = true;
    limitResult = [mockPdfFile];

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} fileId="file-7" />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('file-detail-pdf')).toBeInTheDocument();
    });
  });

  it('shows preview not available for unknown file types', async () => {
    shouldResolve = true;
    limitResult = [mockUnknownFile];

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} fileId="file-6" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Preview not available')).toBeInTheDocument();
    });
  });

  it('handles share error with non-Error object', async () => {
    shouldResolve = true;
    limitResult = [mockImageFile];
    setMockCanShare(true);
    mockShareFile.mockRejectedValue('String error');
    const consoleSpy = mockConsoleError();
    const user = userEvent.setup();

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-file-share')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-file-share'));

    await waitFor(() => {
      expect(screen.getByText('String error')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to share file:',
      'String error'
    );
  });

  it('handles download error with non-Error object', async () => {
    shouldResolve = true;
    limitResult = [mockImageFile];
    mockDownloadFile.mockImplementation(() => {
      throw 'Download string error';
    });
    const consoleSpy = mockConsoleError();
    const user = userEvent.setup();

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-file-download')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-file-download'));

    await waitFor(() => {
      expect(screen.getByText('Download string error')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to download file:',
      'Download string error'
    );
  });

  it('handles fetch error with non-Error object', async () => {
    shouldResolve = true;
    limitResult = Promise.reject('Fetch string error');
    const consoleSpy = mockConsoleError();

    await act(async () => {
      render(<FilesWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Fetch string error')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to fetch file:',
      'Fetch string error'
    );
  });
});
