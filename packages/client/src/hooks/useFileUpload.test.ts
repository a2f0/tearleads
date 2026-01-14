import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsupportedFileTypeError } from '@/lib/errors';
import { mockConsoleWarn } from '@/test/console-mocks';
import { useFileUpload } from './useFileUpload';

// Mock file-type
vi.mock('file-type', () => ({
  fileTypeFromBuffer: vi.fn()
}));

// Mock database - using Drizzle-style query builder
vi.mock('@/db', () => ({
  getDatabase: vi.fn()
}));

// Mock key manager
vi.mock('@/db/crypto', () => ({
  getKeyManager: vi.fn(),
  getCurrentInstanceId: vi.fn(() => 'test-instance')
}));

// Mock file utils
vi.mock('@/lib/file-utils', () => ({
  readFileAsUint8Array: vi.fn(),
  computeContentHash: vi.fn()
}));

// Mock thumbnail
vi.mock('@/lib/thumbnail', () => ({
  generateThumbnail: vi.fn(),
  isThumbnailSupported: vi.fn()
}));

// Mock analytics
vi.mock('@/db/analytics', () => ({
  logEvent: vi.fn()
}));

// Mock OPFS storage
vi.mock('@/storage/opfs', () => ({
  getFileStorage: vi.fn(),
  initializeFileStorage: vi.fn(),
  isFileStorageInitialized: vi.fn(),
  createStoreLogger: vi.fn(() => vi.fn())
}));

import { fileTypeFromBuffer } from 'file-type';
import { getDatabase } from '@/db';
import { logEvent } from '@/db/analytics';
import { getKeyManager } from '@/db/crypto';
import { computeContentHash, readFileAsUint8Array } from '@/lib/file-utils';
import { generateThumbnail, isThumbnailSupported } from '@/lib/thumbnail';
import { getFileStorage, isFileStorageInitialized } from '@/storage/opfs';

describe('useFileUpload', () => {
  const mockEncryptionKey = new Uint8Array(32);
  const mockStorage = {
    store: vi.fn(),
    measureStore: vi.fn()
  };

  // Drizzle-style mock database with chainable methods
  const createMockSelectQuery = (result: unknown[]) => {
    const query = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(result)
    };
    return query;
  };

  const createMockInsertQuery = () => {
    const query = {
      values: vi.fn().mockResolvedValue(undefined)
    };
    return query;
  };

  let mockSelectResult: unknown[] = [];

  const mockDb = {
    select: vi.fn(() => createMockSelectQuery(mockSelectResult)),
    insert: vi.fn(() => createMockInsertQuery())
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockSelectResult = [];

    // Default mocks for successful upload
    vi.mocked(getKeyManager).mockReturnValue({
      getCurrentKey: () => mockEncryptionKey
    } as ReturnType<typeof getKeyManager>);
    vi.mocked(isFileStorageInitialized).mockReturnValue(true);
    vi.mocked(getDatabase).mockReturnValue(
      mockDb as unknown as ReturnType<typeof getDatabase>
    );
    vi.mocked(getFileStorage).mockReturnValue(
      mockStorage as unknown as ReturnType<typeof getFileStorage>
    );
    vi.mocked(readFileAsUint8Array).mockResolvedValue(
      new Uint8Array([1, 2, 3])
    );
    vi.mocked(computeContentHash).mockResolvedValue('mock-hash');
    vi.mocked(mockStorage.measureStore).mockResolvedValue('storage/path');
    vi.mocked(mockStorage.measureStore).mockResolvedValue('storage/path');
    vi.mocked(isThumbnailSupported).mockReturnValue(false);
    vi.mocked(generateThumbnail).mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(logEvent).mockResolvedValue(undefined);

    // Mock crypto.randomUUID
    vi.stubGlobal('crypto', {
      randomUUID: () => 'test-uuid-1234'
    });
  });

  describe('file type detection', () => {
    it('throws UnsupportedFileTypeError when file type cannot be detected', async () => {
      vi.mocked(fileTypeFromBuffer).mockResolvedValue(undefined);

      const { result } = renderHook(() => useFileUpload());
      const file = new File(['test'], 'document.txt', { type: 'text/plain' });

      await expect(result.current.uploadFile(file)).rejects.toThrow(
        UnsupportedFileTypeError
      );
      await expect(result.current.uploadFile(file)).rejects.toThrow(
        'Unable to detect file type for "document.txt"'
      );
    });

    it('successfully uploads when file type is detected as PNG', async () => {
      vi.mocked(fileTypeFromBuffer).mockResolvedValue({
        ext: 'png',
        mime: 'image/png'
      });

      const { result } = renderHook(() => useFileUpload());
      const file = new File(['fake-png-data'], 'image.png', {
        type: 'image/png'
      });

      const uploadResult = await result.current.uploadFile(file);

      expect(uploadResult.id).toBe('test-uuid-1234');
      expect(uploadResult.isDuplicate).toBe(false);
      // Verify insert was called (Drizzle-style)
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('successfully uploads when file type is detected as JPEG', async () => {
      vi.mocked(fileTypeFromBuffer).mockResolvedValue({
        ext: 'jpg',
        mime: 'image/jpeg'
      });

      const { result } = renderHook(() => useFileUpload());
      const file = new File(['fake-jpeg-data'], 'photo.jpg', {
        type: 'image/jpeg'
      });

      const uploadResult = await result.current.uploadFile(file);

      expect(uploadResult.isDuplicate).toBe(false);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('successfully uploads when file type is detected as PDF', async () => {
      vi.mocked(fileTypeFromBuffer).mockResolvedValue({
        ext: 'pdf',
        mime: 'application/pdf'
      });

      const { result } = renderHook(() => useFileUpload());
      const file = new File(['fake-pdf-data'], 'document.pdf', {
        type: 'application/pdf'
      });

      const uploadResult = await result.current.uploadFile(file);

      expect(uploadResult.isDuplicate).toBe(false);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('uses detected MIME type instead of browser-provided type', async () => {
      // Browser says text/plain, but magic bytes say it's actually a PNG
      vi.mocked(fileTypeFromBuffer).mockResolvedValue({
        ext: 'png',
        mime: 'image/png'
      });

      const { result } = renderHook(() => useFileUpload());
      const file = new File(['fake-png-data'], 'suspicious.txt', {
        type: 'text/plain'
      });

      await result.current.uploadFile(file);

      // Should insert file (Drizzle-style)
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it.each([
      {
        type: 'HEIC',
        mime: 'image/heic',
        data: 'fake-heic-data',
        name: 'IMG_1234.HEIC'
      },
      {
        type: 'HEIF',
        mime: 'image/heif',
        data: 'fake-heif-data',
        name: 'photo.heif'
      }
    ])('successfully uploads when file type is detected as $type (iOS photo format)', async ({
      type,
      mime,
      data,
      name
    }) => {
      vi.mocked(fileTypeFromBuffer).mockResolvedValue({
        ext: type.toLowerCase(),
        mime: mime
      });
      // HEIC/HEIF thumbnails are not supported
      vi.mocked(isThumbnailSupported).mockReturnValue(false);

      const { result } = renderHook(() => useFileUpload());
      const file = new File([data], name, { type: mime });

      const uploadResult = await result.current.uploadFile(file);

      expect(uploadResult.isDuplicate).toBe(false);
      expect(mockDb.insert).toHaveBeenCalled();
      // Should store original but no thumbnail
      expect(mockStorage.measureStore).toHaveBeenCalledTimes(1);
      expect(generateThumbnail).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('throws error when database is not unlocked', async () => {
      vi.mocked(getKeyManager).mockReturnValue({
        getCurrentKey: () => null
      } as unknown as ReturnType<typeof getKeyManager>);

      const { result } = renderHook(() => useFileUpload());
      const file = new File(['test'], 'test.png');

      await expect(result.current.uploadFile(file)).rejects.toThrow(
        'Database not unlocked'
      );
    });

    it('throws error when file read fails', async () => {
      vi.mocked(readFileAsUint8Array).mockRejectedValue(
        new Error('Failed to read file')
      );

      const { result } = renderHook(() => useFileUpload());
      const file = new File(['test'], 'test.png', { type: 'image/png' });

      await expect(result.current.uploadFile(file)).rejects.toThrow(
        'Failed to read file'
      );
    });

    it('throws error when storage fails', async () => {
      vi.mocked(fileTypeFromBuffer).mockResolvedValue({
        ext: 'png',
        mime: 'image/png'
      });
      vi.mocked(mockStorage.measureStore).mockRejectedValue(
        new Error('Storage quota exceeded')
      );

      const { result } = renderHook(() => useFileUpload());
      const file = new File(['test'], 'test.png', { type: 'image/png' });

      await expect(result.current.uploadFile(file)).rejects.toThrow(
        'Storage quota exceeded'
      );
    });

    it('throws UnsupportedFileTypeError with descriptive message', async () => {
      vi.mocked(fileTypeFromBuffer).mockResolvedValue(undefined);

      const { result } = renderHook(() => useFileUpload());
      const file = new File(['unknown data'], 'mystery_file.xyz', {
        type: 'application/octet-stream'
      });

      await expect(result.current.uploadFile(file)).rejects.toThrow(
        'Unable to detect file type for "mystery_file.xyz". Only files with recognizable formats are supported.'
      );
    });

    it('throws UnsupportedFileTypeError for files with no magic bytes', async () => {
      vi.mocked(fileTypeFromBuffer).mockResolvedValue(undefined);

      const { result } = renderHook(() => useFileUpload());
      // Plain text files have no magic bytes
      const file = new File(['Hello, world!'], 'notes.txt', {
        type: 'text/plain'
      });

      await expect(result.current.uploadFile(file)).rejects.toBeInstanceOf(
        UnsupportedFileTypeError
      );
    });
  });

  describe('deduplication', () => {
    it('returns existing file ID for duplicate content', async () => {
      vi.mocked(fileTypeFromBuffer).mockResolvedValue({
        ext: 'png',
        mime: 'image/png'
      });
      // Mock select to return existing file (Drizzle-style)
      mockDb.select.mockImplementationOnce(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ id: 'existing-file-id' }])
      }));

      const { result } = renderHook(() => useFileUpload());
      const file = new File(['duplicate-content'], 'copy.png', {
        type: 'image/png'
      });

      const uploadResult = await result.current.uploadFile(file);

      expect(uploadResult.id).toBe('existing-file-id');
      expect(uploadResult.isDuplicate).toBe(true);
      // Should not call storage.store for duplicates
      expect(mockStorage.measureStore).not.toHaveBeenCalled();
    });
  });

  describe('progress callback', () => {
    it('calls progress callback at expected stages for non-image files', async () => {
      vi.mocked(fileTypeFromBuffer).mockResolvedValue({
        ext: 'pdf',
        mime: 'application/pdf'
      });
      vi.mocked(isThumbnailSupported).mockReturnValue(false);

      const onProgress = vi.fn();
      const { result } = renderHook(() => useFileUpload());
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      await result.current.uploadFile(file, onProgress);

      expect(onProgress).toHaveBeenCalledWith(20); // After reading file
      expect(onProgress).toHaveBeenCalledWith(40); // After computing hash
      expect(onProgress).toHaveBeenCalledWith(50); // After generating ID
      expect(onProgress).toHaveBeenCalledWith(65); // After storing file
      expect(onProgress).toHaveBeenCalledWith(85); // After thumbnail step (skipped)
      expect(onProgress).toHaveBeenCalledWith(100); // Complete
    });

    it('calls progress callback at expected stages for image files with thumbnail', async () => {
      vi.mocked(fileTypeFromBuffer).mockResolvedValue({
        ext: 'png',
        mime: 'image/png'
      });
      vi.mocked(isThumbnailSupported).mockReturnValue(true);

      const onProgress = vi.fn();
      const { result } = renderHook(() => useFileUpload());
      const file = new File(['test'], 'test.png', { type: 'image/png' });

      await result.current.uploadFile(file, onProgress);

      expect(onProgress).toHaveBeenCalledWith(20); // After reading file
      expect(onProgress).toHaveBeenCalledWith(40); // After computing hash
      expect(onProgress).toHaveBeenCalledWith(50); // After generating ID
      expect(onProgress).toHaveBeenCalledWith(65); // After storing file
      expect(onProgress).toHaveBeenCalledWith(85); // After thumbnail generation
      expect(onProgress).toHaveBeenCalledWith(100); // Complete
    });
  });

  describe('thumbnail generation', () => {
    it('generates thumbnail for supported image types', async () => {
      vi.mocked(fileTypeFromBuffer).mockResolvedValue({
        ext: 'png',
        mime: 'image/png'
      });
      vi.mocked(isThumbnailSupported).mockReturnValue(true);
      vi.mocked(generateThumbnail).mockResolvedValue(new Uint8Array([4, 5, 6]));

      const { result } = renderHook(() => useFileUpload());
      const file = new File(['test'], 'test.png', { type: 'image/png' });

      await result.current.uploadFile(file);

      expect(generateThumbnail).toHaveBeenCalledWith(
        new Uint8Array([1, 2, 3]),
        'image/png'
      );
      // Should store original with measureStore and thumbnail with store
      expect(mockStorage.measureStore).toHaveBeenCalledTimes(1);
      expect(mockStorage.store).toHaveBeenCalledTimes(1);
      expect(mockStorage.store).toHaveBeenCalledWith(
        'test-uuid-1234-thumb',
        new Uint8Array([4, 5, 6])
      );
    });

    it('does not generate thumbnail for unsupported types', async () => {
      vi.mocked(fileTypeFromBuffer).mockResolvedValue({
        ext: 'pdf',
        mime: 'application/pdf'
      });
      vi.mocked(isThumbnailSupported).mockReturnValue(false);

      const { result } = renderHook(() => useFileUpload());
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      await result.current.uploadFile(file);

      expect(generateThumbnail).not.toHaveBeenCalled();
      // Should only store original
      expect(mockStorage.measureStore).toHaveBeenCalledTimes(1);
    });

    it('continues upload when thumbnail generation fails', async () => {
      const consoleSpy = mockConsoleWarn();
      vi.mocked(fileTypeFromBuffer).mockResolvedValue({
        ext: 'png',
        mime: 'image/png'
      });
      vi.mocked(isThumbnailSupported).mockReturnValue(true);
      vi.mocked(generateThumbnail).mockRejectedValue(
        new Error('Thumbnail failed')
      );

      const { result } = renderHook(() => useFileUpload());
      const file = new File(['test'], 'test.png', { type: 'image/png' });

      const uploadResult = await result.current.uploadFile(file);

      expect(uploadResult.id).toBe('test-uuid-1234');
      expect(uploadResult.isDuplicate).toBe(false);
      // Should only store original (thumbnail failed)
      expect(mockStorage.measureStore).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to generate thumbnail for test.png:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('logs analytics event for thumbnail generation', async () => {
      vi.mocked(fileTypeFromBuffer).mockResolvedValue({
        ext: 'png',
        mime: 'image/png'
      });
      vi.mocked(isThumbnailSupported).mockReturnValue(true);

      const { result } = renderHook(() => useFileUpload());
      const file = new File(['test'], 'test.png', { type: 'image/png' });

      await result.current.uploadFile(file);

      expect(logEvent).toHaveBeenCalledWith(
        expect.anything(),
        'thumbnail_generation',
        expect.any(Number),
        true
      );
    });

    it('logs failed analytics event when thumbnail generation fails', async () => {
      const consoleSpy = mockConsoleWarn();
      vi.mocked(fileTypeFromBuffer).mockResolvedValue({
        ext: 'png',
        mime: 'image/png'
      });
      vi.mocked(isThumbnailSupported).mockReturnValue(true);
      vi.mocked(generateThumbnail).mockRejectedValue(
        new Error('Thumbnail failed')
      );

      const { result } = renderHook(() => useFileUpload());
      const file = new File(['test'], 'test.png', { type: 'image/png' });

      await result.current.uploadFile(file);

      expect(logEvent).toHaveBeenCalledWith(
        expect.anything(),
        'thumbnail_generation',
        expect.any(Number),
        false
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to generate thumbnail for test.png:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });
});
