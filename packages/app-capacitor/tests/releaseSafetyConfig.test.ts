import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const guardPath = resolve(repositoryRoot, "scripts/lib/releaseGuards.sh");
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

async function buildNumberSelection(
  platform: "android" | "ios",
  option: string,
) {
  const environment = { ...process.env };
  for (const name of [
    "ANDROID_BUILD_NUMBER",
    "ANDROID_RELEASE_MERGED_DATE",
    "ANDROID_RELEASE_MERGED_PR_NUMBER",
    "ANDROID_RELEASE_NEXT_GOOGLE_PLAY",
    "ANDROID_RELEASE_PR_NUMBER",
    "ANDROID_VERSION_CODE",
    "APPLE_BUILD_NUMBER",
    "IOS_BUILD_NUMBER",
    "IOS_RELEASE_MERGED_DATE",
    "IOS_RELEASE_MERGED_PR_NUMBER",
    "IOS_RELEASE_NEXT_TESTFLIGHT",
    "IOS_RELEASE_PR_NUMBER",
  ]) {
    Reflect.deleteProperty(environment, name);
  }
  const child = Bun.spawn(
    [
      "sh",
      "-c",
      '. "$1"; if native_release_build_number_chosen "$2" "$3"; then printf chosen; else printf unselected; fi',
      "sh",
      resolve(repositoryRoot, "scripts/release/nativeRelease.sh"),
      platform,
      option,
    ],
    { env: environment, stderr: "pipe", stdout: "pipe" },
  );
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Shell build-number selection failed: ${stderr}`);
  }
  return stdout;
}

async function nativeBunCommand(
  platform: "android" | "ios",
  action: "build" | "upload",
  tier: "production" | "staging",
) {
  const child = Bun.spawn(
    [
      "sh",
      "-c",
      '. "$1"; native_release_bun_command "$2" "$3" "$4"',
      "sh",
      resolve(repositoryRoot, "scripts/release/nativeRelease.sh"),
      platform,
      action,
      tier,
    ],
    { stdout: "pipe" },
  );
  const [exitCode, stdout] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
  ]);
  expect(exitCode).toBe(0);
  return stdout.trim();
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

  const releaseScriptTargets = {
    "buildAndroidRelease.sh": "android build production",
    "buildAndroidStagingRelease.sh": "android build staging",
    "buildIosRelease.sh": "ios build production",
    "buildIosStagingRelease.sh": "ios build staging",
    "uploadAndroidRelease.sh": "android upload production",
    "uploadAndroidStagingRelease.sh": "android upload staging",
    "uploadIosRelease.sh": "ios upload production",
    "uploadIosStagingRelease.sh": "ios upload staging",
  } as const;

  for (const [scriptName, target] of Object.entries(releaseScriptTargets)) {
    test(`${scriptName} delegates to the shared ${target} runner`, async () => {
      const script = await Bun.file(
        resolve(repositoryRoot, "scripts/release", scriptName),
      ).text();

      expect(script).toContain('. "$SCRIPT_DIR/nativeRelease.sh"');
      expect(script).toContain(`native_release_main ${target} "$@"`);
    });
  }

  test("the shared runner guards both platform keys", async () => {
    const script = await Bun.file(
      resolve(repositoryRoot, "scripts/release/nativeRelease.sh"),
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
    expect(script).toContain('export NATIVE_RELEASE_TIER="$native_tier"');
  });

  test("shared runner selects a tier-pinned Fastlane command", async () => {
    await expect(
      nativeBunCommand("android", "build", "production"),
    ).resolves.toBe("android:build-release");
    await expect(
      nativeBunCommand("android", "upload", "staging"),
    ).resolves.toBe("android:upload-release:staging");
    await expect(nativeBunCommand("ios", "build", "staging")).resolves.toBe(
      "ios:build-release:staging",
    );
    await expect(nativeBunCommand("ios", "upload", "production")).resolves.toBe(
      "ios:upload-release",
    );
  });

  test("build-number options are scoped to their store platform", async () => {
    for (const platform of ["android", "ios"] as const) {
      await expect(
        buildNumberSelection(platform, "build_number:42"),
      ).resolves.toBe("chosen");
    }
    await expect(
      buildNumberSelection("android", "next_google_play:true"),
    ).resolves.toBe("chosen");
    await expect(
      buildNumberSelection("android", "next_testflight:true"),
    ).resolves.toBe("unselected");
    await expect(
      buildNumberSelection("ios", "next_testflight:true"),
    ).resolves.toBe("chosen");
    await expect(
      buildNumberSelection("ios", "next_google_play:true"),
    ).resolves.toBe("unselected");
  });
});
