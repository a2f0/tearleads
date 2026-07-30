import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const guardPath = resolve(repositoryRoot, "scripts/rejectDevOnlyUrl.sh");

async function runStoreKeyGuard(key: string, expectedPrefix: string) {
  const process = Bun.spawn(
    [
      "sh",
      "-c",
      '. "$1"; reject_invalid_revenuecat_store_key VITE_REVENUECAT_API_KEY "$2" "$3"',
      "sh",
      guardPath,
      key,
      expectedPrefix,
    ],
    { stderr: "pipe" },
  );
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  return { exitCode, stderr };
}

describe("RevenueCat store-release safety", () => {
  test("rejects an exported Test Store key", async () => {
    const result = await runStoreKeyGuard("test_example", "appl_");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not a RevenueCat platform public SDK key");
  });

  test("rejects a key for the other store", async () => {
    const result = await runStoreKeyGuard("goog_example", "appl_");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("must start with appl_");
  });

  test("allows an unset key for Fastlane to load", async () => {
    await expect(runStoreKeyGuard("", "appl_")).resolves.toEqual({
      exitCode: 0,
      stderr: "",
    });
  });

  test("allows the platform public SDK key", async () => {
    await expect(runStoreKeyGuard("appl_example", "appl_")).resolves.toEqual({
      exitCode: 0,
      stderr: "",
    });
    await expect(runStoreKeyGuard("goog_example", "goog_")).resolves.toEqual({
      exitCode: 0,
      stderr: "",
    });
  });

  const guardedReleaseScripts = {
    "buildAndroidRelease.sh": "VITE_REVENUECAT_ANDROID_API_KEY",
    "buildIosRelease.sh": "VITE_REVENUECAT_IOS_API_KEY",
    "uploadAndroidRelease.sh": "VITE_REVENUECAT_ANDROID_API_KEY",
    "uploadIosRelease.sh": "VITE_REVENUECAT_IOS_API_KEY",
  } as const;

  for (const [scriptName, keyName] of Object.entries(guardedReleaseScripts)) {
    test(`${scriptName} guards ${keyName}`, async () => {
      const script = await Bun.file(
        resolve(repositoryRoot, "scripts", scriptName),
      ).text();
      const normalizedScript = script
        .replace(/\\\n\s*/g, " ")
        .replace(/\s+/g, " ");

      expect(normalizedScript).toContain(
        `reject_invalid_revenuecat_store_key ${keyName} `,
      );
    });
  }

  test("Fastlane validates keys after loading release secrets", async () => {
    const androidFastfile = await Bun.file(
      resolve(
        repositoryRoot,
        "packages/app-capacitor/fastlane/Fastfile.android.rb",
      ),
    ).text();
    const iosFastfile = await Bun.file(
      resolve(
        repositoryRoot,
        "packages/app-capacitor/fastlane/Fastfile.ios.rb",
      ),
    ).text();

    expect(androidFastfile).toContain(
      "ensure_revenuecat_store_key!('VITE_REVENUECAT_ANDROID_API_KEY', 'goog_')",
    );
    expect(iosFastfile).toContain(
      "ensure_revenuecat_store_key!('VITE_REVENUECAT_IOS_API_KEY', 'appl_')",
    );
  });
});
