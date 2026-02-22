/**
 * Shared test setup for Documents component tests.
 *
 * IMPORTANT: vi.mock() calls MUST be inline in each test file - they cannot
 * be imported. This file exports mock variables and test data that the
 * individual test files import and use in their own vi.mock() calls.
 */
import { act, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { Documents } from './Documents';

// Navigation mock
export const mockNavigate = vi.fn();

// Database context mock
export const mockUseDatabaseContext = vi.fn();

// Database mocks
export const mockUpdate = vi.fn();
export const mockSet = vi.fn();
export const mockUpdateWhere = vi.fn();
export const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn(),
  update: mockUpdate
};

// Storage mocks
export const mockStorage = {
  retrieve: vi.fn(),
  measureRetrieve: vi.fn()
};

export const mockIsFileStorageInitialized = vi.fn(() => true);
export const mockInitializeFileStorage = vi.fn();

// File upload mock
export const mockUploadFile = vi.fn();

// File utilities mocks
export const mockCanShareFiles = vi.fn(() => false);
export const mockDownloadFile = vi.fn();
export const mockShareFile = vi.fn();

// LLM runtime mock
const mockSetAttachedImage = vi.fn();

// Chat attachments mock
const mockObjectUrlToDataUrl = vi.fn();

// Test data
export const mockDocuments = [
  {
    id: 'doc-1',
    name: 'test-document.pdf',
    size: 1024,
    mimeType: 'application/pdf',
    uploadDate: new Date('2025-01-01'),
    storagePath: '/documents/test-document.pdf'
  },
  {
    id: 'doc-2',
    name: 'another-document.pdf',
    size: 2048,
    mimeType: 'application/pdf',
    uploadDate: new Date('2025-01-02'),
    storagePath: '/documents/another-document.pdf'
  }
];

/**
 * Renders the Documents component wrapped in MemoryRouter.
 * Flushes the setTimeout(fn, 0) used for instance-aware fetching.
 */
export async function renderDocuments(
  props: Partial<ComponentProps<typeof Documents>> = {}
) {
  const result = render(
    <MemoryRouter>
      <Documents {...props} />
    </MemoryRouter>
  );
  // Flush the setTimeout(fn, 0) used for instance-aware fetching
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return result;
}

/**
 * Re-exports for convenience
 */
export { screen };

/**
 * Sets up the default mock states for tests.
 * Call this in beforeEach() after vi.clearAllMocks().
 */
export function setupDefaultMocks() {
  mockUseDatabaseContext.mockReturnValue({
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: 'test-instance'
  });

  mockDb.orderBy.mockResolvedValue(mockDocuments);
  mockStorage.measureRetrieve.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mockIsFileStorageInitialized.mockReturnValue(true);
  mockInitializeFileStorage.mockResolvedValue(undefined);
  mockCanShareFiles.mockReturnValue(false);
  mockDownloadFile.mockReturnValue(undefined);
  mockShareFile.mockResolvedValue(undefined);
  mockSetAttachedImage.mockReset();
  mockObjectUrlToDataUrl.mockResolvedValue('data:image/jpeg;base64,thumb');
  mockUploadFile.mockResolvedValue(undefined);

  // Reset update chain mocks
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdateWhere.mockResolvedValue(undefined);
}
