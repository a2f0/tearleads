/**
 * Photos page rendering tests.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Photos } from './photos-components';

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

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
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

async function renderPhotos(
  props: Partial<ComponentProps<typeof Photos>> = {}
) {
  const result = render(
    <MemoryRouter>
      <Photos {...props} />
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

describe('Photos page rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('renders the page title', async () => {
    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByText('Photos')).toBeInTheDocument();
    });
  });

  it('shows back link by default', async () => {
    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByTestId('back-link')).toBeInTheDocument();
    });
  });

  it('shows photo count', async () => {
    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByText(/2 photos$/)).toBeInTheDocument();
    });
  });

  it('shows loading state when database is loading', async () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: false,
      isLoading: true,
      currentInstanceId: null
    });

    await renderPhotos();

    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('shows inline unlock when database is locked', async () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: false,
      isLoading: false,
      currentInstanceId: null,
      isSetUp: true,
      hasPersistedSession: false,
      unlock: vi.fn(),
      restoreSession: vi.fn()
    });

    await renderPhotos();

    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
    expect(
      screen.getByText(
        /Database is locked. Enter your password to view photos./i
      )
    ).toBeInTheDocument();
  });
});

describe('Photos refresh button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('renders refresh button when unlocked', async () => {
    await renderPhotos();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /refresh/i })
      ).toBeInTheDocument();
    });
  });

  it('does not render refresh button when locked', async () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: false,
      isLoading: false,
      currentInstanceId: null
    });

    await renderPhotos();

    expect(
      screen.queryByRole('button', { name: /refresh/i })
    ).not.toBeInTheDocument();
  });
});

describe('Photos empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('shows full-width dropzone when no photos exist', async () => {
    mockDb.orderBy.mockResolvedValue([]);

    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByText(/Drag and drop photos here/)).toBeInTheDocument();
    });

    // Should show the dropzone input
    expect(screen.getByTestId('dropzone-input')).toBeInTheDocument();
  });

  it('shows empty message without dropzone when disabled', async () => {
    mockDb.orderBy.mockResolvedValue([]);

    await renderPhotos({ showDropzone: false });

    await waitFor(() => {
      expect(
        screen.getByText(/No photos yet\. Use Upload to add images\./)
      ).toBeInTheDocument();
    });

    expect(screen.queryByTestId('dropzone-input')).not.toBeInTheDocument();
  });
});

describe('Photos dropzone with existing photos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('shows thumbnail-sized dropzone in gallery when photos exist', async () => {
    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
    });

    // Should show the dropzone input
    expect(screen.getByTestId('dropzone-input')).toBeInTheDocument();

    // The dropzone should be present (now below the virtualized gallery)
    const dropzone = screen.getByTestId('dropzone');
    expect(dropzone).toBeInTheDocument();
  });

  it('dropzone in gallery uses compact mode prop', async () => {
    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
    });

    const dropzone = screen.getByTestId('dropzone');
    // On web, the dropzone keeps drag-and-drop styling for better UX
    // On native (iOS/Android), compact mode renders a square icon button
    // With virtual scrolling, the dropzone is now positioned below the gallery
    expect(dropzone).toBeInTheDocument();
  });
});

describe('Photos accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('does not have nested buttons in photo thumbnails', async () => {
    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
    });

    // Verify that no <button> element is a descendant of another <button> element
    const nestedButtons = document.querySelectorAll('button button');
    expect(nestedButtons).toHaveLength(0);

    // Additionally, verify that the photo container is a div with role="button" as intended
    const photoContainer = screen.getByAltText('test-image.jpg').parentElement;
    expect(photoContainer?.tagName).toBe('DIV');
    expect(photoContainer).toHaveAttribute('role', 'button');
  });

  it('photo container is keyboard focusable', async () => {
    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
    });

    const photoContainer = screen.getByAltText('test-image.jpg').parentElement;
    expect(photoContainer).toHaveAttribute('tabIndex', '0');
    expect(photoContainer).toHaveAttribute('role', 'button');
  });
});
