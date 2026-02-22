import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotosWindowContent } from './PhotosWindowContent';

const mockUsePhotosWindowData = vi.fn();
const mockDownloadFile = vi.fn();
const mockShareFile = vi.fn();
const mockCanShareFiles = vi.fn(() => false);
const mockDeletePhoto = vi.fn();
const mockRestorePhoto = vi.fn();
const mockDownloadPhoto = vi.fn();
const mockSharePhoto = vi.fn();
const mockSetAttachedImage = vi.fn();
const mockUint8ArrayToDataUrl = vi.fn();

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [{ index: 0, start: 0, size: 72 }],
    getTotalSize: () => 72,
    measureElement: () => undefined
  })
}));

vi.mock('./usePhotosWindowData', () => ({
  usePhotosWindowData: () => ({
    ...mockUsePhotosWindowData(),
    deletePhoto: mockDeletePhoto,
    restorePhoto: mockRestorePhoto,
    downloadPhoto: mockDownloadPhoto,
    sharePhoto: mockSharePhoto
  })
}));

vi.mock('@/lib/fileUtils', () => ({
  canShareFiles: () => mockCanShareFiles(),
  downloadFile: (data: ArrayBuffer, name: string) =>
    mockDownloadFile(data, name),
  shareFile: (data: ArrayBuffer, name: string, mimeType: string) =>
    mockShareFile(data, name, mimeType)
}));

vi.mock('@/lib/llmRuntime', () => ({
  setAttachedImage: (image: string | null) => mockSetAttachedImage(image)
}));

vi.mock('@/lib/chatAttachments', () => ({
  uint8ArrayToDataUrl: (data: Uint8Array, mimeType: string) =>
    mockUint8ArrayToDataUrl(data, mimeType)
}));

vi.mock('@/i18n', () => ({
  useTypedTranslation: () => ({
    t: (key: string) =>
      ({
        getInfo: 'Get Info',
        delete: 'Delete',
        restore: 'Restore',
        download: 'Download',
        share: 'Share'
      })[key] ?? key
  })
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">{description}</div>
  )
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
    mockDownloadPhoto.mockResolvedValue(new ArrayBuffer(8));
    mockSharePhoto.mockResolvedValue(new ArrayBuffer(8));
    mockUint8ArrayToDataUrl.mockResolvedValue('data:image/jpeg;base64,photo');
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

  it('renders dropzone when showDropzone is enabled and empty', () => {
    const onUploadFiles = vi.fn();
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

    render(
      <PhotosWindowContent
        refreshToken={0}
        showDropzone={true}
        onUploadFiles={onUploadFiles}
      />
    );

    expect(screen.getByTestId('dropzone-input')).toBeInTheDocument();
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

    expect(mockDownloadPhoto).toHaveBeenCalledWith(photo);
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      'photo.jpg'
    );
    expect(mockSharePhoto).toHaveBeenCalledWith(photo);
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

  it('ignores share abort errors', async () => {
    const abortError = new Error('Share aborted');
    abortError.name = 'AbortError';
    mockCanShareFiles.mockReturnValue(true);
    mockShareFile.mockRejectedValueOnce(abortError);
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

    await user.click(screen.getByTitle('Share'));

    expect(mockShareFile).toHaveBeenCalled();
  });

  it('logs share errors for non-abort failures', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCanShareFiles.mockReturnValue(true);
    mockShareFile.mockRejectedValueOnce(new Error('Share failed'));
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

    await user.click(screen.getByTitle('Share'));

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to share photo:',
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it('logs download errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDownloadPhoto.mockRejectedValueOnce(new Error('Download failed'));
    mockUsePhotosWindowData.mockReturnValue({
      photos: [photo],
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      isLoading: false,
      refresh: vi.fn(),
      currentInstanceId: null
    });

    const user = userEvent.setup();
    render(<PhotosWindowContent refreshToken={0} />);

    await user.click(screen.getByTitle('Download'));

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to download photo:',
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it('renders the unlock prompt when database is locked', () => {
    mockUsePhotosWindowData.mockReturnValue({
      photos: [],
      loading: false,
      error: null,
      hasFetched: false,
      isUnlocked: false,
      isLoading: false,
      refresh: vi.fn(),
      currentInstanceId: null
    });

    render(<PhotosWindowContent refreshToken={0} />);

    expect(screen.getByTestId('inline-unlock')).toHaveTextContent('photos');
  });

  it('shows loading state when database is loading', () => {
    mockUsePhotosWindowData.mockReturnValue({
      photos: [],
      loading: false,
      error: null,
      hasFetched: false,
      isUnlocked: false,
      isLoading: true,
      refresh: vi.fn(),
      currentInstanceId: null
    });

    render(<PhotosWindowContent refreshToken={0} />);

    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('shows loading photos when fetching', () => {
    mockUsePhotosWindowData.mockReturnValue({
      photos: [],
      loading: true,
      error: null,
      hasFetched: false,
      isUnlocked: true,
      isLoading: false,
      refresh: vi.fn(),
      currentInstanceId: 'instance-1'
    });

    render(<PhotosWindowContent refreshToken={0} />);

    expect(screen.getByText('Loading photos...')).toBeInTheDocument();
  });
});
