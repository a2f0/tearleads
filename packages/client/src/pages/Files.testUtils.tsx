/**
 * Shared mocks and utilities for Files tests.
 */

import { ThemeProvider } from '@tearleads/ui';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, vi } from 'vitest';
import { Files } from './Files';

// Mock useVirtualizer to simplify testing
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(
    (options: { count: number } & Record<string, unknown>) => {
      const getScrollElement = options['getScrollElement'];
      if (typeof getScrollElement === 'function') {
        getScrollElement();
      }
      const estimateSize = options['estimateSize'];
      if (typeof estimateSize === 'function') {
        estimateSize();
      }

      const { count } = options;
      return {
        getVirtualItems: Object.assign(
          () =>
            Array.from({ length: count }, (_, i) => ({
              index: i,
              start: i * 56,
              end: (i + 1) * 56,
              size: 56,
              key: i,
              lane: 0
            })),
          { updateDeps: vi.fn() }
        ),
        getTotalSize: () => count * 56,
        measureElement: vi.fn()
      };
    }
  )
}));

export const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

// Mock the database context
export const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

// Mock the database
export const mockSelect = vi.fn();
export const mockUpdate = vi.fn();
vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: mockSelect,
    update: mockUpdate
  })
}));

// Mock the key manager
export const mockGetCurrentKey = vi.fn();
vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: mockGetCurrentKey
  })
}));

// Mock file storage
export const mockRetrieve = vi.fn();
const mockStore = vi.fn();
export const mockIsFileStorageInitialized = vi.fn();
export const mockInitializeFileStorage = vi.fn();
vi.mock('@/storage/opfs', () => ({
  getFileStorage: () => ({
    retrieve: mockRetrieve,
    measureRetrieve: mockRetrieve,
    store: mockStore
  }),
  isFileStorageInitialized: () => mockIsFileStorageInitialized(),
  initializeFileStorage: (key: Uint8Array, instanceId: string) =>
    mockInitializeFileStorage(key, instanceId),
  createRetrieveLogger: () => vi.fn()
}));

// Mock file-utils
export const mockDownloadFile = vi.fn();
vi.mock('@/lib/fileUtils', () => ({
  downloadFile: (data: Uint8Array, filename: string) =>
    mockDownloadFile(data, filename),
  computeContentHash: vi.fn().mockResolvedValue('mock-hash'),
  readFileAsUint8Array: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
}));

// Mock useFileUpload hook
export const mockUploadFile = vi.fn();
vi.mock('@/hooks/vfs', () => ({
  useFileUpload: () => ({
    uploadFile: mockUploadFile
  })
}));

// Mock useAudio hook
export const mockPlay = vi.fn();
export const mockPause = vi.fn();
export const mockResume = vi.fn();
export const mockCurrentTrack = { current: null as { id: string } | null };
export const mockIsPlaying = { current: false };
vi.mock('@/audio', () => ({
  useAudio: () => ({
    currentTrack: mockCurrentTrack.current,
    isPlaying: mockIsPlaying.current,
    play: mockPlay,
    pause: mockPause,
    resume: mockResume
  })
}));

// Mock data-retrieval
export const mockRetrieveFileData = vi.fn();
vi.mock('@/lib/dataRetrieval', () => ({
  retrieveFileData: (storagePath: string, instanceId: string) =>
    mockRetrieveFileData(storagePath, instanceId)
}));

// Mock useOnInstanceChange
vi.mock('@/hooks/app/useInstanceChange', () => ({
  useOnInstanceChange: vi.fn()
}));

// Test data
export const TEST_FILE_WITH_THUMBNAIL = {
  id: 'file-1',
  name: 'photo.jpg',
  size: 1024,
  mimeType: 'image/jpeg',
  uploadDate: new Date('2024-01-15'),
  storagePath: '/files/photo.jpg',
  thumbnailPath: '/files/photo-thumb.jpg',
  deleted: false
};

export const TEST_FILE_WITHOUT_THUMBNAIL = {
  id: 'file-2',
  name: 'document.pdf',
  size: 2048,
  mimeType: 'application/pdf',
  uploadDate: new Date('2024-01-14'),
  storagePath: '/files/document.pdf',
  thumbnailPath: null,
  deleted: false
};

export const TEST_DELETED_FILE = {
  id: 'file-3',
  name: 'deleted.jpg',
  size: 512,
  mimeType: 'image/jpeg',
  uploadDate: new Date('2024-01-13'),
  storagePath: '/files/deleted.jpg',
  thumbnailPath: '/files/deleted-thumb.jpg',
  deleted: true
};

export const TEST_VIDEO_FILE = {
  id: 'file-4',
  name: 'clip.mp4',
  size: 4096,
  mimeType: 'video/mp4',
  uploadDate: new Date('2024-01-12'),
  storagePath: '/files/clip.mp4',
  thumbnailPath: null,
  deleted: false
};

export const TEST_AUDIO_FILE = {
  id: 'audio-1',
  name: 'song.mp3',
  size: 5000,
  mimeType: 'audio/mpeg',
  uploadDate: new Date('2024-01-16'),
  storagePath: '/files/song.mp3',
  thumbnailPath: null,
  deleted: false
};

export const TEST_DELETED_AUDIO_FILE = {
  id: 'audio-2',
  name: 'deleted-song.mp3',
  size: 3000,
  mimeType: 'audio/mpeg',
  uploadDate: new Date('2024-01-15'),
  storagePath: '/files/deleted-song.mp3',
  thumbnailPath: null,
  deleted: true
};

export const TEST_THUMBNAIL_DATA = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG header bytes
export const TEST_ENCRYPTION_KEY = new Uint8Array([1, 2, 3, 4]);

export function createMockQueryChain(result: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      orderBy: vi.fn().mockResolvedValue(result)
    })
  };
}

export function createMockUpdateChain() {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined)
    })
  };
}

export function resetObjectUrlCounter() {
  // no-op: counter was removed with setupDefaultMocks
}

export function renderFilesRaw() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <Files />
      </ThemeProvider>
    </MemoryRouter>
  );
}

export async function renderFiles() {
  const result = renderFilesRaw();
  // Wait for initial async effects to complete
  await waitFor(() => {
    expect(screen.queryByText('Loading files...')).not.toBeInTheDocument();
  });
  return result;
}
