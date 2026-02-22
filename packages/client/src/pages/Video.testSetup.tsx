/**
 * Shared test setup for Video page tests.
 * This file exports mock functions and test data used across split test files.
 *
 * IMPORTANT: vi.mock() calls MUST stay inline in each test file.
 * Each test file should use vi.hoisted() to create its own mock references
 * that can be used in vi.mock() calls.
 */
import { vi } from 'vitest';

// ============================================================================
// Test Data
// ============================================================================

export const TEST_VIDEO = {
  id: 'video-1',
  name: 'test-video.mp4',
  size: 52428800, // 50 MB
  mimeType: 'video/mp4',
  uploadDate: new Date('2024-01-15'),
  storagePath: '/videos/test-video.mp4',
  thumbnailPath: '/thumbnails/test-video.jpg'
};

export const TEST_VIDEO_2 = {
  id: 'video-2',
  name: 'another-video.webm',
  size: 104857600, // 100 MB
  mimeType: 'video/webm',
  uploadDate: new Date('2024-01-14'),
  storagePath: '/videos/another-video.webm',
  thumbnailPath: '/thumbnails/another-video.jpg'
};

const TEST_VIDEO_DATA = new Uint8Array([
  0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70
]); // MP4 magic bytes

export const TEST_ENCRYPTION_KEY = new Uint8Array([1, 2, 3, 4]);

// ============================================================================
// Helper Functions
// ============================================================================

export function createMockQueryChain(result: unknown[]) {
  const whereResult = {
    orderBy: vi.fn().mockResolvedValue(result)
  };
  Object.defineProperty(whereResult, 'then', {
    value: (resolve: (value: unknown[]) => void) => resolve([]),
    enumerable: false
  });
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue(whereResult)
    })
  };
}

function createMockUpdateChain() {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined)
    })
  };
}

// ============================================================================
// Mock Setup Factory
// ============================================================================

/**
 * Creates all mock functions needed for Video tests.
 * Each test file should call this in vi.hoisted() to get properly scoped mocks.
 */
function createVideoMocks() {
  return {
    // Database context mock
    mockUseDatabaseContext: vi.fn(),

    // Database operation mocks
    mockSelect: vi.fn(),
    mockUpdate: vi.fn(),
    mockInsertValues: vi.fn(),
    mockInsert: vi.fn(),

    // Navigation mock
    mockNavigate: vi.fn(),

    // Key manager mock
    mockGetCurrentKey: vi.fn(),

    // File storage mocks
    mockRetrieve: vi.fn(),
    mockStore: vi.fn(),
    mockIsFileStorageInitialized: vi.fn(),
    mockInitializeFileStorage: vi.fn(),

    // File upload mock
    mockUploadFile: vi.fn(),

    // Platform detection mock
    mockDetectPlatform: vi.fn()
  };
}

type VideoMocks = ReturnType<typeof createVideoMocks>;

// ============================================================================
// Common beforeEach Setup
// ============================================================================

export function setupVideoPageMocks(mocks: VideoMocks) {
  // Mock URL methods
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test-url');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

  // Wire up mockInsert to return mockInsertValues
  mocks.mockInsert.mockReturnValue({ values: mocks.mockInsertValues });

  // Default mocks for unlocked database
  mocks.mockUseDatabaseContext.mockReturnValue({
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: 'test-instance'
  });
  mocks.mockGetCurrentKey.mockReturnValue(TEST_ENCRYPTION_KEY);
  mocks.mockIsFileStorageInitialized.mockReturnValue(true);
  mocks.mockRetrieve.mockResolvedValue(TEST_VIDEO_DATA);
  mocks.mockSelect.mockReturnValue(createMockQueryChain([TEST_VIDEO]));
  mocks.mockUpdate.mockReturnValue(createMockUpdateChain());
  mocks.mockInsertValues.mockResolvedValue(undefined);
  mocks.mockUploadFile.mockResolvedValue({ id: 'new-id', isDuplicate: false });
  mocks.mockDetectPlatform.mockReturnValue('web');
}

export function setupVideoWrapperMocks(mocks: VideoMocks) {
  // Mock URL methods
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test-url');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

  // Wire up mockInsert to return mockInsertValues
  mocks.mockInsert.mockReturnValue({ values: mocks.mockInsertValues });

  // Default mocks
  mocks.mockGetCurrentKey.mockReturnValue(new Uint8Array([1, 2, 3, 4]));
  mocks.mockIsFileStorageInitialized.mockReturnValue(true);
  mocks.mockRetrieve.mockResolvedValue(new Uint8Array([0x00]));
  const whereResult = {
    orderBy: vi.fn().mockResolvedValue([])
  };
  Object.defineProperty(whereResult, 'then', {
    value: (resolve: (value: unknown[]) => void) => resolve([]),
    enumerable: false
  });
  mocks.mockSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue(whereResult)
    })
  });
  mocks.mockDetectPlatform.mockReturnValue('web');
}
