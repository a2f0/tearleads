import { Directory, Filesystem } from "@capacitor/filesystem";
import { bytesToBase64 } from "@tearleads/encoding";

interface CacheFileRequest {
  data: Uint8Array<ArrayBuffer>;
  fileName: string;
}

function sanitizeCacheFileName(fileName: string): string {
  const flattened = fileName.trim().replace(/[/\\]+/gu, "_");
  if (flattened.length === 0 || flattened === "." || flattened === "..") {
    return "download";
  }
  return flattened;
}

export async function writeCacheFile(
  request: CacheFileRequest,
  prefix = "",
): Promise<{ path: string; uri: string }> {
  const path = `${prefix}${sanitizeCacheFileName(request.fileName)}`;
  const { uri } = await Filesystem.writeFile({
    data: bytesToBase64(request.data),
    directory: Directory.Cache,
    path,
    recursive: true,
  });
  return { path, uri };
}

export function deleteCacheFile(path: string): Promise<void> {
  return Filesystem.deleteFile({ directory: Directory.Cache, path });
}

async function deleteFilesWithPrefix(
  directory: Directory,
  prefix: string,
): Promise<void> {
  const { files } = await Filesystem.readdir({ directory, path: "" });
  await Promise.all(
    files
      .filter((file) => file.type === "file" && file.name.startsWith(prefix))
      .map((file) => Filesystem.deleteFile({ directory, path: file.name })),
  );
}

export function deleteCacheFilesWithPrefix(prefix: string): Promise<void> {
  return deleteFilesWithPrefix(Directory.Cache, prefix);
}

/**
 * Device reset: removes every file the app staged outside WebView storage,
 * meaning the share and preview copies in the cache directory and the camera
 * captures the scanner reads from the temporary directory. Android keeps both
 * in its cache directory, so the passes run in turn rather than racing to
 * delete the same files. Directories are left alone: the WebView keeps its own
 * caches there.
 */
export async function deleteStagedNativeFiles(): Promise<void> {
  await deleteFilesWithPrefix(Directory.Cache, "");
  await deleteFilesWithPrefix(Directory.Temporary, "");
}
