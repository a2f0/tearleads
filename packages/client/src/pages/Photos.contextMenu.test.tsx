/**
 * Photos context menu tests.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks must be defined in each test file (hoisted)
vi.mock('@/components/photos-window/PhotosAlbumsSidebar', () => ({
  ALL_PHOTOS_ID: '__all__',
  PhotosAlbumsSidebar: vi.fn(() => <div data-testid="photos-albums-sidebar" />)
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 120,
        size: 120,
        key: i
      })),
    getTotalSize: () => count * 120,
    measureElement: vi.fn()
  }))
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockUpdateWhere = vi.fn();
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn(),
  update: mockUpdate
};
mockUpdate.mockReturnValue({ set: mockSet });
mockSet.mockReturnValue({ where: mockUpdateWhere });

vi.mock('@/db', () => ({ getDatabase: vi.fn(() => mockDb) }));
vi.mock('@/db/crypto', () => ({
  getKeyManager: vi.fn(() => ({
    getCurrentKey: vi.fn(() => new Uint8Array(32))
  }))
}));

const mockStorage = { retrieve: vi.fn() };
vi.mock('@/storage/opfs', () => ({
  isFileStorageInitialized: () => true,
  initializeFileStorage: vi.fn(),
  getFileStorage: vi.fn(() => mockStorage),
  createRetrieveLogger: () => vi.fn()
}));

vi.mock('@/hooks/useFileUpload', () => ({
  useFileUpload: () => ({ uploadFile: vi.fn() })
}));

vi.mock('@/lib/fileUtils', () => ({
  canShareFiles: () => false,
  downloadFile: vi.fn(),
  shareFile: vi.fn()
}));

const mockSetAttachedImage = vi.fn();
vi.mock('@/lib/llmRuntime', () => ({
  setAttachedImage: (image: string | null) => mockSetAttachedImage(image)
}));

const mockUint8ArrayToDataUrl = vi.fn();
vi.mock('@/lib/chatAttachments', () => ({
  uint8ArrayToDataUrl: (data: Uint8Array, mimeType: string) =>
    mockUint8ArrayToDataUrl(data, mimeType)
}));

import { Photos } from './photos-components';

const mockPhotos = [
  {
    id: 'photo-1',
    name: 'test-image.jpg',
    size: 1024,
    mimeType: 'image/jpeg',
    uploadDate: new Date('2025-01-01'),
    storagePath: '/photos/test-image.jpg'
  },
  {
    id: 'photo-2',
    name: 'another-image.png',
    size: 2048,
    mimeType: 'image/png',
    uploadDate: new Date('2025-01-02'),
    storagePath: '/photos/another-image.png'
  }
];

async function renderPhotos() {
  const result = render(
    <MemoryRouter>
      <Photos />
    </MemoryRouter>
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return result;
}

function setupDefaultMocks() {
  mockUseDatabaseContext.mockReturnValue({
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: 'test-instance'
  });
  mockDb.orderBy.mockResolvedValue(mockPhotos);
  mockStorage.retrieve.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mockSetAttachedImage.mockReset();
  mockUint8ArrayToDataUrl.mockResolvedValue(
    'data:image/jpeg;base64,test-image'
  );
  global.URL.createObjectURL = vi.fn(() => 'blob:test-url');
  global.URL.revokeObjectURL = vi.fn();
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdateWhere.mockResolvedValue(undefined);
}

describe('Photos context menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('shows context menu on right-click', async () => {
    const user = userEvent.setup();
    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
    });

    const photo = screen.getByAltText('test-image.jpg');
    await user.pointer({ keys: '[MouseRight]', target: photo });

    await waitFor(() => {
      expect(screen.getByText('Get info')).toBeInTheDocument();
    });
  });

  it('navigates to photo detail when "Get info" is clicked', async () => {
    const user = userEvent.setup();
    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
    });

    const photo = screen.getByAltText('test-image.jpg');
    await user.pointer({ keys: '[MouseRight]', target: photo });

    await waitFor(() => {
      expect(screen.getByText('Get info')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Get info'));

    expect(mockNavigate).toHaveBeenCalledWith('/photos/photo-1', {
      state: { from: '/', fromLabel: 'Back to Photos' }
    });
  });

  it('calls onSelectPhoto callback instead of navigating when provided', async () => {
    const user = userEvent.setup();
    const onSelectPhoto = vi.fn();

    render(
      <MemoryRouter>
        <Photos onSelectPhoto={onSelectPhoto} />
      </MemoryRouter>
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
    });

    const photo = screen.getByAltText('test-image.jpg');
    await user.pointer({ keys: '[MouseRight]', target: photo });

    await waitFor(() => {
      expect(screen.getByText('Get info')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Get info'));

    expect(onSelectPhoto).toHaveBeenCalledWith('photo-1');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('closes context menu when clicking elsewhere', async () => {
    const user = userEvent.setup();
    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
    });

    const photo = screen.getByAltText('test-image.jpg');
    await user.pointer({ keys: '[MouseRight]', target: photo });

    await waitFor(() => {
      expect(screen.getByText('Get info')).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole('button', { name: /close context menu/i })
    );

    await waitFor(() => {
      expect(screen.queryByText('Get info')).not.toBeInTheDocument();
    });
  });

  it('closes context menu when pressing Escape', async () => {
    const user = userEvent.setup();
    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
    });

    const photo = screen.getByAltText('test-image.jpg');
    await user.pointer({ keys: '[MouseRight]', target: photo });

    await waitFor(() => {
      expect(screen.getByText('Get info')).toBeInTheDocument();
    });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByText('Get info')).not.toBeInTheDocument();
    });
  });

  it('shows "Delete" option in context menu', async () => {
    const user = userEvent.setup();
    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
    });

    const photo = screen.getByAltText('test-image.jpg');
    await user.pointer({ keys: '[MouseRight]', target: photo });

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });

  it('adds photo to AI chat from context menu', async () => {
    const user = userEvent.setup();
    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
    });

    const photo = screen.getByAltText('test-image.jpg');
    await user.pointer({ keys: '[MouseRight]', target: photo });
    await user.click(screen.getByText('Add to AI chat'));

    await waitFor(() => {
      expect(mockSetAttachedImage).toHaveBeenCalledWith(
        'data:image/jpeg;base64,test-image'
      );
    });
    expect(mockNavigate).toHaveBeenCalledWith('/chat', {
      state: { from: '/', fromLabel: 'Back to Photos' }
    });
  });

  it('soft deletes photo when "Delete" is clicked', async () => {
    const user = userEvent.setup();
    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
    });

    const photo = screen.getByAltText('test-image.jpg');
    await user.pointer({ keys: '[MouseRight]', target: photo });

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith({ deleted: true });
    });
  });

  it('shows error when delete fails', async () => {
    const user = userEvent.setup();
    mockUpdateWhere.mockRejectedValue(new Error('Delete failed'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
    });

    const photo = screen.getByAltText('test-image.jpg');
    await user.pointer({ keys: '[MouseRight]', target: photo });

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it('handles non-Error exceptions when delete fails', async () => {
    const user = userEvent.setup();
    mockUpdateWhere.mockRejectedValue('String error');

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
    });

    const photo = screen.getByAltText('test-image.jpg');
    await user.pointer({ keys: '[MouseRight]', target: photo });

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(screen.getByText('String error')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it('triggers refetch after successful delete', async () => {
    const user = userEvent.setup();
    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
    });

    const photo = screen.getByAltText('test-image.jpg');
    await user.pointer({ keys: '[MouseRight]', target: photo });

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    mockDb.orderBy.mockClear();

    await user.click(screen.getByText('Delete'));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(mockDb.orderBy).toHaveBeenCalled();
    });
  });
});
