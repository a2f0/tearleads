/**
 * Photos navigation and click tests.
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

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn(),
  update: vi.fn()
};

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

vi.mock('@/lib/llmRuntime', () => ({
  setAttachedImage: vi.fn()
}));

vi.mock('@/lib/chatAttachments', () => ({
  uint8ArrayToDataUrl: vi.fn()
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
  global.URL.createObjectURL = vi.fn(() => 'blob:test-url');
  global.URL.revokeObjectURL = vi.fn();
}

describe('Photos click navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('navigates to photo detail on left click', async () => {
    const user = userEvent.setup();
    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
    });

    await user.click(screen.getByAltText('test-image.jpg'));

    expect(mockNavigate).toHaveBeenCalledWith('/photos/photo-1', {
      state: { from: '/', fromLabel: 'Back to Photos' }
    });
  });

  it('calls onSelectPhoto on left click when provided', async () => {
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

    await user.click(screen.getByAltText('test-image.jpg'));

    expect(onSelectPhoto).toHaveBeenCalledWith('photo-1');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' ']
  ])('navigates to photo detail on keyboard %s', async (_keyName, key) => {
    const user = userEvent.setup();
    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
    });

    const photoContainer = screen.getByAltText('test-image.jpg').parentElement;
    photoContainer?.focus();
    await user.keyboard(key);

    expect(mockNavigate).toHaveBeenCalledWith('/photos/photo-1', {
      state: { from: '/', fromLabel: 'Back to Photos' }
    });
  });
});

describe('Photos refresh and refetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('refetches photos when refresh is clicked', async () => {
    const user = userEvent.setup();
    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
    });

    mockDb.orderBy.mockClear();

    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(mockDb.orderBy).toHaveBeenCalled();
    });
  });
});

describe('Photos instance switching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('refetches photos when instance changes', async () => {
    const { rerender } = await renderPhotos();

    await waitFor(() => {
      expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
    });

    mockDb.orderBy.mockClear();

    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'new-instance'
    });

    rerender(
      <MemoryRouter>
        <Photos />
      </MemoryRouter>
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(mockDb.orderBy).toHaveBeenCalled();
    });
  });
});
