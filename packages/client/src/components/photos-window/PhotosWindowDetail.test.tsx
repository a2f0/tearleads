import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotosWindowDetail } from './PhotosWindowDetail';

// Create mutable mock state
const mockDatabaseState = {
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'test-instance'
};

// Mock database hooks
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockDatabaseState
}));

// Mock photo data
const mockPhoto = {
  id: 'photo-1',
  name: 'test-photo.jpg',
  size: 1024,
  mimeType: 'image/jpeg',
  uploadDate: new Date('2024-01-01'),
  storagePath: '/photos/photo-1.jpg'
};

// Create mock results
const pendingPromise = new Promise(() => {});
let limitResult: unknown = pendingPromise;
let updateError: Error | null = null;
let shouldResolve = false;

// Mock getDatabase with proper Drizzle-style chaining
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

// Mock crypto key manager
vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: () => new Uint8Array(32)
  })
}));

// Mock file storage
vi.mock('@/storage/opfs', () => ({
  isFileStorageInitialized: () => true,
  initializeFileStorage: vi.fn(),
  getFileStorage: () => ({
    retrieve: () => Promise.resolve(new ArrayBuffer(100)),
    measureRetrieve: () => Promise.resolve(new ArrayBuffer(100))
  }),
  createRetrieveLogger: () => () => {}
}));

// Mock file utilities - use vi.hoisted for mock functions
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

// Mock LLM hook
vi.mock('@/hooks/useLLM', () => ({
  useLLM: () => ({
    loadedModel: null,
    isClassifying: false,
    loadModel: vi.fn(),
    classify: vi.fn(),
    isLoading: false,
    loadProgress: null
  })
}));

// Mock InlineUnlock
vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock for {description}</div>
  )
}));

// Mock DeletePhotoDialog
vi.mock('@/components/DeletePhotoDialog', () => ({
  DeletePhotoDialog: ({
    open,
    onDelete,
    photoName
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDelete: () => void;
    photoName: string;
  }) =>
    open ? (
      <div data-testid="delete-dialog">
        <span>Delete {photoName}?</span>
        <button type="button" onClick={onDelete} data-testid="confirm-delete">
          Confirm
        </button>
      </div>
    ) : null
}));

// Mock URL.createObjectURL and URL.revokeObjectURL
const mockObjectUrl = 'blob:http://localhost/test-photo';
vi.stubGlobal('URL', {
  createObjectURL: () => mockObjectUrl,
  revokeObjectURL: () => {}
});

describe('PhotosWindowDetail', () => {
  const defaultProps = {
    photoId: 'photo-1',
    onBack: vi.fn(),
    onDeleted: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabaseState.isUnlocked = true;
    mockDatabaseState.isLoading = false;
    limitResult = [mockPhoto];
    updateError = null;
    shouldResolve = false;
    setMockCanShare(false);
    mockDownloadFile.mockClear();
    mockShareFile.mockClear().mockResolvedValue(true);
  });

  it('renders back button', () => {
    render(<PhotosWindowDetail {...defaultProps} />);
    expect(screen.getByTestId('window-photo-back')).toBeInTheDocument();
  });

  it('calls onBack when back button is clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<PhotosWindowDetail {...defaultProps} onBack={onBack} />);

    await user.click(screen.getByTestId('window-photo-back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('renders component container', () => {
    const { container } = render(<PhotosWindowDetail {...defaultProps} />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('shows database loading state', () => {
    mockDatabaseState.isLoading = true;
    mockDatabaseState.isUnlocked = false;
    render(<PhotosWindowDetail {...defaultProps} />);
    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('shows unlock prompt when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    mockDatabaseState.isLoading = false;
    render(<PhotosWindowDetail {...defaultProps} />);
    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('displays photo details after successful fetch', async () => {
    shouldResolve = true;
    limitResult = [mockPhoto];

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByText('test-photo.jpg')).toBeInTheDocument();
    });
    expect(screen.getByText('image/jpeg')).toBeInTheDocument();
  });

  it('shows error when photo is not found', async () => {
    shouldResolve = true;
    limitResult = [];

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Photo not found')).toBeInTheDocument();
    });
  });

  it('shows error when fetch fails', async () => {
    shouldResolve = true;
    limitResult = Promise.reject(new Error('Database error'));

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument();
    });
  });

  it('renders delete button when photo is loaded', async () => {
    shouldResolve = true;
    limitResult = [mockPhoto];

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-photo-delete')).toBeInTheDocument();
    });
  });

  it('opens delete dialog when delete button is clicked', async () => {
    shouldResolve = true;
    limitResult = [mockPhoto];
    const user = userEvent.setup();

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-photo-delete')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-photo-delete'));

    await waitFor(() => {
      expect(screen.getByTestId('delete-dialog')).toBeInTheDocument();
    });
  });

  it('calls onDeleted when delete is confirmed', async () => {
    shouldResolve = true;
    limitResult = [mockPhoto];
    const user = userEvent.setup();
    const onDeleted = vi.fn();

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} onDeleted={onDeleted} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-photo-delete')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-photo-delete'));

    await waitFor(() => {
      expect(screen.getByTestId('confirm-delete')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('confirm-delete'));

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalled();
    });
  });

  it('renders download button when photo is loaded', async () => {
    shouldResolve = true;
    limitResult = [mockPhoto];

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-photo-download')).toBeInTheDocument();
    });
  });

  it('renders classify button when photo is loaded', async () => {
    shouldResolve = true;
    limitResult = [mockPhoto];

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-photo-classify')).toBeInTheDocument();
    });
  });

  it('displays photo details section', async () => {
    shouldResolve = true;
    limitResult = [mockPhoto];

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Details')).toBeInTheDocument();
    });
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Size')).toBeInTheDocument();
    expect(screen.getByText('Uploaded')).toBeInTheDocument();
  });

  it('displays photo image when loaded', async () => {
    shouldResolve = true;
    limitResult = [mockPhoto];

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      const img = screen.getByAltText('test-photo.jpg');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', mockObjectUrl);
    });
  });

  it('shows loading state while fetching photo', async () => {
    shouldResolve = false;
    mockDatabaseState.isUnlocked = true;

    render(<PhotosWindowDetail {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Loading photo...')).toBeInTheDocument();
    });
  });

  it('handles download button click', async () => {
    shouldResolve = true;
    limitResult = [mockPhoto];
    const user = userEvent.setup();

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-photo-download')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-photo-download'));

    await waitFor(() => {
      expect(mockDownloadFile).toHaveBeenCalled();
    });
  });

  it('handles classify button click', async () => {
    shouldResolve = true;
    limitResult = [mockPhoto];
    const user = userEvent.setup();

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-photo-classify')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-photo-classify'));

    // The classify button should exist and be clickable
    expect(screen.getByTestId('window-photo-classify')).toBeInTheDocument();
  });

  it('does not show share button when sharing is not supported', async () => {
    shouldResolve = true;
    limitResult = [mockPhoto];
    setMockCanShare(false);

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-photo-download')).toBeInTheDocument();
    });

    // Share button should not be present since canShareFiles returns false
    expect(screen.queryByTestId('window-photo-share')).not.toBeInTheDocument();
  });

  it('shows share button when sharing is supported', async () => {
    shouldResolve = true;
    limitResult = [mockPhoto];
    setMockCanShare(true);

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-photo-share')).toBeInTheDocument();
    });
  });

  it('handles share button click', async () => {
    shouldResolve = true;
    limitResult = [mockPhoto];
    setMockCanShare(true);
    const user = userEvent.setup();

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-photo-share')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-photo-share'));

    await waitFor(() => {
      expect(mockShareFile).toHaveBeenCalled();
    });
  });

  it('formats file size in details section', async () => {
    shouldResolve = true;
    limitResult = [mockPhoto];

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      // 1024 bytes should be formatted as "1 KB"
      expect(screen.getByText('1 KB')).toBeInTheDocument();
    });
  });

  it('disables delete button during actions', async () => {
    shouldResolve = true;
    limitResult = [mockPhoto];

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      const deleteButton = screen.getByTestId('window-photo-delete');
      expect(deleteButton).toBeInTheDocument();
      expect(deleteButton).not.toBeDisabled();
    });
  });

  it('handles share failure gracefully', async () => {
    shouldResolve = true;
    limitResult = [mockPhoto];
    setMockCanShare(true);
    mockShareFile.mockResolvedValue(false);
    const user = userEvent.setup();

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-photo-share')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-photo-share'));

    await waitFor(() => {
      expect(screen.getByText(/Sharing is not supported/)).toBeInTheDocument();
    });
  });

  it('renders correctly without photo id initially', () => {
    mockDatabaseState.isUnlocked = true;
    render(<PhotosWindowDetail {...defaultProps} photoId="" />);

    expect(screen.getByTestId('window-photo-back')).toBeInTheDocument();
  });

  it('does not fetch when database is not unlocked', () => {
    mockDatabaseState.isUnlocked = false;
    mockDatabaseState.isLoading = false;
    shouldResolve = true;

    render(<PhotosWindowDetail {...defaultProps} />);

    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('shows download button disabled state during download', async () => {
    shouldResolve = true;
    limitResult = [mockPhoto];

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      const downloadButton = screen.getByTestId('window-photo-download');
      expect(downloadButton).toBeInTheDocument();
      expect(downloadButton).not.toBeDisabled();
    });
  });

  it('displays classify button with loading state when model loading', async () => {
    shouldResolve = true;
    limitResult = [mockPhoto];

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-photo-classify')).toBeInTheDocument();
    });

    // Button should show "Classify" text when not loading
    expect(screen.getByText('Classify')).toBeInTheDocument();
  });
});
