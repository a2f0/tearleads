import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const guardPath = resolve(repositoryRoot, "scripts/releaseGuards.sh");
const fastlaneGuardPath = resolve(
  repositoryRoot,
  "packages/app-capacitor/fastlane/revenuecat_release_key.rb",
);

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

async function readFastlaneKeyProblem(key: string, expectedPrefix: string) {
  const process = Bun.spawn(
    [
      "ruby",
      "-r",
      fastlaneGuardPath,
      "-e",
      "print(revenuecat_store_key_problem(ARGV.fetch(0), ARGV.fetch(1)) || 'ok')",
      key,
      expectedPrefix,
    ],
    { stderr: "pipe", stdout: "pipe" },
  );
  const [exitCode, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ]);
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
  return stdout;
}

describe("RevenueCat store-release safety", () => {
  test("rejects an exported Test Store key", async () => {
    const result = await runStoreKeyGuard("test_example", "appl_");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not a RevenueCat platform public SDK key");
  });

  test("rejects a key for the other store", async () => {
    const result = await runStoreKeyGuard("goog_example", "appl_");
    const prefixOnly = await runStoreKeyGuard("appl_", "appl_");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("must start with appl_");
    expect(prefixOnly.exitCode).toBe(1);
    expect(prefixOnly.stderr).toContain("must start with appl_");
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

  test("Fastlane rejects missing, prefix-only, and wrong-platform keys", async () => {
    await expect(readFastlaneKeyProblem("", "appl_")).resolves.toBe(
      "is missing",
    );
    await expect(readFastlaneKeyProblem("appl_", "appl_")).resolves.toBe(
      "must start with appl_",
    );
    await expect(readFastlaneKeyProblem("goog_example", "appl_")).resolves.toBe(
      "must start with appl_",
    );
    await expect(readFastlaneKeyProblem("appl_example", "appl_")).resolves.toBe(
      "ok",
    );
  });

  const releaseScriptTargets = {
    "buildAndroidRelease.sh": "android build production",
    "buildIosRelease.sh": "ios build production",
    "uploadAndroidRelease.sh": "android upload production",
    "uploadAndroidStagingRelease.sh": "android upload staging",
    "uploadIosRelease.sh": "ios upload production",
    "uploadIosStagingRelease.sh": "ios upload staging",
  } as const;

  for (const [scriptName, target] of Object.entries(releaseScriptTargets)) {
    test(`${scriptName} delegates to the shared ${target} runner`, async () => {
      const script = await Bun.file(
        resolve(repositoryRoot, "scripts", scriptName),
      ).text();

      expect(script).toContain('. "$SCRIPT_DIR/nativeRelease.sh"');
      expect(script).toContain(`native_release_main ${target} "$@"`);
    });
  }

  test("the shared runner guards both platform keys", async () => {
    const script = await Bun.file(
      resolve(repositoryRoot, "scripts/nativeRelease.sh"),
    ).text();
    const normalizedScript = script
      .replace(/\\\n\s*/g, " ")
      .replace(/\s+/g, " ");

    expect(normalizedScript).toContain(
      `reject_invalid_revenuecat_store_key VITE_REVENUECAT_ANDROID_API_KEY "\${VITE_REVENUECAT_ANDROID_API_KEY:-}" goog_`,
    );
    expect(normalizedScript).toContain(
      `reject_invalid_revenuecat_store_key VITE_REVENUECAT_IOS_API_KEY "\${VITE_REVENUECAT_IOS_API_KEY:-}" appl_`,
    );
  });

  test("staging API defaults stay out of production wrappers", async () => {
    const sharedRunner = await Bun.file(
      resolve(repositoryRoot, "scripts/nativeRelease.sh"),
    ).text();

    expect(sharedRunner).toContain(
      '[ "$native_tier" = staging ] && native_default_api="https://api.tearleads.de"',
    );
    expect(sharedRunner).toContain('export NATIVE_RELEASE_TIER="$native_tier"');
  });

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
    const androidLoadIndex = androidFastfile.indexOf(
      "    load_android_release_secrets_env",
    );
    const androidGuardIndex = androidFastfile.indexOf(
      "    ensure_revenuecat_store_key!('VITE_REVENUECAT_ANDROID_API_KEY', 'goog_')",
    );
    const iosLoadIndex = iosFastfile.indexOf(
      "    load_ios_release_secrets_env",
    );
    const iosGuardIndex = iosFastfile.indexOf(
      "    ensure_revenuecat_store_key!('VITE_REVENUECAT_IOS_API_KEY', 'appl_')",
    );

    expect(androidLoadIndex).toBeGreaterThan(-1);
    expect(androidGuardIndex).toBeGreaterThan(androidLoadIndex);
    expect(iosLoadIndex).toBeGreaterThan(-1);
    expect(iosGuardIndex).toBeGreaterThan(iosLoadIndex);
  });
});
