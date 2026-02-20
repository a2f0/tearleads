/**
 * PhotosWindowDetail share, download, and error handling tests.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/consoleMocks';
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

vi.mock('@/lib/fileUtils', () => ({
  canShareFiles: () => getMockCanShare(),
  downloadFile: mockDownloadFile,
  shareFile: mockShareFile
}));

// Mock LLM hook
vi.mock('@/hooks/llm', () => ({
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

describe('PhotosWindowDetail share and download', () => {
  const defaultProps = {
    photoId: 'photo-1',
    onBack: vi.fn(),
    onDeleted: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabaseState.isUnlocked = true;
    mockDatabaseState.isLoading = false;
    limitResult = pendingPromise;
    updateError = null;
    shouldResolve = false;
    setMockCanShare(false);
    mockShareFile.mockReset().mockResolvedValue(true);
    mockDownloadFile.mockReset();
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

  it('handles share AbortError gracefully without showing error', async () => {
    shouldResolve = true;
    limitResult = [mockPhoto];
    setMockCanShare(true);
    const abortError = new Error('User cancelled');
    abortError.name = 'AbortError';
    mockShareFile.mockRejectedValue(abortError);
    const user = userEvent.setup();

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-photo-share')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-photo-share'));

    await waitFor(() => {
      expect(screen.queryByText(/User cancelled/)).not.toBeInTheDocument();
    });
  });

  it('handles share error with non-Error object', async () => {
    shouldResolve = true;
    limitResult = [mockPhoto];
    setMockCanShare(true);
    mockShareFile.mockRejectedValue('String error');
    const consoleSpy = mockConsoleError();
    const user = userEvent.setup();

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-photo-share')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-photo-share'));

    await waitFor(() => {
      expect(screen.getByText('String error')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to share photo:',
      'String error'
    );
  });

  it('handles download error with non-Error object', async () => {
    shouldResolve = true;
    limitResult = [mockPhoto];
    mockDownloadFile.mockImplementation(() => {
      throw 'Download string error';
    });
    const consoleSpy = mockConsoleError();
    const user = userEvent.setup();

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('window-photo-download')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('window-photo-download'));

    await waitFor(() => {
      expect(screen.getByText('Download string error')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to download photo:',
      'Download string error'
    );
  });

  it('handles fetch error with non-Error object', async () => {
    shouldResolve = true;
    limitResult = Promise.reject('Fetch string error');
    const consoleSpy = mockConsoleError();

    await act(async () => {
      render(<PhotosWindowDetail {...defaultProps} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Fetch string error')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to fetch photo:',
      'Fetch string error'
    );
  });
});
