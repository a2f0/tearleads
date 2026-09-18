import { type FetchDownload, resolveDesktopDownload } from "./desktopDownloads";

export function resolveWindowsDownloads(
  staging: boolean,
  request: FetchDownload = fetch,
) {
  // Until a first release is published, hide unavailable downloads. Never invent
  // a fallback hash or link to a mutable installer with a mismatched checksum.
  return resolveDesktopDownload(staging, "win-x64", undefined, request);
}
