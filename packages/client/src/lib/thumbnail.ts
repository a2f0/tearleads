/**
 * Thumbnail generation utility for images.
 * Uses Canvas API with createImageBitmap() for cross-platform support.
 */

export interface ThumbnailOptions {
  maxWidth: number;
  maxHeight: number;
  quality: number;
}

export const DEFAULT_THUMBNAIL_OPTIONS: ThumbnailOptions = {
  maxWidth: 200,
  maxHeight: 200,
  quality: 0.8
};

const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp'
]);

/**
 * Check if a MIME type is supported for thumbnail generation.
 */
export function isThumbnailSupported(mimeType: string): boolean {
  return SUPPORTED_MIME_TYPES.has(mimeType);
}

/**
 * Generate a thumbnail from image data.
 * Returns the thumbnail as a Uint8Array (JPEG format).
 * @throws Error if the image cannot be processed
 */
export async function generateThumbnail(
  imageData: Uint8Array,
  mimeType: string,
  options?: Partial<ThumbnailOptions>
): Promise<Uint8Array> {
  const opts = { ...DEFAULT_THUMBNAIL_OPTIONS, ...options };

  // Create blob from image data (slice creates a copy with proper ArrayBuffer)
  const blob = new Blob([imageData.slice()], { type: mimeType });

  // Decode image using createImageBitmap
  const bitmap = await createImageBitmap(blob);

  // Calculate scaled dimensions while preserving aspect ratio
  const { width, height } = calculateScaledDimensions(
    bitmap.width,
    bitmap.height,
    opts.maxWidth,
    opts.maxHeight
  );

  // Create canvas and draw scaled image
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Failed to get canvas 2d context');
  }

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // Export as JPEG
  const thumbnailBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error('Failed to export canvas to blob'));
        }
      },
      'image/jpeg',
      opts.quality
    );
  });

  // Convert blob to Uint8Array
  const arrayBuffer = await thumbnailBlob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/**
 * Calculate dimensions that fit within bounds while preserving aspect ratio.
 * Will not scale up images smaller than the bounds.
 */
function calculateScaledDimensions(
  originalWidth: number,
  originalHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  // Don't scale up small images
  if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
    return { width: originalWidth, height: originalHeight };
  }

  const widthRatio = maxWidth / originalWidth;
  const heightRatio = maxHeight / originalHeight;
  const scale = Math.min(widthRatio, heightRatio);

  return {
    width: Math.round(originalWidth * scale),
    height: Math.round(originalHeight * scale)
  };
}
