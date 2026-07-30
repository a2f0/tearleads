import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const guardPath = resolve(repositoryRoot, "scripts/releaseGuards.sh");
const fastlaneGuardPath = resolve(
  repositoryRoot,
  "packages/app-capacitor/fastlane/revenuecat_release_key.rb",
);
const capacitorReleaseConfigPath = resolve(
  repositoryRoot,
  "packages/app-capacitor/fastlane/capacitor_release_config.rb",
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

async function readFastlaneKeyProblem(
  key: string,
  expectedPrefix: string,
  productionValue = "",
  releaseTier = "staging",
) {
  const process = Bun.spawn(
    [
      "ruby",
      "-r",
      fastlaneGuardPath,
      "-e",
      "print(revenuecat_store_key_problem(ARGV.fetch(0), ARGV.fetch(1), production_value: ARGV.fetch(2), release_tier: ARGV.fetch(3)) || 'ok')",
      key,
      expectedPrefix,
      productionValue,
      releaseTier,
    ],
    { stderr: "pipe", stdout: "pipe" },
  );
  const [exitCode, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Ruby key validation failed: ${stderr}`);
  }
  return stdout;
}

async function readCapacitorReleaseProblem(
  appId: string,
  expectedAppId: string,
  serverUrl = "",
) {
  const process = Bun.spawn(
    [
      "ruby",
      "-r",
      capacitorReleaseConfigPath,
      "-e",
      "print(capacitor_release_problem({'appId' => ARGV.fetch(0), 'server' => {'url' => ARGV.fetch(2)}}, ARGV.fetch(1)) || 'ok')",
      appId,
      expectedAppId,
      serverUrl,
    ],
    { stderr: "pipe", stdout: "pipe" },
  );
  const [exitCode, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Ruby Capacitor release validation failed: ${stderr}`);
  }
  return stdout;
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
      resolve(repositoryRoot, "scripts/nativeRelease.sh"),
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

async function nativeDefaultApi(tier: "production" | "staging") {
  const child = Bun.spawn(
    [
      "sh",
      "-c",
      '. "$1"; native_release_default_api "$2"',
      "sh",
      resolve(repositoryRoot, "scripts/nativeRelease.sh"),
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
      resolve(repositoryRoot, "scripts/nativeRelease.sh"),
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

async function runTierHostGuard(
  name: "VITE_API_BASE_URL" | "VITE_WS_URL",
  tier: "production" | "staging",
  url: string,
) {
  const child = Bun.spawn(
    [
      "sh",
      "-c",
      '. "$1"; native_release_require_tier_host "$2" "$3" "$4"',
      "sh",
      resolve(repositoryRoot, "scripts/nativeRelease.sh"),
      name,
      tier,
      url,
    ],
    { stderr: "pipe" },
  );
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
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
    await expect(
      readFastlaneKeyProblem(
        "appl_example",
        "appl_",
        "appl_example",
        "production",
      ),
    ).resolves.toBe("ok");
    await expect(
      readFastlaneKeyProblem("appl_production", "appl_", "appl_production"),
    ).resolves.toContain("matches the production key");
    await expect(
      readFastlaneKeyProblem("appl_staging", "appl_"),
    ).resolves.toContain("production key is unavailable");
    await expect(
      readFastlaneKeyProblem(
        "appl_staging",
        "appl_",
        "appl_production",
        "production",
      ),
    ).resolves.toContain("does not match the production key");
    await expect(
      readFastlaneKeyProblem("appl_production", "appl_", "", "production"),
    ).resolves.toContain("production key is unavailable");
    await expect(
      readFastlaneKeyProblem("appl_example", "appl_", "appl_root", "preview"),
    ).resolves.toContain("unknown release tier");
  });

  test("Fastlane rejects a generated config for the wrong native target", async () => {
    await expect(
      readCapacitorReleaseProblem(
        "com.tearleads.app",
        "com.tearleads.app.staging",
      ),
    ).resolves.toContain('instead of "com.tearleads.app.staging"');
    await expect(
      readCapacitorReleaseProblem(
        "com.tearleads.app.staging",
        "com.tearleads.app.staging",
      ),
    ).resolves.toBe("ok");
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
    expect(script).toContain('export NATIVE_RELEASE_TIER="$native_tier"');
  });

  test("native API defaults are tier-specific", async () => {
    await expect(nativeDefaultApi("production")).resolves.toBe(
      "https://api.tearleads.com",
    );
    await expect(nativeDefaultApi("staging")).resolves.toBe(
      "https://api.tearleads.de",
    );
  });

  test("shared runner selects a tier-pinned Fastlane command", async () => {
    await expect(
      nativeBunCommand("android", "build", "production"),
    ).resolves.toBe("android:build:google-play");
    await expect(
      nativeBunCommand("android", "upload", "staging"),
    ).resolves.toBe("android:upload:google-play:staging");
    await expect(nativeBunCommand("ios", "build", "staging")).resolves.toBe(
      "ios:build:testflight:staging",
    );
    await expect(nativeBunCommand("ios", "upload", "production")).resolves.toBe(
      "ios:upload:testflight",
    );
  });

  test("native releases reject the other tier's API", async () => {
    const stagingWrongUrls = [
      "https://api.tearleads.com/",
      "https://api.tearleads.com:443",
      "https://API.tearleads.com",
      "https://api.tearleads.com/v1",
    ];
    const stagingWrong = await Promise.all(
      stagingWrongUrls.map((url) =>
        runTierHostGuard("VITE_API_BASE_URL", "staging", url),
      ),
    );
    const productionWrong = await runTierHostGuard(
      "VITE_API_BASE_URL",
      "production",
      "https://api.tearleads.de",
    );
    const stagingSocketWrong = await runTierHostGuard(
      "VITE_WS_URL",
      "staging",
      "wss://api.tearleads.com/v1/events",
    );
    const deceptiveStagingSocket = await runTierHostGuard(
      "VITE_WS_URL",
      "staging",
      "wss://tearleads.de.example/socket",
    );
    const stagingUnknown = await runTierHostGuard(
      "VITE_API_BASE_URL",
      "staging",
      "https://tearleads.com",
    );
    const stagingCorrect = await runTierHostGuard(
      "VITE_API_BASE_URL",
      "staging",
      "https://api.tearleads.de",
    );
    const stagingSocketCorrect = await runTierHostGuard(
      "VITE_WS_URL",
      "staging",
      "wss://events.tearleads.de/socket",
    );
    const productionSocketCorrect = await runTierHostGuard(
      "VITE_WS_URL",
      "production",
      "wss://events.tearleads.com/socket",
    );
    const emptySocket = await runTierHostGuard("VITE_WS_URL", "staging", "");

    for (const result of stagingWrong) {
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("must use api.tearleads.de");
    }
    expect(productionWrong.exitCode).toBe(1);
    expect(productionWrong.stderr).toContain("must use api.tearleads.com");
    expect(stagingSocketWrong.exitCode).toBe(1);
    expect(stagingSocketWrong.stderr).toContain("VITE_WS_URL");
    expect(deceptiveStagingSocket.exitCode).toBe(1);
    expect(stagingUnknown.exitCode).toBe(1);
    expect(stagingCorrect.exitCode).toBe(0);
    expect(stagingSocketCorrect.exitCode).toBe(0);
    expect(productionSocketCorrect.exitCode).toBe(0);
    expect(emptySocket.exitCode).toBe(0);
  });

  test("build-number options are scoped to their store platform", async () => {
    await expect(
      buildNumberSelection("android", "version_code:42"),
    ).resolves.toBe("chosen");
    await expect(
      buildNumberSelection("android", "next_testflight:true"),
    ).resolves.toBe("unselected");
    await expect(
      buildNumberSelection("ios", "apple_build_number:42"),
    ).resolves.toBe("chosen");
    await expect(
      buildNumberSelection("ios", "next_google_play:true"),
    ).resolves.toBe("unselected");
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
      "    ensure_revenuecat_store_key!(",
    );
    const iosLoadIndex = iosFastfile.indexOf(
      "    load_ios_release_secrets_env",
    );
    const iosGuardIndex = iosFastfile.indexOf(
      "    ensure_revenuecat_store_key!(",
    );

    expect(androidLoadIndex).toBeGreaterThan(-1);
    expect(androidGuardIndex).toBeGreaterThan(androidLoadIndex);
    expect(androidFastfile).toContain(
      "native_release_production_store_key('VITE_REVENUECAT_ANDROID_API_KEY')",
    );
    expect(androidFastfile).toContain("production_value:");
    expect(androidFastfile).toContain("release_tier: NATIVE_RELEASE_TIER");
    expect(iosLoadIndex).toBeGreaterThan(-1);
    expect(iosGuardIndex).toBeGreaterThan(iosLoadIndex);
    expect(iosFastfile).toContain(
      "native_release_production_store_key('VITE_REVENUECAT_IOS_API_KEY')",
    );
    expect(iosFastfile).toContain("production_value:");
    expect(iosFastfile).toContain("release_tier: NATIVE_RELEASE_TIER");
  });
});
