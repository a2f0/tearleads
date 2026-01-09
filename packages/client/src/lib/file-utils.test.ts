import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canShareFiles,
  computeContentHash,
  downloadFile,
  generateBackupFilename,
  readFileAsUint8Array,
  saveFile,
  shareFile
} from './file-utils';

// Mock Capacitor
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => 'web')
  }
}));

describe('file-utils', () => {
  describe('generateBackupFilename', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('generates filename with correct format', () => {
      vi.setSystemTime(new Date('2025-03-15T14:30:45'));
      const filename = generateBackupFilename();
      expect(filename).toBe('rapid-backup-2025-03-15-143045.db');
    });

    it('pads single digit months and days with zeros', () => {
      vi.setSystemTime(new Date('2025-01-05T09:05:03'));
      const filename = generateBackupFilename();
      expect(filename).toBe('rapid-backup-2025-01-05-090503.db');
    });

    it('handles midnight correctly', () => {
      vi.setSystemTime(new Date('2025-12-31T00:00:00'));
      const filename = generateBackupFilename();
      expect(filename).toBe('rapid-backup-2025-12-31-000000.db');
    });

    it('handles end of day correctly', () => {
      vi.setSystemTime(new Date('2025-06-30T23:59:59'));
      const filename = generateBackupFilename();
      expect(filename).toBe('rapid-backup-2025-06-30-235959.db');
    });
  });

  describe('downloadFile', () => {
    let capturedAnchor: HTMLAnchorElement | null = null;
    let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
    let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;
    let appendChildSpy: ReturnType<typeof vi.spyOn>;
    let removeChildSpy: ReturnType<typeof vi.spyOn>;
    let clickCount = 0;

    beforeEach(() => {
      clickCount = 0;
      createObjectURLSpy = vi
        .spyOn(URL, 'createObjectURL')
        .mockReturnValue('blob:test-url');
      revokeObjectURLSpy = vi
        .spyOn(URL, 'revokeObjectURL')
        .mockImplementation(() => {});

      // Capture the anchor element when created
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
        const element = originalCreateElement(tagName);
        if (tagName === 'a' && element instanceof HTMLAnchorElement) {
          capturedAnchor = element;
          vi.spyOn(element, 'click').mockImplementation(() => {
            clickCount++;
          });
        }
        return element;
      });

      appendChildSpy = vi
        .spyOn(document.body, 'appendChild')
        .mockImplementation((node) => node);
      removeChildSpy = vi
        .spyOn(document.body, 'removeChild')
        .mockImplementation((node) => node);
    });

    afterEach(() => {
      vi.restoreAllMocks();
      capturedAnchor = null;
    });

    it('creates a blob with correct data and type', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      downloadFile(data, 'test.db');

      expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
      const call = createObjectURLSpy.mock.calls[0];
      const blob = call?.[0];
      expect(blob).toBeInstanceOf(Blob);
      if (!(blob instanceof Blob)) {
        throw new Error('Expected a Blob passed to createObjectURL.');
      }
      expect(blob.type).toBe('application/octet-stream');
    });

    it('sets correct href and download attributes', () => {
      const data = new Uint8Array([1, 2, 3]);
      downloadFile(data, 'my-backup.db');

      expect(capturedAnchor).not.toBeNull();
      expect(capturedAnchor?.href).toBe('blob:test-url');
      expect(capturedAnchor?.download).toBe('my-backup.db');
    });

    it('triggers click and cleans up', () => {
      const data = new Uint8Array([1, 2, 3]);
      downloadFile(data, 'test.db');

      expect(appendChildSpy).toHaveBeenCalledTimes(1);
      expect(clickCount).toBe(1);
      expect(removeChildSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:test-url');
    });
  });

  describe('readFileAsUint8Array', () => {
    it('reads file content as Uint8Array', async () => {
      const content = new Uint8Array([10, 20, 30, 40, 50]);
      const file = new File([content], 'test.db', {
        type: 'application/octet-stream'
      });

      const result = await readFileAsUint8Array(file);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(Array.from(result)).toEqual([10, 20, 30, 40, 50]);
    });

    it('handles empty file', async () => {
      const file = new File([], 'empty.db');

      const result = await readFileAsUint8Array(file);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(0);
    });

    it('handles large file', async () => {
      const largeContent = new Uint8Array(1024 * 1024); // 1MB
      for (let i = 0; i < largeContent.length; i++) {
        largeContent[i] = i % 256;
      }
      const file = new File([largeContent], 'large.db');

      const result = await readFileAsUint8Array(file);

      expect(result.length).toBe(1024 * 1024);
      expect(result[0]).toBe(0);
      expect(result[255]).toBe(255);
      expect(result[256]).toBe(0);
    });

    it('preserves binary data integrity', async () => {
      // Test with all possible byte values
      const allBytes = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        allBytes[i] = i;
      }
      const file = new File([allBytes], 'bytes.db');

      const result = await readFileAsUint8Array(file);

      for (let i = 0; i < 256; i++) {
        expect(result[i]).toBe(i);
      }
    });

    it('rejects when FileReader result is not ArrayBuffer', async () => {
      const OriginalFileReader = globalThis.FileReader;

      try {
        class MockFileReader {
          result: string | ArrayBuffer | null = 'not an ArrayBuffer';
          onload: (() => void) | null = null;
          onerror: (() => void) | null = null;
          error: Error | null = null;

          readAsArrayBuffer() {
            setTimeout(() => {
              this.onload?.();
            }, 0);
          }
        }

        Object.defineProperty(globalThis, 'FileReader', {
          value: MockFileReader,
          writable: true
        });

        const file = new File(['test'], 'test.db');

        await expect(readFileAsUint8Array(file)).rejects.toThrow(
          'Failed to read file as ArrayBuffer'
        );
      } finally {
        Object.defineProperty(globalThis, 'FileReader', {
          value: OriginalFileReader,
          writable: true
        });
      }
    });

    it('rejects when FileReader encounters an error', async () => {
      const OriginalFileReader = globalThis.FileReader;
      const testError = new Error('File read failed');

      try {
        class MockFileReader {
          result: ArrayBuffer | null = null;
          onload: (() => void) | null = null;
          onerror: (() => void) | null = null;
          error: Error | null = testError;

          readAsArrayBuffer() {
            setTimeout(() => {
              this.onerror?.();
            }, 0);
          }
        }

        Object.defineProperty(globalThis, 'FileReader', {
          value: MockFileReader,
          writable: true
        });

        const file = new File(['test'], 'test.db');

        await expect(readFileAsUint8Array(file)).rejects.toThrow(testError);
      } finally {
        Object.defineProperty(globalThis, 'FileReader', {
          value: OriginalFileReader,
          writable: true
        });
      }
    });
  });

  describe('computeContentHash', () => {
    beforeEach(() => {
      // Use a simple hash mock that produces consistent results
      vi.spyOn(crypto.subtle, 'digest').mockImplementation(
        async (_algorithm, data) => {
          let dataArray: Uint8Array;
          if (data instanceof ArrayBuffer) {
            dataArray = new Uint8Array(data);
          } else if (ArrayBuffer.isView(data)) {
            dataArray = new Uint8Array(
              data.buffer,
              data.byteOffset,
              data.byteLength
            );
          } else {
            dataArray = new Uint8Array(0);
          }

          // Simple mock hash based on data content
          const hash = new Uint8Array(32);
          for (let i = 0; i < dataArray.length; i++) {
            const idx = i % 32;
            hash[idx] = (hash[idx] ?? 0) ^ (dataArray[i] ?? 0);
          }
          return hash.buffer;
        }
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('computes SHA-256 hash of data', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const hash = await computeContentHash(data);

      // SHA-256 produces 64 hex characters
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces consistent hash for same data', async () => {
      const data = new Uint8Array([10, 20, 30]);
      const hash1 = await computeContentHash(data);
      const hash2 = await computeContentHash(data);

      expect(hash1).toBe(hash2);
    });

    it('produces different hash for different data', async () => {
      const data1 = new Uint8Array([1, 2, 3]);
      const data2 = new Uint8Array([1, 2, 4]);

      const hash1 = await computeContentHash(data1);
      const hash2 = await computeContentHash(data2);

      expect(hash1).not.toBe(hash2);
    });

    it('handles empty data', async () => {
      const data = new Uint8Array([]);
      const hash = await computeContentHash(data);

      // With our mock, empty data produces all zeros hash
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('canShareFiles', () => {
    const originalNavigator = { ...navigator };

    afterEach(() => {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true
      });
      vi.restoreAllMocks();
    });

    it('returns false when navigator.share is not available', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { ...navigator, share: undefined, canShare: undefined },
        configurable: true
      });

      expect(canShareFiles()).toBe(false);
    });

    it('returns false when navigator.canShare is not available', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { ...navigator, share: vi.fn(), canShare: undefined },
        configurable: true
      });

      expect(canShareFiles()).toBe(false);
    });

    it('returns result of canShare when both are available', () => {
      const mockCanShare = vi.fn().mockReturnValue(true);
      Object.defineProperty(globalThis, 'navigator', {
        value: { ...navigator, share: vi.fn(), canShare: mockCanShare },
        configurable: true
      });

      expect(canShareFiles()).toBe(true);
      expect(mockCanShare).toHaveBeenCalled();
    });
  });

  describe('shareFile', () => {
    const originalNavigator = { ...navigator };

    afterEach(() => {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true
      });
      vi.restoreAllMocks();
    });

    it('returns false when navigator.share is not available', async () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { ...navigator, share: undefined, canShare: undefined },
        configurable: true
      });

      const data = new Uint8Array([1, 2, 3]);
      const result = await shareFile(
        data,
        'test.db',
        'application/octet-stream'
      );

      expect(result).toBe(false);
    });

    it('returns false when navigator.canShare is not available', async () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { ...navigator, share: vi.fn(), canShare: undefined },
        configurable: true
      });

      const data = new Uint8Array([1, 2, 3]);
      const result = await shareFile(
        data,
        'test.db',
        'application/octet-stream'
      );

      expect(result).toBe(false);
    });

    it('returns false when canShare returns false for file', async () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          ...navigator,
          share: vi.fn(),
          canShare: vi.fn().mockReturnValue(false)
        },
        configurable: true
      });

      const data = new Uint8Array([1, 2, 3]);
      const result = await shareFile(
        data,
        'test.db',
        'application/octet-stream'
      );

      expect(result).toBe(false);
    });

    it('calls navigator.share and returns true when sharing succeeds', async () => {
      const mockShare = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          ...navigator,
          share: mockShare,
          canShare: vi.fn().mockReturnValue(true)
        },
        configurable: true
      });

      const data = new Uint8Array([1, 2, 3]);
      const result = await shareFile(
        data,
        'test.db',
        'application/octet-stream'
      );

      expect(result).toBe(true);
      expect(mockShare).toHaveBeenCalledWith({
        files: expect.arrayContaining([expect.any(File)])
      });
    });
  });

  describe('saveFile', () => {
    let createObjectURLSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // Mock URL methods for downloadFile
      createObjectURLSpy = vi
        .spyOn(URL, 'createObjectURL')
        .mockReturnValue('blob:test-url');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      // Mock document methods
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
        const element = originalCreateElement(tagName);
        if (tagName === 'a') {
          vi.spyOn(element, 'click').mockImplementation(() => {});
        }
        return element;
      });

      vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
      vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const webPlatforms: Array<'web' | 'electron'> = ['web', 'electron'];

    it.each(webPlatforms)(
      'uses downloadFile for %s platform',
      async (platform) => {
      const { Capacitor } = await import('@capacitor/core');
      vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);

      const data = new Uint8Array([1, 2, 3]);
      await saveFile(data, 'test.db');

      // downloadFile should have been called, which creates a blob URL
      expect(createObjectURLSpy).toHaveBeenCalled();
      }
    );

    const mobilePlatforms: Array<'ios' | 'android'> = ['ios', 'android'];

    it.each(mobilePlatforms)(
      'uses Capacitor Share API for %s platform',
      async (platform) => {
      const { Capacitor } = await import('@capacitor/core');
      vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);

      const mockWriteFile = vi
        .fn()
        .mockResolvedValue({ uri: 'file:///cache/test.db' });
      const mockShare = vi.fn().mockResolvedValue(undefined);

      vi.doMock('@capacitor/filesystem', () => ({
        Filesystem: {
          writeFile: mockWriteFile
        },
        Directory: {
          Cache: 'CACHE'
        }
      }));

      vi.doMock('@capacitor/share', () => ({
        Share: {
          share: mockShare
        }
      }));

      // Reset module cache to pick up mocks
      vi.resetModules();

      // Re-import with fresh mocks
      const { saveFile: saveFileMobile } = await import('./file-utils');

      const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      await saveFileMobile(data, 'backup.db');

      expect(mockWriteFile).toHaveBeenCalledWith({
        path: 'backup.db',
        data: expect.any(String), // base64 encoded data
        directory: 'CACHE'
      });

      expect(mockShare).toHaveBeenCalledWith({
        title: 'Database Backup',
        url: 'file:///cache/test.db',
        dialogTitle: 'Save Backup'
      });
      }
    );

    it('correctly converts data to base64 for mobile platforms', async () => {
      const { Capacitor } = await import('@capacitor/core');
      vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');

      let capturedBase64: string | undefined;
      const mockWriteFile = vi.fn().mockImplementation(({ data }) => {
        capturedBase64 = data;
        return Promise.resolve({ uri: 'file:///cache/test.db' });
      });
      const mockShare = vi.fn().mockResolvedValue(undefined);

      vi.doMock('@capacitor/filesystem', () => ({
        Filesystem: {
          writeFile: mockWriteFile
        },
        Directory: {
          Cache: 'CACHE'
        }
      }));

      vi.doMock('@capacitor/share', () => ({
        Share: {
          share: mockShare
        }
      }));

      vi.resetModules();

      const { saveFile: saveFileMobile } = await import('./file-utils');

      // Create test data that can be verified via base64
      const testString = 'Hello, World!';
      const data = new Uint8Array(
        testString.split('').map((c) => c.charCodeAt(0))
      );
      await saveFileMobile(data, 'test.db');

      // Verify the base64 encoding is correct and mocks were called
      expect(capturedBase64).toBe(btoa(testString));
      expect(mockWriteFile).toHaveBeenCalled();
      expect(mockShare).toHaveBeenCalled();
    });

    it('handles large data with chunked base64 encoding on mobile', async () => {
      const { Capacitor } = await import('@capacitor/core');
      vi.mocked(Capacitor.getPlatform).mockReturnValue('android');

      let capturedBase64: string | undefined;
      const mockWriteFile = vi.fn().mockImplementation(({ data }) => {
        capturedBase64 = data;
        return Promise.resolve({ uri: 'file:///cache/large.db' });
      });
      const mockShare = vi.fn().mockResolvedValue(undefined);

      vi.doMock('@capacitor/filesystem', () => ({
        Filesystem: {
          writeFile: mockWriteFile
        },
        Directory: {
          Cache: 'CACHE'
        }
      }));

      vi.doMock('@capacitor/share', () => ({
        Share: {
          share: mockShare
        }
      }));

      vi.resetModules();

      const { saveFile: saveFileMobile } = await import('./file-utils');

      // Create data larger than CHUNK_SIZE (32k) to test chunking
      const largeData = new Uint8Array(50000);
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256;
      }

      await saveFileMobile(largeData, 'large.db');

      // Verify data integrity by decoding and comparing with original
      expect(capturedBase64).toBeDefined();
      if (!capturedBase64) throw new Error('capturedBase64 should be defined');
      const decodedString = atob(capturedBase64);
      const decodedData = new Uint8Array(decodedString.length).map((_, i) =>
        decodedString.charCodeAt(i)
      );
      expect(decodedData).toEqual(largeData);

      // Verify mocks were called
      expect(mockWriteFile).toHaveBeenCalled();
      expect(mockShare).toHaveBeenCalled();
    });
  });
});
