import { vi } from 'vitest';

// Each test file defines its mock functions at module scope.
// This setup file only provides the setupMocks helper and createDefaultProps.

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
