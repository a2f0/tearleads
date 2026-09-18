import { join } from "node:path";
import { publishDesktopRelease } from "./publishDesktopRelease";
import { verifyWindowsDownload } from "./windowsReleaseArtifacts";

// The caller downloads the source maps and uploads them with local credentials.
// Neither invalid payloads nor an incomplete map upload may reach S3.
export async function publishWindowsRelease(options: {
  artifacts: string;
  tier: string;
  commit: string;
  uploadSourceMaps: () => Promise<void>;
}): Promise<void> {
  const { artifacts, tier, commit, uploadSourceMaps } = options;
  const names = await verifyWindowsDownload(artifacts, tier, commit);
  await uploadSourceMaps();
  await publishDesktopRelease({
    ...names,
    target: "win-x64",
    installer: join(artifacts, names.installer),
    update: join(artifacts, names.update),
    archive: join(artifacts, names.archive),
  });
}
