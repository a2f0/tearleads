/**
 * File utilities for backup/restore operations.
 */

import { Capacitor } from '@capacitor/core';
import { assertPlainArrayBuffer } from '@rapid/shared';

/**
 * Compute SHA-256 hash of file data.
 * Used for deduplication and integrity verification.
 */
export async function computeContentHash(data: Uint8Array): Promise<string> {
  assertPlainArrayBuffer(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a backup filename with timestamp.
 * Format: rapid-backup-YYYY-MM-DD-HHmmss.db
 */
export function generateBackupFilename(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `rapid-backup-${year}-${month}-${day}-${hours}${minutes}${seconds}.db`;
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
