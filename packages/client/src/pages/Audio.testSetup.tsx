/**
 * Shared test setup for Audio page tests.
 *
 * IMPORTANT: vi.mock() calls MUST be inline in each test file - they cannot
 * be imported. This file exports mock variables and test data that the
 * individual test files import and reference in their own vi.mock() calls.
 */
import { vi } from 'vitest';

// ============================================================================
// Mock Functions - Export these so test files can reference them in vi.mock()
// ============================================================================

// Audio context mocks
export const mockPlay = vi.fn();
export const mockPause = vi.fn();
export const mockResume = vi.fn();
export const mockUseAudio = vi.fn();

// Database context mocks
export const mockUseDatabaseContext = vi.fn();

// Database mocks
export const mockSelect = vi.fn();
export const mockUpdate = vi.fn();
export const mockInsertValues = vi.fn();
export const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

// Navigation mocks
export const mockNavigate = vi.fn();

// Key manager mocks
export const mockGetCurrentKey = vi.fn();

// File storage mocks
export const mockRetrieve = vi.fn();
export const mockStore = vi.fn();
export const mockIsFileStorageInitialized = vi.fn();
export const mockInitializeFileStorage = vi.fn();

// File upload mocks
export const mockUploadFile = vi.fn();

// ============================================================================
// Test Data Constants
// ============================================================================

export const TEST_AUDIO_TRACK = {
  id: 'track-1',
  name: 'test-song.mp3',
  size: 5242880, // 5 MB
  mimeType: 'audio/mpeg',
  uploadDate: new Date('2024-01-15'),
  storagePath: '/music/test-song.mp3'
};

export const TEST_AUDIO_TRACK_2 = {
  id: 'track-2',
  name: 'another-song.wav',
  size: 10485760, // 10 MB
  mimeType: 'audio/wav',
  uploadDate: new Date('2024-01-14'),
  storagePath: '/music/another-song.wav'
};

export const TEST_AUDIO_DATA = new Uint8Array([0x49, 0x44, 0x33]); // ID3 tag bytes
export const TEST_ENCRYPTION_KEY = new Uint8Array([1, 2, 3, 4]);

// ============================================================================
// Helper Functions
// ============================================================================

export function createMockQueryChain(result: unknown[]) {
  const whereResult = {
    orderBy: vi.fn().mockResolvedValue(result)
  };
  // Make whereResult thenable for vfsLinks query pattern (no orderBy)
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

export function createMockUpdateChain() {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined)
    })
  };
}

// ============================================================================
// Common Mock Setup Helper
// ============================================================================

/**
 * Sets up default mock return values for a standard unlocked database state.
 * Call this in beforeEach() after vi.clearAllMocks().
 */
export function setupDefaultMocks() {
  // Mock URL methods
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test-url');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

  // Default mock for audio context
  mockUseAudio.mockReturnValue({
    currentTrack: null,
    isPlaying: false,
    play: mockPlay,
    pause: mockPause,
    resume: mockResume,
    audioElementRef: { current: null }
  });

  // Default mocks for unlocked database
  mockUseDatabaseContext.mockReturnValue({
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: 'test-instance'
  });
  mockGetCurrentKey.mockReturnValue(TEST_ENCRYPTION_KEY);
  mockIsFileStorageInitialized.mockReturnValue(true);
  mockRetrieve.mockResolvedValue(TEST_AUDIO_DATA);
  mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO_TRACK]));
  mockUpdate.mockReturnValue(createMockUpdateChain());
  mockInsertValues.mockResolvedValue(undefined);
  mockUploadFile.mockResolvedValue({ id: 'new-id', isDuplicate: false });
}
