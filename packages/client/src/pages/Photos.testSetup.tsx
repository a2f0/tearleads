/**
 * Shared mock variables and test data for Photos tests.
 *
 * IMPORTANT: vi.mock() calls must remain inline in each test file.
 * This file only exports mock functions and test data that can be
 * referenced by those inline vi.mock() calls.
 */
import { act, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { Photos, PhotosPage } from './Photos';

// ============================================================
// Mock Functions
// ============================================================

export const mockNavigate = vi.fn();

export const mockUseDatabaseContext = vi.fn();

export const mockUpdate = vi.fn();
export const mockInsert = vi.fn();
export const mockInsertValues = vi.fn();
export const mockSet = vi.fn();
export const mockUpdateWhere = vi.fn();

export const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn(),
  update: mockUpdate,
  insert: mockInsert
};

// Make mockDb thenable for promise resolution
Object.defineProperty(mockDb, 'then', {
  value: (resolve: (value: unknown[]) => void) => resolve([]),
  enumerable: false
});

// Chain the update mock
mockUpdate.mockReturnValue({ set: mockSet });
mockSet.mockReturnValue({ where: mockUpdateWhere });
mockInsert.mockReturnValue({ values: mockInsertValues });

export const mockStorage = {
  retrieve: vi.fn()
};

export const mockIsFileStorageInitialized = vi.fn(() => true);
export const mockInitializeFileStorage = vi.fn();
export const mockUploadFile = vi.fn();
export const mockCanShareFiles = vi.fn(() => false);
export const mockDownloadFile = vi.fn();
export const mockShareFile = vi.fn();
export const mockSetAttachedImage = vi.fn();
export const mockUint8ArrayToDataUrl = vi.fn();

// ============================================================
// Test Data
// ============================================================

export const mockPhotos = [
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

// ============================================================
// Setup Helpers
// ============================================================

/**
 * Standard beforeEach setup for Photos tests.
 * Call this in each test file's beforeEach block.
 */
export function setupPhotosTestMocks() {
  vi.clearAllMocks();

  mockUseDatabaseContext.mockReturnValue({
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: 'test-instance'
  });

  // Mock database query
  mockDb.orderBy.mockResolvedValue(mockPhotos);

  // Mock file storage
  mockStorage.retrieve.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mockIsFileStorageInitialized.mockReturnValue(true);
  mockInitializeFileStorage.mockResolvedValue(undefined);

  // Mock file utils
  mockCanShareFiles.mockReturnValue(false);
  mockDownloadFile.mockReturnValue(undefined);
  mockShareFile.mockResolvedValue(undefined);
  mockSetAttachedImage.mockReset();
  mockUint8ArrayToDataUrl.mockResolvedValue(
    'data:image/jpeg;base64,test-image'
  );
  mockUploadFile.mockResolvedValue(undefined);

  // Mock URL.createObjectURL
  global.URL.createObjectURL = vi.fn(() => 'blob:test-url');
  global.URL.revokeObjectURL = vi.fn();

  // Reset update chain mocks
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdateWhere.mockResolvedValue(undefined);
  mockInsertValues.mockResolvedValue(undefined);
}

// ============================================================
// Render Helpers
// ============================================================

export async function renderPhotos(
  props: Partial<ComponentProps<typeof Photos>> = {}
) {
  const result = render(
    <MemoryRouter>
      <Photos {...props} />
    </MemoryRouter>
  );
  // Flush the setTimeout(fn, 0) used for instance-aware fetching
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return result;
}

export function renderPhotosPage(route = '/photos') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/photos" element={<PhotosPage />} />
        <Route path="/photos/albums/:albumId" element={<PhotosPage />} />
      </Routes>
    </MemoryRouter>
  );
}
