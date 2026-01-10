import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculateScaledDimensions,
  DEFAULT_THUMBNAIL_OPTIONS,
  generateThumbnail,
  isPdfMimeType,
  isThumbnailSupported,
  THUMBNAIL_DISPLAY_SIZE
} from './thumbnail';

describe('thumbnail', () => {
  class MockBlob extends Blob {
    private readonly buffer: ArrayBuffer;

    constructor(buffer: ArrayBuffer) {
      super([buffer]);
      this.buffer = buffer;
    }

    override async arrayBuffer() {
      return this.buffer;
    }
  }

  describe('isPdfMimeType', () => {
    it('returns true for application/pdf', () => {
      expect(isPdfMimeType('application/pdf')).toBe(true);
    });

    it('returns false for image/jpeg', () => {
      expect(isPdfMimeType('image/jpeg')).toBe(false);
    });

    it('returns false for text/plain', () => {
      expect(isPdfMimeType('text/plain')).toBe(false);
    });
  });

  describe('isThumbnailSupported', () => {
    it('returns true for JPEG', () => {
      expect(isThumbnailSupported('image/jpeg')).toBe(true);
    });

    it('returns true for PNG', () => {
      expect(isThumbnailSupported('image/png')).toBe(true);
    });

    it('returns true for GIF', () => {
      expect(isThumbnailSupported('image/gif')).toBe(true);
    });

    it('returns true for WebP', () => {
      expect(isThumbnailSupported('image/webp')).toBe(true);
    });

    it('returns true for audio/mpeg (MP3)', () => {
      expect(isThumbnailSupported('audio/mpeg')).toBe(true);
    });

    it('returns true for audio/flac', () => {
      expect(isThumbnailSupported('audio/flac')).toBe(true);
    });

    it('returns true for audio/mp4 (M4A)', () => {
      expect(isThumbnailSupported('audio/mp4')).toBe(true);
    });

    it('returns true for PDF', () => {
      expect(isThumbnailSupported('application/pdf')).toBe(true);
    });

    it('returns false for text files', () => {
      expect(isThumbnailSupported('text/plain')).toBe(false);
    });

    it('returns false for SVG', () => {
      expect(isThumbnailSupported('image/svg+xml')).toBe(false);
    });

    it('returns false for HEIC', () => {
      expect(isThumbnailSupported('image/heic')).toBe(false);
    });
  });

  describe('DEFAULT_THUMBNAIL_OPTIONS', () => {
    it('has expected default values for high-DPI support', () => {
      expect(DEFAULT_THUMBNAIL_OPTIONS).toEqual({
        maxWidth: 800,
        maxHeight: 800,
        quality: 0.92
      });
    });
  });

  describe('THUMBNAIL_DISPLAY_SIZE', () => {
    it('provides appropriate display size with high-res generation for Retina support', () => {
      expect(THUMBNAIL_DISPLAY_SIZE).toBe(200);
      // Generation is 4x the linear display dimension (800px vs 200px) for crisp display on high-DPI screens
      expect(DEFAULT_THUMBNAIL_OPTIONS.maxWidth).toBe(
        THUMBNAIL_DISPLAY_SIZE * 4
      );
    });
  });

  describe('calculateScaledDimensions', () => {
    it('returns original dimensions when smaller than max', () => {
      const result = calculateScaledDimensions(100, 80, 200, 200);
      expect(result).toEqual({ width: 100, height: 80 });
    });

    it('returns original dimensions when equal to max', () => {
      const result = calculateScaledDimensions(200, 200, 200, 200);
      expect(result).toEqual({ width: 200, height: 200 });
    });

    it('scales down landscape image to fit width', () => {
      const result = calculateScaledDimensions(400, 200, 200, 200);
      expect(result).toEqual({ width: 200, height: 100 });
    });

    it('scales down portrait image to fit height', () => {
      const result = calculateScaledDimensions(200, 400, 200, 200);
      expect(result).toEqual({ width: 100, height: 200 });
    });

    it('scales down square image proportionally', () => {
      const result = calculateScaledDimensions(400, 400, 200, 200);
      expect(result).toEqual({ width: 200, height: 200 });
    });

    it('handles non-square max dimensions with landscape image', () => {
      const result = calculateScaledDimensions(800, 400, 200, 100);
      // Width ratio: 200/800 = 0.25, Height ratio: 100/400 = 0.25
      expect(result).toEqual({ width: 200, height: 100 });
    });

    it('handles non-square max dimensions with portrait image', () => {
      const result = calculateScaledDimensions(400, 800, 100, 200);
      // Width ratio: 100/400 = 0.25, Height ratio: 200/800 = 0.25
      expect(result).toEqual({ width: 100, height: 200 });
    });

    it('scales down using smaller ratio when aspect ratios differ', () => {
      // 1000x500 image into 200x200 max
      // Width ratio: 200/1000 = 0.2, Height ratio: 200/500 = 0.4
      // Uses 0.2, resulting in 200x100
      const result = calculateScaledDimensions(1000, 500, 200, 200);
      expect(result).toEqual({ width: 200, height: 100 });
    });

    it('preserves aspect ratio for tall narrow image', () => {
      // 100x1000 into 200x200
      // Width ratio: 200/100 = 2.0 (would scale up), Height ratio: 200/1000 = 0.2
      // Uses 0.2, resulting in 20x200
      const result = calculateScaledDimensions(100, 1000, 200, 200);
      expect(result).toEqual({ width: 20, height: 200 });
    });

    it('rounds dimensions to integers', () => {
      // 333x333 into 200x200 -> scale = 0.6006...
      // Result would be 199.98... x 199.98... -> rounds to 200x200
      const result = calculateScaledDimensions(333, 333, 200, 200);
      expect(result.width).toBe(200);
      expect(result.height).toBe(200);
    });
  });

  describe('generateThumbnail', () => {
    let mockBitmap: {
      width: number;
      height: number;
      close: ReturnType<typeof vi.fn>;
    };
    let mockContext: {
      drawImage: ReturnType<typeof vi.fn>;
    };
    let mockCanvas: HTMLCanvasElement;
    let getContext: ReturnType<typeof vi.fn>;
    let toBlob: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockBitmap = {
        width: 400,
        height: 300,
        close: vi.fn()
      };

      mockContext = {
        drawImage: vi.fn()
      };

      mockCanvas = document.createElement('canvas');
      mockCanvas.width = 0;
      mockCanvas.height = 0;
      getContext = vi.fn().mockReturnValue(mockContext);
      toBlob = vi.fn();
      Object.defineProperty(mockCanvas, 'getContext', {
        value: getContext
      });
      Object.defineProperty(mockCanvas, 'toBlob', {
        value: toBlob
      });

      vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(mockBitmap));

      vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
        if (tagName === 'canvas') {
          return mockCanvas;
        }
        return document.createElement(tagName);
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('generates thumbnail from image data', async () => {
      const resultData = new Uint8Array([1, 2, 3, 4]);
      const mockBlob = new MockBlob(resultData.buffer);

      toBlob.mockImplementation((callback: (blob: Blob | null) => void) => {
        callback(mockBlob);
      });

      const imageData = new Uint8Array([10, 20, 30]);
      const result = await generateThumbnail(imageData, 'image/jpeg');

      expect(result).toBeInstanceOf(Uint8Array);
      expect(createImageBitmap).toHaveBeenCalled();
      expect(mockContext.drawImage).toHaveBeenCalled();
      expect(mockBitmap.close).toHaveBeenCalled();
    });

    it('uses custom options when provided', async () => {
      const resultData = new Uint8Array([1]);
      const mockBlob = new MockBlob(resultData.buffer);

      toBlob.mockImplementation((callback: (blob: Blob | null) => void) => {
        callback(mockBlob);
      });

      const imageData = new Uint8Array([10, 20, 30]);
      await generateThumbnail(imageData, 'image/jpeg', {
        maxWidth: 100,
        maxHeight: 100,
        quality: 0.5
      });

      // Verify toBlob was called with custom quality
      expect(toBlob).toHaveBeenCalledWith(
        expect.any(Function),
        'image/jpeg',
        0.5
      );
    });

    it('throws error when canvas context is null', async () => {
      getContext.mockReturnValue(null);

      const imageData = new Uint8Array([10, 20, 30]);

      await expect(generateThumbnail(imageData, 'image/jpeg')).rejects.toThrow(
        'Failed to get canvas 2d context'
      );

      expect(mockBitmap.close).toHaveBeenCalled();
    });

    it('throws error when toBlob returns null', async () => {
      toBlob.mockImplementation((callback: (blob: Blob | null) => void) => {
        callback(null);
      });

      const imageData = new Uint8Array([10, 20, 30]);

      await expect(generateThumbnail(imageData, 'image/jpeg')).rejects.toThrow(
        'Failed to export canvas to blob'
      );
    });

    it('scales canvas dimensions based on image size', async () => {
      const resultData = new Uint8Array([1]);
      const mockBlob = new MockBlob(resultData.buffer);

      toBlob.mockImplementation((callback: (blob: Blob | null) => void) => {
        callback(mockBlob);
      });

      // 400x300 image with max 800x800 stays at 400x300 (fits within bounds)
      const imageData = new Uint8Array([10, 20, 30]);
      await generateThumbnail(imageData, 'image/jpeg');

      expect(mockCanvas.width).toBe(400);
      expect(mockCanvas.height).toBe(300);
    });

    it('generates thumbnail from PDF data', async () => {
      const resultData = new Uint8Array([1, 2, 3, 4]);
      const mockBlob = new MockBlob(resultData.buffer);

      toBlob.mockImplementation((callback: (blob: Blob | null) => void) => {
        callback(mockBlob);
      });

      const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
      const result = await generateThumbnail(pdfData, 'application/pdf');

      expect(result).toBeInstanceOf(Uint8Array);
      // PDF rendering uses pdfjs, not createImageBitmap
      expect(createImageBitmap).not.toHaveBeenCalled();
    });

    it('returns null for empty PDF', async () => {
      // Override mock to return empty PDF
      const pdfjs = await import('pdfjs-dist');
      const emptyPdf = {
        numPages: 0,
        getPage: vi.fn(),
        destroy: vi.fn().mockResolvedValue(undefined)
      };
      vi.mocked(pdfjs.getDocument).mockReturnValueOnce({
        promise: Promise.resolve(emptyPdf)
      } as unknown as ReturnType<typeof pdfjs.getDocument>);

      const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      const result = await generateThumbnail(pdfData, 'application/pdf');

      expect(result).toBeNull();
      expect(emptyPdf.destroy).toHaveBeenCalled();
    });
  });
});
