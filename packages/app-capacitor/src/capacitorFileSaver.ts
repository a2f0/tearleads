import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { FileSaver, SaveFileRequest } from "@tearleads/client-sdk";
import { bytesToBase64 } from "@tearleads/encoding";

// Capacitor runs inside a WebView (iOS WKWebView / Android System WebView) that
// has no browser download destination, so the shared app's anchor-based saver
// clicks into the void. The native equivalent of a "download" is: write the
// bytes to a file the OS can reach, then open the share sheet so the user routes
// it to Files/Photos, another app, AirDrop, etc. We stage the file in the app's
// cache (the OS may reclaim it, which is fine — it only has to survive the
// share) and clean it up afterwards.

// The cache path is relative to the app's cache directory. A blob's name can be
// a raw storage key containing slashes; collapse path separators so we write a
// single flat file rather than accidental subdirectories, and never an empty
// name.
function sanitizeFileName(fileName: string): string {
  const flattened = fileName.trim().replace(/[/\\]+/gu, "_");
  return flattened.length > 0 ? flattened : "download";
}

// The user dismissing the share sheet rejects with a cancellation, which is a
// normal outcome for a download prompt, not a failure to surface.
function isShareCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("cancel");
}

export function createCapacitorFileSaver(): FileSaver {
  return {
    async saveFile(request: SaveFileRequest): Promise<void> {
      const path = sanitizeFileName(request.fileName);
      const { uri } = await Filesystem.writeFile({
        data: bytesToBase64(request.data),
        directory: Directory.Cache,
        path,
        recursive: true,
      });
      try {
        await Share.share({
          dialogTitle: `Save ${request.fileName}`,
          title: request.fileName,
          url: uri,
        });
      } catch (error) {
        if (!isShareCancellation(error)) {
          throw error;
        }
      } finally {
        // Best-effort cleanup so repeated downloads don't accumulate in the
        // cache. Share has resolved by now, so the staged copy has been
        // consumed; a failure here is not user-visible.
        void Filesystem.deleteFile({ directory: Directory.Cache, path }).catch(
          () => undefined,
        );
      }
    },
  };
}
