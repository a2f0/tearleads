/**
 * Thumbnail generation utility for images and audio files.
 * Uses Canvas API with createImageBitmap() for cross-platform support.
 * For audio files, extracts embedded cover art and generates a thumbnail from it.
 */

import { extractAudioCoverArt, isAudioMimeType } from './audio-metadata';

export interface ThumbnailOptions {
  maxWidth: number;
  maxHeight: number;
  quality: number;
}

export const DEFAULT_THUMBNAIL_OPTIONS: ThumbnailOptions = {
  maxWidth: 800,
  maxHeight: 800,
  quality: 0.92
};

// Display size for thumbnail UI elements (CSS pixels)
// Generation size is 4x this for Retina/high-DPI support
export const THUMBNAIL_DISPLAY_SIZE = 200;

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp'
]);

/**
 * Check if a MIME type is supported for thumbnail generation.
 * Supports both images (direct) and audio files (via embedded cover art).
 */
export function isThumbnailSupported(mimeType: string): boolean {
  return SUPPORTED_IMAGE_MIME_TYPES.has(mimeType) || isAudioMimeType(mimeType);
}

/**
 * Generate a thumbnail from image or audio data.
 * For audio files, extracts embedded cover art first.
 * Returns the thumbnail as a Uint8Array (JPEG format), or null if no thumbnail could be generated.
 * @throws Error if image processing fails (not thrown for missing audio cover art)
 */
export async function generateThumbnail(
  fileData: Uint8Array,
  mimeType: string,
  options?: Partial<ThumbnailOptions>
): Promise<Uint8Array | null> {
  const opts = { ...DEFAULT_THUMBNAIL_OPTIONS, ...options };

  let imageData: Uint8Array;
  let imageMimeType: string;

  if (isAudioMimeType(mimeType)) {
    const coverArt = await extractAudioCoverArt(fileData, mimeType);
    if (!coverArt) {
      return null;
    }
    imageData = coverArt;
    imageMimeType = 'image/jpeg';
  } else {
    imageData = fileData;
    imageMimeType = mimeType;
  }

  // Create blob from image data (slice creates a copy with proper ArrayBuffer)
  const blob = new Blob([imageData.slice()], { type: imageMimeType });
  const bitmap = await createImageBitmap(blob);
  const { width, height } = calculateScaledDimensions(
    bitmap.width,
    bitmap.height,
    opts.maxWidth,
    opts.maxHeight
  );

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Failed to get canvas 2d context');
  }

  // Use high-quality image smoothing for better downscaling
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

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
export function calculateScaledDimensions(
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
