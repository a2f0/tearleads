import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotosWindowTableView } from './PhotosWindowTableView';

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

describe('PhotosWindowTableView', () => {
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

    render(<PhotosWindowTableView refreshToken={0} />);

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
      <PhotosWindowTableView refreshToken={0} onSelectPhoto={onSelectPhoto} />
    );

    const user = userEvent.setup();
    const row = screen.getByText('photo.jpg');
    await user.click(row);

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

    render(<PhotosWindowTableView refreshToken={0} />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('handles context menu actions', async () => {
    const refresh = vi.fn();
    mockCanShareFiles.mockReturnValue(true);
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
    render(<PhotosWindowTableView refreshToken={0} />);

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByText('photo.jpg')
    });

    await user.click(screen.getByRole('button', { name: 'Download' }));
    await user.click(screen.getByRole('button', { name: 'Share' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

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
    expect(mockWhere).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it('does not show share action when sharing is unsupported', async () => {
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

    const user = userEvent.setup();
    render(<PhotosWindowTableView refreshToken={0} />);

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByText('photo.jpg')
    });

    expect(
      screen.queryByRole('button', { name: 'Share' })
    ).not.toBeInTheDocument();
  });

  it('sorts by name when header is clicked', async () => {
    mockUsePhotosWindowData.mockReturnValue({
      photos: [
        {
          ...photo,
          id: 'photo-1',
          name: 'b.jpg',
          uploadDate: new Date('2024-01-02T00:00:00Z')
        },
        {
          ...photo,
          id: 'photo-2',
          name: 'a.jpg',
          uploadDate: new Date('2024-01-01T00:00:00Z')
        }
      ],
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      isLoading: false,
      refresh: vi.fn(),
      currentInstanceId: 'instance-1'
    });

    const user = userEvent.setup();
    render(<PhotosWindowTableView refreshToken={0} />);

    await user.click(screen.getByRole('button', { name: 'Name' }));

    const rows = screen.getAllByRole('row');
    expect(rows[1]?.textContent).toContain('a.jpg');

    await user.click(screen.getByRole('button', { name: 'Name' }));
    expect(rows[1]?.textContent).toContain('b.jpg');
  });
});
