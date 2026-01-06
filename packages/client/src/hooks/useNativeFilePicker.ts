/**
 * Hook for picking files using native file picker on iOS.
 * Falls back to standard HTML input on other platforms.
 */

import { FilePicker, type PickedFile } from '@capawesome/capacitor-file-picker';
import { useCallback } from 'react';
import { detectPlatform } from '@/lib/utils';

export type FilePickerSource = 'files' | 'photos' | 'media';

export interface NativeFilePickerOptions {
  /** MIME types to accept (e.g., 'audio/*', 'image/*'). Only used when source is 'files'. */
  accept?: string | undefined;
  /** Allow multiple file selection */
  multiple?: boolean | undefined;
  /**
   * The source to pick files from:
   * - 'files': Document picker (Files app) - default
   * - 'photos': Photo library (images only)
   * - 'media': Photo library (images and videos)
   */
  source?: FilePickerSource | undefined;
}

export interface NativeFilePickerResult {
  files: File[];
}

/**
 * Convert a PickedFile from the Capacitor plugin to a standard File object.
 */
async function pickedFileToFile(picked: PickedFile): Promise<File> {
  if (!picked.data) {
    throw new Error(`No data returned for file: ${picked.name}`);
  }

  // Use fetch with data URL for efficient base64 to blob conversion
  const response = await fetch(`data:${picked.mimeType};base64,${picked.data}`);
  const blob = await response.blob();
  return new File([blob], picked.name, { type: blob.type });
}

/**
 * Parse accept string into array of MIME types for the native picker.
 * Handles formats like "audio/*", "image/*,video/*", ".mp3,.wav"
 */
function parseAcceptTypes(accept?: string): string[] {
  if (!accept) return [];

  return accept
    .split(',')
    .map((type) => type.trim())
    .filter((type) => type.length > 0);
}

export function useNativeFilePicker() {
  const platform = detectPlatform();

  const pickFiles = useCallback(
    async (options: NativeFilePickerOptions = {}): Promise<File[] | null> => {
      // Only use native picker on iOS
      if (platform !== 'ios') {
        return null; // Signal to use fallback (HTML input)
      }

      const source = options.source ?? 'files';
      const limit = options.multiple ? 0 : 1;

      let result: { files: PickedFile[] };

      if (source === 'photos') {
        // Use photo library picker for images only
        result = await FilePicker.pickImages({
          limit,
          readData: true
        });
      } else if (source === 'media') {
        // Use photo library picker for images and videos
        result = await FilePicker.pickMedia({
          limit,
          readData: true
        });
      } else {
        // Use document picker (Files app) for other file types
        const types = parseAcceptTypes(options.accept);
        result = await FilePicker.pickFiles({
          ...(types.length > 0 ? { types } : {}),
          limit,
          readData: true
        });
      }

      if (!result.files || result.files.length === 0) {
        return [];
      }

      const files = await Promise.all(result.files.map(pickedFileToFile));
      return files;
    },
    [platform]
  );

  return {
    pickFiles,
    isNativePicker: platform === 'ios'
  };
}
