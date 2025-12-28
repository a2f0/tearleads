import { fileTypeFromBuffer } from 'file-type';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downloadFile,
  generateBackupFilename,
  readFileAsUint8Array
} from './file-utils';

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
        if (tagName === 'a') {
          capturedAnchor = element as HTMLAnchorElement;
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
      const blob = createObjectURLSpy.mock.calls[0]?.[0] as Blob;
      expect(blob).toBeInstanceOf(Blob);
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
  });

  describe('file type detection', () => {
    it('detects PNG files from magic bytes', async () => {
      // PNG file header with IHDR chunk (minimum valid PNG structure)
      const pngBytes = new Uint8Array([
        // PNG signature
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        // IHDR chunk length (13 bytes)
        0x00, 0x00, 0x00, 0x0d,
        // IHDR chunk type
        0x49, 0x48, 0x44, 0x52,
        // IHDR data (width, height, bit depth, color type, etc.)
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
        0x00,
        // CRC
        0x90, 0x77, 0x53, 0xde
      ]);
      const result = await fileTypeFromBuffer(pngBytes);
      expect(result).not.toBeUndefined();
      expect(result?.mime).toBe('image/png');
      expect(result?.ext).toBe('png');
    });

    it('detects JPEG files from magic bytes', async () => {
      // JPEG magic bytes: FF D8 FF
      const jpegMagicBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
      const result = await fileTypeFromBuffer(jpegMagicBytes);
      expect(result).not.toBeUndefined();
      expect(result?.mime).toBe('image/jpeg');
      expect(result?.ext).toBe('jpg');
    });

    it('detects PDF files from magic bytes', async () => {
      // PDF magic bytes: %PDF (25 50 44 46)
      const pdfMagicBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
      const result = await fileTypeFromBuffer(pdfMagicBytes);
      expect(result).not.toBeUndefined();
      expect(result?.mime).toBe('application/pdf');
      expect(result?.ext).toBe('pdf');
    });

    it('returns undefined for unrecognized magic bytes', async () => {
      // Random bytes that don't match any known file signature
      const unknownBytes = new Uint8Array([
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07
      ]);
      const result = await fileTypeFromBuffer(unknownBytes);
      expect(result).toBeUndefined();
    });

    it('returns undefined for plain text content', async () => {
      // Plain text has no magic bytes - use ASCII codes directly
      const textContent = new Uint8Array([
        0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x2c, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64,
        0x21
      ]); // "Hello, world!"
      const result = await fileTypeFromBuffer(textContent);
      expect(result).toBeUndefined();
    });

    it('returns undefined for empty buffer', async () => {
      const emptyBuffer = new Uint8Array([]);
      const result = await fileTypeFromBuffer(emptyBuffer);
      expect(result).toBeUndefined();
    });
  });
});
