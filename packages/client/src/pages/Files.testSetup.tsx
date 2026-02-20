import { ThemeProvider } from '@tearleads/ui';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { Files } from './Files';

// ============================================
// Test data - can be safely imported
// ============================================

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

// ============================================
// Utility functions
// ============================================

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

// ============================================
// Render helpers
// ============================================

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

// ============================================
// useVirtualizer mock implementation factory
// ============================================

export function createVirtualizerMockImplementation() {
  return (options: { count: number } & Record<string, unknown>) => {
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
  };
}
