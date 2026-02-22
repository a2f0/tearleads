/**
 * File utilities for backup/restore operations.
 */

import { Capacitor } from '@capacitor/core';
import { sha256 } from '@noble/hashes/sha2.js';
import { assertPlainArrayBuffer } from '@tearleads/shared';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute SHA-256 hash of file data.
 * Used for deduplication and integrity verification.
 */
export async function computeContentHash(data: Uint8Array): Promise<string> {
  assertPlainArrayBuffer(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(hashBuffer));
}

/**
 * Generate a backup filename with timestamp.
 * Format: tearleads-backup-YYYY-MM-DD-HHmmss.db
 */
export function generateBackupFilename(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `tearleads-backup-${year}-${month}-${day}-${hours}${minutes}${seconds}.db`;
}

/**
 * Download a file in the browser using a blob URL.
 */
export function downloadFile(data: Uint8Array, filename: string): void {
  assertPlainArrayBuffer(data);
  const blob = new Blob([data], {
    type: 'application/octet-stream'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Read a file as Uint8Array.
 * Note: For large files, prefer streaming APIs to avoid loading entire file into memory.
 */
export async function readFileAsUint8Array(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result));
      } else {
        reject(new Error('Failed to read file as ArrayBuffer'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Read the first N bytes of a file for MIME type detection (magic bytes).
 * Default is 4KB which is sufficient for most file type signatures.
 */
export async function readMagicBytes(
  file: File,
  byteCount = 4096
): Promise<Uint8Array> {
  const slice = file.slice(0, Math.min(byteCount, file.size));
  const buffer = await slice.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Create a ReadableStream directly from a File without loading into memory.
 * Uses the native File.stream() API for memory-efficient streaming.
 */
export function createStreamFromFile(file: File): ReadableStream<Uint8Array> {
  return file.stream();
}

/**
 * Compute SHA-256 hash of a stream incrementally.
 * Memory-efficient for large files as it processes chunks without buffering.
 * Returns the hex-encoded hash string.
 *
 * Note: This consumes the stream. The stream cannot be reused after calling this.
 */
export async function computeContentHashStreaming(
  stream: ReadableStream<Uint8Array>
): Promise<string> {
  const hasher = sha256.create();
  const reader = stream.getReader();
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      assertPlainArrayBuffer(value);
      hasher.update(value);
    }
  } finally {
    reader.releaseLock();
  }
  return bytesToHex(hasher.digest());
}

/**
 * Check if the Web Share API with file sharing is supported.
 */
export function canShareFiles(): boolean {
  if (!navigator.share || !navigator.canShare) {
    return false;
  }
  // Test with a dummy file to check if file sharing is supported
  const testFile = new File(['test'], 'test.txt', { type: 'text/plain' });
  return navigator.canShare({ files: [testFile] });
}

/**
 * Share a file using the Web Share API.
 * Returns true if sharing was initiated, false if not supported.
 * Throws if sharing fails for other reasons.
 */
export async function shareFile(
  data: Uint8Array,
  filename: string,
  mimeType: string
): Promise<boolean> {
  if (!navigator.share || !navigator.canShare) {
    return false;
  }

  assertPlainArrayBuffer(data);
  const file = new File([data], filename, { type: mimeType });

  if (!navigator.canShare({ files: [file] })) {
    return false;
  }

  await navigator.share({ files: [file] });
  return true;
}

/**
 * Save file using platform-appropriate method.
 * - Mobile (iOS/Android): Uses Share API to let user save via system share sheet
 * - Web/Electron: Uses browser download
 */
export async function saveFile(
  data: Uint8Array,
  filename: string
): Promise<void> {
  const platform = Capacitor.getPlatform();

  if (platform === 'ios' || platform === 'android') {
    // Use Capacitor Share API for mobile
    const { Share } = await import('@capacitor/share');
    const { Filesystem, Directory } = await import('@capacitor/filesystem');

    // Convert to base64 in chunks to avoid stack overflow
    const CHUNK_SIZE = 0x8000; // 32k characters
    let binary = '';
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      binary += String.fromCharCode.apply(
        null,
        Array.from(data.subarray(i, i + CHUNK_SIZE))
      );
    }
    const base64Data = btoa(binary);

    // Write to cache directory
    const result = await Filesystem.writeFile({
      path: filename,
      data: base64Data,
      directory: Directory.Cache
    });

    // Share the file
    await Share.share({
      title: 'Database Backup',
      url: result.uri,
      dialogTitle: 'Save Backup'
    });
  } else {
    // Web and Electron: use browser download
    downloadFile(data, filename);
  }
}
