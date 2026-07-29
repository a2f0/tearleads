import { Capacitor } from "@capacitor/core";
import { FileViewer as NativeFileViewer } from "@capacitor/file-viewer";
import type { FileViewer } from "app/host/AppHostConfig";
import { deleteCacheFile, writeCacheFile } from "./capacitorCacheFile";

/**
 * Presents a locally decrypted file through the OS without bundling a renderer.
 * Android launches a file intent, so its cache copy must outlive this promise;
 * the OS owns Cache eviction. iOS resolves after its document preview closes,
 * allowing immediate cleanup there.
 */
export function createCapacitorFileViewer(): FileViewer {
  return {
    async viewFile(request) {
      const staged = await writeCacheFile(request, "preview_");
      try {
        await NativeFileViewer.openDocumentFromLocalPath({ path: staged.uri });
      } catch (error) {
        void deleteCacheFile(staged.path).catch(() => undefined);
        throw error;
      }

      if (Capacitor.getPlatform() !== "android") {
        void deleteCacheFile(staged.path).catch(() => undefined);
      }
    },
  };
}
