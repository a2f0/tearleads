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

describe('PhotosWindowContent context menu and upload', () => {
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

  it('opens photo details from the context menu', async () => {
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

    const user = userEvent.setup();
    render(
      <PhotosWindowContent refreshToken={0} onSelectPhoto={onSelectPhoto} />
    );

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByText('photo.jpg')
    });
    await user.click(screen.getByRole('button', { name: 'Get Info' }));

    expect(onSelectPhoto).toHaveBeenCalledWith('photo-1');
  });

  it('renders compact dropzone when showDropzone is enabled with photos', () => {
    const onUploadFiles = vi.fn();
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
      <PhotosWindowContent
        refreshToken={0}
        showDropzone={true}
        onUploadFiles={onUploadFiles}
      />
    );

    expect(screen.getByTestId('dropzone')).toBeInTheDocument();
  });

  it('deletes photo from context menu', async () => {
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

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByText('photo.jpg')
    });
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(mockDeletePhoto).toHaveBeenCalledWith('photo-1');
  });

  it('restores deleted photo from context menu', async () => {
    mockUsePhotosWindowData.mockReturnValue({
      photos: [{ ...photo, deleted: true }],
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

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByText('photo.jpg')
    });
    await user.click(screen.getByRole('button', { name: 'Restore' }));

    expect(mockRestorePhoto).toHaveBeenCalledWith('photo-1');
  });

  it('adds photo to AI chat from context menu', async () => {
    const onOpenAIChat = vi.fn();
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
    render(
      <PhotosWindowContent refreshToken={0} onOpenAIChat={onOpenAIChat} />
    );

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByText('photo.jpg')
    });
    await user.click(screen.getByRole('button', { name: 'Add to AI chat' }));

    expect(mockSetAttachedImage).toHaveBeenCalledWith(
      'data:image/jpeg;base64,photo'
    );
    expect(onOpenAIChat).toHaveBeenCalled();
  });

  it('shows upload progress when uploading', () => {
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
      <PhotosWindowContent
        refreshToken={0}
        uploading={true}
        uploadProgress={50}
      />
    );

    expect(screen.getByText('Uploading...')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('hides file list when uploading', () => {
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
      <PhotosWindowContent
        refreshToken={0}
        uploading={true}
        uploadProgress={25}
      />
    );

    expect(screen.queryByText('photo.jpg')).not.toBeInTheDocument();
  });
});
