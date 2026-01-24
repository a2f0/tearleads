import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteIso,
  downloadIso,
  uploadIso,
  getIsoFile,
  getIsoUrl,
  getStorageUsage,
  isIsoDownloaded,
  isOpfsSupported,
  listDownloadedIsos
} from './iso-storage';
import type { IsoCatalogEntry } from './types';

describe('iso-storage', () => {
  describe('isOpfsSupported', () => {
    const originalNavigator = global.navigator;

    afterEach(() => {
      Object.defineProperty(global, 'navigator', {
        value: originalNavigator,
        writable: true
      });
    });

    it('returns true when OPFS is supported', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          storage: {
            getDirectory: vi.fn()
          }
        },
        writable: true
      });

      expect(isOpfsSupported()).toBe(true);
    });

    it('returns false when storage is not available', () => {
      Object.defineProperty(global, 'navigator', {
        value: {},
        writable: true
      });

      expect(isOpfsSupported()).toBe(false);
    });

    it('returns false when getDirectory is not available', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          storage: {}
        },
        writable: true
      });

      expect(isOpfsSupported()).toBe(false);
    });
  });

  describe('OPFS operations', () => {
    const mockEntry: IsoCatalogEntry = {
      id: 'test-iso',
      name: 'Test ISO',
      description: 'A test operating system',
      downloadUrl: 'https://example.com/test.iso',
      sizeBytes: 1024,
      bootType: 'cdrom',
      memoryMb: 256
    };

    let mockMetadataContent: string;
    let mockWritable: {
      write: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockMetadataContent = JSON.stringify({ isos: [] });

      mockWritable = {
        write: vi.fn(),
        close: vi.fn()
      };

      const mockFileHandle = {
        getFile: vi.fn().mockImplementation(() =>
          Promise.resolve({
            text: () => Promise.resolve(mockMetadataContent),
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(0))
          })
        ),
        createWritable: vi.fn().mockResolvedValue(mockWritable)
      };

      const mockDirectoryHandle = {
        getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
        removeEntry: vi.fn().mockResolvedValue(undefined)
      };

      const mockRootHandle = {
        getDirectoryHandle: vi.fn().mockResolvedValue(mockDirectoryHandle)
      };

      Object.defineProperty(global, 'navigator', {
        value: {
          storage: {
            getDirectory: vi.fn().mockResolvedValue(mockRootHandle),
            estimate: vi.fn().mockResolvedValue({
              quota: 1073741824,
              usage: 0
            })
          }
        },
        writable: true
      });

      URL.createObjectURL = vi.fn().mockReturnValue('blob:test-url');
    });

    it('listDownloadedIsos returns empty array when no ISOs', async () => {
      const result = await listDownloadedIsos();
      expect(result).toEqual([]);
    });

    it('listDownloadedIsos returns stored ISOs', async () => {
      mockMetadataContent = JSON.stringify({
        isos: [
          {
            id: 'test-iso',
            name: 'Test ISO',
            sizeBytes: 1024,
            downloadedAt: '2024-01-01'
          }
        ]
      });

      const result = await listDownloadedIsos();
      expect(result).toEqual([
        {
          id: 'test-iso',
          name: 'Test ISO',
          sizeBytes: 1024,
          downloadedAt: '2024-01-01'
        }
      ]);
    });

    it('isIsoDownloaded returns false when ISO not downloaded', async () => {
      const result = await isIsoDownloaded('non-existent');
      expect(result).toBe(false);
    });

    it('isIsoDownloaded returns true when ISO is downloaded', async () => {
      mockMetadataContent = JSON.stringify({
        isos: [{ id: 'test-iso', name: 'Test ISO', sizeBytes: 1024 }]
      });

      const result = await isIsoDownloaded('test-iso');
      expect(result).toBe(true);
    });

    it('getStorageUsage returns usage information', async () => {
      mockMetadataContent = JSON.stringify({
        isos: [{ id: 'test-iso', name: 'Test ISO', sizeBytes: 1024 }]
      });

      const result = await getStorageUsage();
      expect(result.used).toBe(1024);
      expect(result.available).toBe(1073741824);
    });

    it('getStorageUsage clamps available when quota is missing', async () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          storage: {
            getDirectory: vi.fn().mockResolvedValue({
              getDirectoryHandle: vi
                .fn()
                .mockResolvedValue({
                  getFileHandle: vi.fn().mockResolvedValue({
                    getFile: vi.fn().mockResolvedValue({
                      text: () => Promise.resolve(mockMetadataContent),
                      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0))
                    }),
                    createWritable: vi.fn().mockResolvedValue(mockWritable)
                  }),
                  removeEntry: vi.fn().mockResolvedValue(undefined)
                })
            }),
            estimate: vi.fn().mockResolvedValue({
              usage: 512
            })
          }
        },
        writable: true
      });

      const result = await getStorageUsage();
      expect(result.available).toBe(0);
    });

    it('getStorageUsage clamps available when quota is lower than usage', async () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          storage: {
            getDirectory: vi.fn().mockResolvedValue({
              getDirectoryHandle: vi
                .fn()
                .mockResolvedValue({
                  getFileHandle: vi.fn().mockResolvedValue({
                    getFile: vi.fn().mockResolvedValue({
                      text: () => Promise.resolve(mockMetadataContent),
                      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0))
                    }),
                    createWritable: vi.fn().mockResolvedValue(mockWritable)
                  }),
                  removeEntry: vi.fn().mockResolvedValue(undefined)
                })
            }),
            estimate: vi.fn().mockResolvedValue({
              quota: 256,
              usage: 512
            })
          }
        },
        writable: true
      });

      const result = await getStorageUsage();
      expect(result.available).toBe(0);
    });

    it('getIsoUrl creates object URL', async () => {
      const result = await getIsoUrl('test-iso');
      expect(result).toBe('blob:test-url');
      expect(URL.createObjectURL).toHaveBeenCalled();
    });

    it('getIsoFile returns file', async () => {
      const result = await getIsoFile('test-iso');
      expect(result).toBeDefined();
    });

    it('getIsoFile returns null when file not found', async () => {
      const mockDirectoryHandle = {
        getFileHandle: vi.fn().mockRejectedValue(new Error('File not found'))
      };

      const mockRootHandle = {
        getDirectoryHandle: vi.fn().mockResolvedValue(mockDirectoryHandle)
      };

      Object.defineProperty(global, 'navigator', {
        value: {
          storage: {
            getDirectory: vi.fn().mockResolvedValue(mockRootHandle)
          }
        },
        writable: true
      });

      const result = await getIsoFile('non-existent');
      expect(result).toBeNull();
    });

    it('deleteIso removes ISO and updates metadata', async () => {
      mockMetadataContent = JSON.stringify({
        isos: [{ id: 'test-iso', name: 'Test ISO', sizeBytes: 1024 }]
      });

      await deleteIso('test-iso');

      expect(mockWritable.write).toHaveBeenCalled();
      expect(mockWritable.close).toHaveBeenCalled();
    });

    it('downloadIso fetches and stores ISO', async () => {
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new Uint8Array([1, 2, 3, 4])
          })
          .mockResolvedValueOnce({ done: true, value: undefined })
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: vi.fn().mockReturnValue('4')
        },
        body: {
          getReader: () => mockReader
        }
      });

      const onProgress = vi.fn();
      await downloadIso(mockEntry, onProgress);

      expect(global.fetch).toHaveBeenCalledWith(mockEntry.downloadUrl);
      expect(onProgress).toHaveBeenCalled();
      expect(mockWritable.write).toHaveBeenCalled();
    });

    it('downloadIso throws on fetch error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Not Found'
      });

      await expect(downloadIso(mockEntry)).rejects.toThrow(
        'Failed to download ISO: Not Found'
      );
    });

    it('downloadIso throws when no response body', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: vi.fn().mockReturnValue(null)
        },
        body: null
      });

      await expect(downloadIso(mockEntry)).rejects.toThrow(
        'Failed to get response reader'
      );
    });

    it('uploadIso stores a local ISO file', async () => {
      const file = new File(['test'], 'custom.iso', {
        type: 'application/x-iso9660-image'
      });

      const result = await uploadIso(file);

      expect(result.name).toBe('custom.iso');
      expect(result.sizeBytes).toBe(file.size);
      expect(mockWritable.write).toHaveBeenCalledWith(file);
    });

    it('uploadIso rejects non-ISO files', async () => {
      const file = new File(['test'], 'notes.txt', { type: 'text/plain' });

      await expect(uploadIso(file)).rejects.toThrow(
        'Only .iso files are supported'
      );
    });
  });
});
