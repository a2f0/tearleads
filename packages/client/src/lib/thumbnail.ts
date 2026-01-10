/**
 * Thumbnail generation utility for images, audio files, and PDFs.
 * Uses Canvas API with createImageBitmap() for cross-platform support.
 * For audio files, extracts embedded cover art and generates a thumbnail from it.
 * For PDFs, renders the first page to a canvas.
 */

import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { extractAudioCoverArt, isAudioMimeType } from './audio-metadata';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

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

const PDF_MIME_TYPE = 'application/pdf';

/**
 * Check if a MIME type is a PDF.
 */
export function isPdfMimeType(mimeType: string): boolean {
  return mimeType === PDF_MIME_TYPE;
}

/**
 * Check if a MIME type is supported for thumbnail generation.
 * Supports images (direct), audio files (via embedded cover art), and PDFs (first page).
 */
export function isThumbnailSupported(mimeType: string): boolean {
  return (
    SUPPORTED_IMAGE_MIME_TYPES.has(mimeType) ||
    isAudioMimeType(mimeType) ||
    isPdfMimeType(mimeType)
  );
}

/**
 * Render the first page of a PDF to a canvas.
 * Returns the canvas with the rendered page, or null if rendering fails.
 */
async function renderPdfFirstPage(
  pdfData: Uint8Array,
  maxWidth: number,
  maxHeight: number
): Promise<HTMLCanvasElement | null> {
  const loadingTask = pdfjs.getDocument({ data: pdfData });
  const pdf = await loadingTask.promise;

  if (pdf.numPages === 0) {
    await pdf.destroy();
    return null;
  }

  const page = await pdf.getPage(1);

  // Get the page dimensions at scale 1
  const viewport = page.getViewport({ scale: 1 });

  // Calculate scale to fit within max dimensions
  const scaleX = maxWidth / viewport.width;
  const scaleY = maxHeight / viewport.height;
  const scale = Math.min(scaleX, scaleY, 1); // Don't scale up

  const scaledViewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(scaledViewport.width);
  canvas.height = Math.round(scaledViewport.height);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    await pdf.destroy();
    return null;
  }

  await page.render({
    canvasContext: ctx,
    viewport: scaledViewport,
    canvas
  }).promise;

  await pdf.destroy();
  return canvas;
}

/**
 * Generate a thumbnail from image, audio, or PDF data.
 * For audio files, extracts embedded cover art first.
 * For PDFs, renders the first page.
 * Returns the thumbnail as a Uint8Array (JPEG format), or null if no thumbnail could be generated.
 * @throws Error if image processing fails (not thrown for missing audio cover art)
 */
export async function generateThumbnail(
  fileData: Uint8Array,
  mimeType: string,
  options?: Partial<ThumbnailOptions>
): Promise<Uint8Array | null> {
  const opts = { ...DEFAULT_THUMBNAIL_OPTIONS, ...options };

  // Handle PDFs separately - render first page directly to canvas
  if (isPdfMimeType(mimeType)) {
    const canvas = await renderPdfFirstPage(
      fileData,
      opts.maxWidth,
      opts.maxHeight
    );
    if (!canvas) {
      return null;
    }
    return canvasToJpeg(canvas, opts.quality);
  }

  let imageData: Uint8Array;
  let imageMimeType: string;

  if (isAudioMimeType(mimeType)) {
    const coverArtInfo = await extractAudioCoverArt(fileData, mimeType);
    if (!coverArtInfo) {
      return null;
    }
    imageData = coverArtInfo.data;
    imageMimeType = coverArtInfo.format;
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

  return canvasToJpeg(canvas, opts.quality);
}

/**
 * Convert a canvas to a JPEG Uint8Array.
 */
async function canvasToJpeg(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Uint8Array> {
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
      quality
    );
  });

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
