import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsupportedFileTypeError } from '@/lib/errors';
import { useFileUpload } from './useFileUpload';

// Mock file-type
vi.mock('file-type', () => ({
  fileTypeFromBuffer: vi.fn()
}));

// Mock database adapter
vi.mock('@/db', () => ({
  getDatabaseAdapter: vi.fn()
}));

// Mock key manager
vi.mock('@/db/crypto', () => ({
  getKeyManager: vi.fn()
}));

// Mock file utils
vi.mock('@/lib/file-utils', () => ({
  readFileAsUint8Array: vi.fn(),
  computeContentHash: vi.fn()
}));

// Mock OPFS storage
vi.mock('@/storage/opfs', () => ({
  getFileStorage: vi.fn(),
  initializeFileStorage: vi.fn(),
  isFileStorageInitialized: vi.fn()
}));

import { fileTypeFromBuffer } from 'file-type';
import { getDatabaseAdapter } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { computeContentHash, readFileAsUint8Array } from '@/lib/file-utils';
import { getFileStorage, isFileStorageInitialized } from '@/storage/opfs';

describe('useFileUpload', () => {
  const mockEncryptionKey = new Uint8Array(32);
  const mockAdapter = {
    execute: vi.fn()
  };
  const mockStorage = {
    store: vi.fn()
  };

  beforeEach(() => {
    vi.resetAllMocks();

    // Default mocks for successful upload
    vi.mocked(getKeyManager).mockReturnValue({
      getCurrentKey: () => mockEncryptionKey
    } as ReturnType<typeof getKeyManager>);
    vi.mocked(isFileStorageInitialized).mockReturnValue(true);
    vi.mocked(getDatabaseAdapter).mockReturnValue(
      mockAdapter as unknown as ReturnType<typeof getDatabaseAdapter>
    );
    vi.mocked(getFileStorage).mockReturnValue(
      mockStorage as unknown as ReturnType<typeof getFileStorage>
    );
    vi.mocked(readFileAsUint8Array).mockResolvedValue(
      new Uint8Array([1, 2, 3])
    );
    vi.mocked(computeContentHash).mockResolvedValue('mock-hash');
    vi.mocked(mockAdapter.execute).mockResolvedValue({ rows: [] });
    vi.mocked(mockStorage.store).mockResolvedValue('storage/path');

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
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO files'),
        expect.arrayContaining(['image/png'])
      );
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
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO files'),
        expect.arrayContaining(['image/jpeg'])
      );
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
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO files'),
        expect.arrayContaining(['application/pdf'])
      );
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

      // Should use detected MIME type, not browser-provided
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO files'),
        expect.arrayContaining(['image/png'])
      );
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
  });

  describe('deduplication', () => {
    it('returns existing file ID for duplicate content', async () => {
      vi.mocked(fileTypeFromBuffer).mockResolvedValue({
        ext: 'png',
        mime: 'image/png'
      });
      vi.mocked(mockAdapter.execute).mockResolvedValue({
        rows: [{ id: 'existing-file-id' }]
      });

      const { result } = renderHook(() => useFileUpload());
      const file = new File(['duplicate-content'], 'copy.png', {
        type: 'image/png'
      });

      const uploadResult = await result.current.uploadFile(file);

      expect(uploadResult.id).toBe('existing-file-id');
      expect(uploadResult.isDuplicate).toBe(true);
      // Should not call storage.store for duplicates
      expect(mockStorage.store).not.toHaveBeenCalled();
    });
  });

  describe('progress callback', () => {
    it('calls progress callback at expected stages', async () => {
      vi.mocked(fileTypeFromBuffer).mockResolvedValue({
        ext: 'png',
        mime: 'image/png'
      });

      const onProgress = vi.fn();
      const { result } = renderHook(() => useFileUpload());
      const file = new File(['test'], 'test.png', { type: 'image/png' });

      await result.current.uploadFile(file, onProgress);

      expect(onProgress).toHaveBeenCalledWith(20); // After reading file
      expect(onProgress).toHaveBeenCalledWith(40); // After computing hash
      expect(onProgress).toHaveBeenCalledWith(60); // After generating ID
      expect(onProgress).toHaveBeenCalledWith(80); // After storing file
      expect(onProgress).toHaveBeenCalledWith(100); // Complete
    });
  });
});
