import { type FetchDownload, resolveDesktopDownload } from "./desktopDownloads";

export function resolveLinuxDownloads(
  staging: boolean,
  request: FetchDownload = fetch,
) {
  // Verified immutable releases keep offline website builds usable.
  const hash = staging
    ? "fa273e0dd28a8cff6cc445a09ecee5392b78c4c37e5616d737b162ee336f44aa"
    : "b8c4fbe30841b23f1acd94f2a1dcd2e5ada3c8dc44f2ec35aa5af4167606035d";
  return resolveDesktopDownload(staging, "linux-x64", hash, request);
}
