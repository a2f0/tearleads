import { Capacitor } from "@capacitor/core";
import { FileViewer as NativeFileViewer } from "@capacitor/file-viewer";
import type { FileViewer } from "app/host/AppHostConfig";
import {
  deleteCacheFile,
  deleteCacheFilesWithPrefix,
  writeCacheFile,
} from "./capacitorCacheFile";

const PREVIEW_CACHE_PREFIX = "preview_";
let previewSequence = 0;

function nextPreviewCachePrefix(): string {
  previewSequence += 1;
  return `${PREVIEW_CACHE_PREFIX}${Date.now().toString(36)}_${previewSequence.toString(36)}_`;
}

/**
 * Presents a locally decrypted file through the OS without bundling a renderer.
 * Android launches a file intent, so its cache copy must outlive this promise.
 * Startup cleanup removes copies left by the prior app session. On iOS the
 * plugin's IONFileViewerLib completion resolves after the document preview
 * closes, allowing immediate cleanup; re-check that contract on plugin bumps.
 */
export function createCapacitorFileViewer(): FileViewer {
  const startupCleanup = deleteCacheFilesWithPrefix(PREVIEW_CACHE_PREFIX).catch(
    () => undefined,
  );
  let priorAndroidPreviewPath: string | null = null;
  let pendingView = Promise.resolve();

  return {
    viewFile(request) {
      const view = pendingView.then(async () => {
        await startupCleanup;
        if (Capacitor.getPlatform() === "android" && priorAndroidPreviewPath) {
          await deleteCacheFile(priorAndroidPreviewPath).catch(() => undefined);
          priorAndroidPreviewPath = null;
        }

        const staged = await writeCacheFile(request, nextPreviewCachePrefix());
        try {
          await NativeFileViewer.openDocumentFromLocalPath({
            path: staged.uri,
          });
        } catch (error) {
          void deleteCacheFile(staged.path).catch(() => undefined);
          throw error;
        }

        if (Capacitor.getPlatform() === "android") {
          priorAndroidPreviewPath = staged.path;
        } else {
          void deleteCacheFile(staged.path).catch(() => undefined);
        }
      });
      pendingView = view.catch(() => undefined);
      return view;
    },
  };
}
