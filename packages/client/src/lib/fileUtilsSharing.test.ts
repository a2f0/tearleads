import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canShareFiles, saveFile, shareFile } from './fileUtils';

// Mock Capacitor
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => 'web')
  }
}));

describe('file-utils sharing', () => {
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

    it.each(
      webPlatforms
    )('uses downloadFile for %s platform', async (platform) => {
      const { Capacitor } = await import('@capacitor/core');
      vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);

      const data = new Uint8Array([1, 2, 3]);
      await saveFile(data, 'test.db');

      // downloadFile should have been called, which creates a blob URL
      expect(createObjectURLSpy).toHaveBeenCalled();
    });

    const mobilePlatforms: Array<'ios' | 'android'> = ['ios', 'android'];

    it.each(
      mobilePlatforms
    )('uses Capacitor Share API for %s platform', async (platform) => {
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
      const { saveFile: saveFileMobile } = await import('./fileUtils');

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
    });

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

      const { saveFile: saveFileMobile } = await import('./fileUtils');

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

      const { saveFile: saveFileMobile } = await import('./fileUtils');

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
