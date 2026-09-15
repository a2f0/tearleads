import { type FetchDownload, resolveDesktopDownload } from "./desktopDownloads";

export function resolveMacosDownloads(
  staging: boolean,
  request: FetchDownload = fetch,
) {
  // Verified immutable releases keep offline website builds usable.
  const hash = staging
    ? "5b1981e3d1d11afa6d4c321efe878f5f143fbaccd1603194df630db2d5a41ba2"
    : "5f346b3e19a09aa06af8d37330732858ec5cf14746c4e4c0abfcfd6fd510ff2a";
  return resolveDesktopDownload(staging, "macos-arm64", hash, request);
}
