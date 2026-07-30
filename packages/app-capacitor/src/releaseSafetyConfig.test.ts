import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const guardPath = resolve(repositoryRoot, "scripts/rejectDevOnlyUrl.sh");

async function runTestStoreGuard(key: string) {
  const process = Bun.spawn(
    [
      "sh",
      "-c",
      '. "$1"; reject_test_store_key VITE_REVENUECAT_API_KEY "$2"',
      "sh",
      guardPath,
      key,
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
    const result = await runTestStoreGuard("test_example");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("RevenueCat Test Store key");
  });

  test("allows platform public SDK keys", async () => {
    await expect(runTestStoreGuard("appl_example")).resolves.toEqual({
      exitCode: 0,
      stderr: "",
    });
    await expect(runTestStoreGuard("goog_example")).resolves.toEqual({
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

      expect(script).toContain(`reject_test_store_key ${keyName}`);
    });
  }
});
