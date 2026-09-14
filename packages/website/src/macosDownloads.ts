import { type FetchDownload, resolveDesktopDownload } from "./desktopDownloads";

export function resolveMacosDownloads(
  staging: boolean,
  request: FetchDownload = fetch,
) {
  // Verified immutable releases keep offline website builds usable.
  const hash = staging
    ? "afc6e1930ba8bd0b7f11d358e1e042b2b71264102afd4bb4f7e82abfdde59135"
    : "5f346b3e19a09aa06af8d37330732858ec5cf14746c4e4c0abfcfd6fd510ff2a";
  return resolveDesktopDownload(staging, "macos-arm64", hash, request);
}
