import { vi } from 'vitest';

// These mock functions must be declared with vi.hoisted() in each test file
// This setup file only provides the setupMocks helper and createDefaultProps
// The factory functions are no longer used - each test file must define mocks inline

// Shared mock functions - these should be created with vi.hoisted() in test files
// Example:
// const { mockWindowOpenRequest, mockUseDatabaseContext, ... } = vi.hoisted(() => ({
//   mockWindowOpenRequest: vi.fn(),
//   mockUseDatabaseContext: vi.fn(),
//   ...
// }));

// Default props factory - safe to import as it doesn't involve vi.mock
export function createDefaultProps() {
  return {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };
}

// Setup function to reset all mocks - must be called with the mocks object
export function setupMocks(mocks: {
  mockWindowOpenRequest: ReturnType<typeof vi.fn>;
  mockUseDatabaseContext: ReturnType<typeof vi.fn>;
  mockUploadFile: ReturnType<typeof vi.fn>;
  mockAddPhotoToAlbum: ReturnType<typeof vi.fn>;
}) {
  vi.clearAllMocks();
  mocks.mockUploadFile.mockClear();
  mocks.mockUploadFile.mockResolvedValue({
    id: 'uploaded-file-id',
    isDuplicate: false
  });
  mocks.mockAddPhotoToAlbum.mockClear();
  mocks.mockAddPhotoToAlbum.mockResolvedValue(undefined);
  mocks.mockUseDatabaseContext.mockReturnValue({
    isUnlocked: true,
    isLoading: false
  });
  mocks.mockWindowOpenRequest.mockReturnValue(undefined);
}
