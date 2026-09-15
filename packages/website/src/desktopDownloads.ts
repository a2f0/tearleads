type DownloadLinks = { installerUrl: string; checksumUrl: string };
export type FetchDownload = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export async function resolveDesktopDownload(
  staging: boolean,
  target: "macos-arm64" | "linux-x64",
  initialHash: string,
  request: FetchDownload = fetch,
): Promise<DownloadLinks> {
  const bucket = staging
    ? "downloads-staging.tearleads.com"
    : "downloads.tearleads.com";
  const base = `https://s3.us-east-1.amazonaws.com/${bucket}`;
  const prefix = `${staging ? "canary" : "stable"}-${target}`;
  const appName = staging
    ? target === "macos-arm64"
      ? "TLStaging-canary"
      : "Tearleads-canary"
    : "Tearleads";
  const extension = target === "macos-arm64" ? ".dmg" : "-Setup.tar.gz";
  const extensionPattern = extension.replaceAll(".", "\\.");
  let installer = `${prefix}-${initialHash}-${appName}${extension}`;
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
      !new RegExp(
        `^${prefix}-[a-f0-9]{64}-${appName}${extensionPattern}$`,
      ).test(value.installer)
    )
      throw new Error("Invalid desktop download discovery");
    installer = value.installer;
  } catch {
    // Keep the matched fallback pair if discovery cannot be verified at build time.
  }
  return {
    installerUrl: `${base}/${installer}`,
    checksumUrl: `${base}/${installer}.sha256`,
  };
}
