/**
 * File utilities for backup/restore operations.
 */

import { Capacitor } from '@capacitor/core';

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
  const blob = new Blob([new Uint8Array(data)], {
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

    // Convert to base64
    const base64Data = btoa(String.fromCharCode(...data));

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
