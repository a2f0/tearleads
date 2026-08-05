import { Share } from "@capacitor/share";
import type { FileSaver, SaveFileRequest } from "@tearleads/client-sdk";
import { deleteCacheFile, writeCacheFile } from "./capacitorCacheFile";

// Capacitor runs inside a WebView (iOS WKWebView / Android System WebView) that
// has no browser download destination, so the shared app's anchor-based saver
// clicks into the void. The native equivalent of a "download" is: write the
// bytes to a file the OS can reach, then open the share sheet so the user routes
// it to Files/Photos, another app, AirDrop, etc. We stage the file in the app's
// cache (the OS may reclaim it, which is fine — it only has to survive the
// share) and clean it up afterwards.

// The user dismissing the share sheet rejects with a cancellation, which is a
// normal outcome for a download prompt, not a failure to surface.
function isShareCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("cancel");
}

export function createCapacitorFileSaver(): FileSaver {
  return {
    async saveFile(request: SaveFileRequest): Promise<void> {
      const { path, uri } = await writeCacheFile(request);
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
        void deleteCacheFile(path).catch(() => undefined);
      }
    },
  };
}
