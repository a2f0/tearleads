type DownloadLinks = { installerUrl: string; checksumUrl: string };
type FetchDownload = (url: string, init?: RequestInit) => Promise<Response>;

export async function resolveMacosDownloads(
  staging: boolean,
  request: FetchDownload = fetch,
): Promise<DownloadLinks> {
  const bucket = staging
    ? "downloads-staging.tearleads.com"
    : "downloads.tearleads.com";
  const base = `https://s3.us-east-1.amazonaws.com/${bucket}`;
  const prefix = `${staging ? "canary" : "stable"}-macos-arm64`;
  const appName = staging ? "Tearleads-canary" : "Tearleads";
  // A verified, immutable first release keeps offline website builds usable.
  const initialHash = staging
    ? "afc6e1930ba8bd0b7f11d358e1e042b2b71264102afd4bb4f7e82abfdde59135"
    : "5f346b3e19a09aa06af8d37330732858ec5cf14746c4e4c0abfcfd6fd510ff2a";
  let installer = `${prefix}-${initialHash}-${appName}.dmg`;
  try {
    const response = await request(`${base}/${prefix}-download.json`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Download discovery is unavailable");
    const value: unknown = await response.json();
    if (
      typeof value !== "object" ||
      value === null ||
      !("installer" in value) ||
      typeof value.installer !== "string" ||
      !("checksum" in value) ||
      value.checksum !== `${value.installer}.sha256` ||
      !new RegExp(`^${prefix}-[a-f0-9]{64}-${appName}\\.dmg$`).test(
        value.installer,
      )
    )
      throw new Error("Invalid macOS download discovery");
    installer = value.installer;
  } catch {
    // Keep the matched fallback pair if discovery cannot be verified at build time.
  }
  return {
    installerUrl: `${base}/${installer}`,
    checksumUrl: `${base}/${installer}.sha256`,
  };
}
