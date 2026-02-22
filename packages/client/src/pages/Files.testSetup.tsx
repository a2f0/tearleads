import { ThemeProvider } from '@tearleads/ui';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, vi } from 'vitest';
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
    expect(screen.queryByText('Loading files...')).toBeNull();
  });
  return result;
}
