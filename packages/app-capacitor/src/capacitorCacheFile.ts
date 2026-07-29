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

export async function deleteCacheFilesWithPrefix(
  prefix: string,
): Promise<void> {
  const { files } = await Filesystem.readdir({
    directory: Directory.Cache,
    path: "",
  });
  await Promise.all(
    files
      .filter((file) => file.type === "file" && file.name.startsWith(prefix))
      .map((file) => deleteCacheFile(file.name)),
  );
}
