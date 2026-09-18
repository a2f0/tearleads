import { expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertWindowsRun,
  verifyWindowsDownload,
  windowsArtifactDigest,
  windowsReleaseNames,
} from "./windowsReleaseArtifacts";

const commit = "a".repeat(40);
const run = {
  event: "workflow_dispatch",
  conclusion: "success",
  head_sha: commit,
  path: ".github/workflows/electrobun-windows.yml",
};
test("publication requires the successful manual workflow at the local commit", () => {
  expect(() => assertWindowsRun(run, commit)).not.toThrow();
  for (const mismatch of [
    { event: "pull_request" },
    { conclusion: "failure" },
    { head_sha: "b".repeat(40) },
    { path: ".github/workflows/ci.yml" },
  ])
    expect(() => assertWindowsRun({ ...run, ...mismatch }, commit)).toThrow();
});

for (const tier of ["staging", "production"]) {
  test(`${tier} downloads validate tier, commit, platform, and every payload digest`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "windows-release-test-"));
    const names = windowsReleaseNames(tier);
    try {
      await Bun.write(join(dir, names.installer), "installer");
      await Bun.write(join(dir, names.archive), "archive");
      await Bun.write(
        join(dir, names.update),
        JSON.stringify({
          channel: names.channel,
          platform: "win",
          arch: "x64",
          identifier: "com.tearleads.app",
        }),
      );
      const sha256 = Object.fromEntries(
        await Promise.all(
          [names.installer, names.archive, names.update].map(async (name) => [
            name,
            await windowsArtifactDigest(join(dir, name)),
          ]),
        ),
      );
      const manifest = { tier, commit, target: "win-x64", sha256 };
      await Bun.write(join(dir, "release.json"), JSON.stringify(manifest));
      expect(await verifyWindowsDownload(dir, tier, commit)).toEqual(names);
      await expect(
        verifyWindowsDownload(dir, tier, "b".repeat(40)),
      ).rejects.toThrow("provenance");
      await expect(
        verifyWindowsDownload(
          dir,
          tier === "staging" ? "production" : "staging",
          commit,
        ),
      ).rejects.toThrow("provenance");
      await Bun.write(join(dir, names.archive), "tampered");
      await expect(verifyWindowsDownload(dir, tier, commit)).rejects.toThrow(
        "checksum",
      );
      await rm(join(dir, names.archive));
      await symlink(join(dir, names.installer), join(dir, names.archive));
      await expect(verifyWindowsDownload(dir, tier, commit)).rejects.toThrow(
        "non-regular",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
