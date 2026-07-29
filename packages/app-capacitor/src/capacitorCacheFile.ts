import { Directory, Filesystem } from "@capacitor/filesystem";
import { bytesToBase64 } from "@tearleads/encoding";
import type { ViewFileRequest } from "app/host/AppHostConfig";

function sanitizeCacheFileName(fileName: string): string {
  const flattened = fileName.trim().replace(/[/\\]+/gu, "_");
  if (flattened.length === 0 || flattened === "." || flattened === "..") {
    return "download";
  }
  return flattened;
}

export async function writeCacheFile(
  request: ViewFileRequest,
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
