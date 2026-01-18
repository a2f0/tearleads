import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotosWindowContent } from './PhotosWindowContent';

const mockUsePhotosWindowData = vi.fn();
const mockDownloadFile = vi.fn();
const mockShareFile = vi.fn();
const mockCanShareFiles = vi.fn(() => false);
const mockRetrieve = vi.fn();
const mockIsFileStorageInitialized = vi.fn((_instanceId?: string) => true);
const mockInitializeFileStorage = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockWhere = vi.fn();
const mockDb = {
  update: mockUpdate
};

mockUpdate.mockReturnValue({ set: mockSet });
mockSet.mockReturnValue({ where: mockWhere });

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [{ index: 0, start: 0, size: 72 }],
    getTotalSize: () => 72,
    measureElement: () => undefined
  })
}));

vi.mock('./usePhotosWindowData', () => ({
  usePhotosWindowData: () => mockUsePhotosWindowData()
}));

vi.mock('@/db', () => ({
  getDatabase: () => mockDb
}));

vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: () => new Uint8Array(32)
  })
}));

vi.mock('@/storage/opfs', () => ({
  isFileStorageInitialized: (instanceId?: string) =>
    mockIsFileStorageInitialized(instanceId),
  initializeFileStorage: (encryptionKey: Uint8Array, instanceId: string) =>
    mockInitializeFileStorage(encryptionKey, instanceId),
  getFileStorage: () => ({
    retrieve: mockRetrieve
  })
}));

vi.mock('@/lib/file-utils', () => ({
  canShareFiles: () => mockCanShareFiles(),
  downloadFile: (data: ArrayBuffer, name: string) =>
    mockDownloadFile(data, name),
  shareFile: (data: ArrayBuffer, name: string, mimeType: string) =>
    mockShareFile(data, name, mimeType)
}));

vi.mock('@/i18n', () => ({
  useTypedTranslation: () => ({
    t: (key: string) =>
      ({
        getInfo: 'Get Info',
        delete: 'Delete',
        download: 'Download'
      })[key] ?? key
  })
}));

describe('PhotosWindowContent', () => {
  const photo = {
    id: 'photo-1',
    name: 'photo.jpg',
    size: 1200,
    mimeType: 'image/jpeg',
    uploadDate: new Date('2024-01-01T00:00:00Z'),
    storagePath: '/photos/photo.jpg',
    thumbnailPath: null,
    objectUrl: 'blob:photo'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRetrieve.mockResolvedValue(new ArrayBuffer(8));
  });

  it('shows empty state when no photos are available', () => {
    mockUsePhotosWindowData.mockReturnValue({
      photos: [],
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      isLoading: false,
      refresh: vi.fn(),
      currentInstanceId: 'instance-1'
    });

    render(<PhotosWindowContent refreshToken={0} />);

    expect(
      screen.getByText('No photos yet. Use Upload to add images.')
    ).toBeInTheDocument();
  });

  it('calls onSelectPhoto when a row is clicked', async () => {
    const onSelectPhoto = vi.fn();
    mockUsePhotosWindowData.mockReturnValue({
      photos: [photo],
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      isLoading: false,
      refresh: vi.fn(),
      currentInstanceId: 'instance-1'
    });

    render(
      <PhotosWindowContent refreshToken={0} onSelectPhoto={onSelectPhoto} />
    );

    const user = userEvent.setup();
    const rowButton = screen.getByRole('button', { name: /photo\.jpg/ });
    await user.click(rowButton);

    expect(onSelectPhoto).toHaveBeenCalledWith('photo-1');
  });

  it('shows error state when hook returns error', () => {
    mockUsePhotosWindowData.mockReturnValue({
      photos: [],
      loading: false,
      error: 'Something went wrong',
      hasFetched: true,
      isUnlocked: true,
      isLoading: false,
      refresh: vi.fn(),
      currentInstanceId: 'instance-1'
    });

    render(<PhotosWindowContent refreshToken={0} />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('downloads and shares photos from action buttons', async () => {
    mockCanShareFiles.mockReturnValue(true);
    mockUsePhotosWindowData.mockReturnValue({
      photos: [photo],
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      isLoading: false,
      refresh: vi.fn(),
      currentInstanceId: 'instance-1'
    });

    const user = userEvent.setup();
    render(<PhotosWindowContent refreshToken={0} />);

    await user.click(screen.getByTitle('Download'));
    await user.click(screen.getByTitle('Share'));

    expect(mockRetrieve).toHaveBeenCalledWith('/photos/photo.jpg');
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      'photo.jpg'
    );
    expect(mockShareFile).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      'photo.jpg',
      'image/jpeg'
    );
  });

  it('hides share action when sharing is unsupported', () => {
    mockCanShareFiles.mockReturnValue(false);
    mockUsePhotosWindowData.mockReturnValue({
      photos: [photo],
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      isLoading: false,
      refresh: vi.fn(),
      currentInstanceId: 'instance-1'
    });

    render(<PhotosWindowContent refreshToken={0} />);

    expect(screen.queryByTitle('Share')).not.toBeInTheDocument();
  });

  it('deletes photo from context menu', async () => {
    const refresh = vi.fn();
    mockUsePhotosWindowData.mockReturnValue({
      photos: [photo],
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      isLoading: false,
      refresh,
      currentInstanceId: 'instance-1'
    });

    const user = userEvent.setup();
    render(<PhotosWindowContent refreshToken={0} />);

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByText('photo.jpg')
    });
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(mockWhere).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });
});
