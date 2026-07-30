import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const guardPath = resolve(repositoryRoot, "scripts/releaseGuards.sh");
const fastlaneGuardPath = resolve(
  repositoryRoot,
  "packages/app-capacitor/fastlane/revenuecat_release_key.rb",
);
const nativeReleaseTargetPath = resolve(
  repositoryRoot,
  "packages/app-capacitor/fastlane/native_release_target.rb",
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
  disallowedValue = "",
) {
  const process = Bun.spawn(
    [
      "ruby",
      "-r",
      fastlaneGuardPath,
      "-e",
      "print(revenuecat_store_key_problem(ARGV.fetch(0), ARGV.fetch(1), ARGV.fetch(2)) || 'ok')",
      key,
      expectedPrefix,
      disallowedValue,
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

interface NativeReleaseSnapshot {
  androidBuildVariant: string;
  appIdentifier: string;
  environment: Array<string | null>;
  iosConfiguration: string;
  iosScheme: string;
}

async function readNativeReleaseEnvironment(
  rootEnv: string,
  stagingEnv: string,
  processEnvironment: Record<string, string> = {},
  tier: string | null = "staging",
) {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "tearleads-native-release-target-"),
  );
  const copiedTargetPath = join(
    temporaryRoot,
    "packages/app-capacitor/fastlane/native_release_target.rb",
  );
  const secretsDirectory = join(temporaryRoot, ".secrets");
  await mkdir(resolve(copiedTargetPath, ".."), { recursive: true });
  await mkdir(secretsDirectory, { recursive: true });
  await Promise.all([
    Bun.write(copiedTargetPath, Bun.file(nativeReleaseTargetPath)),
    Bun.write(join(secretsDirectory, "root.env"), rootEnv),
    Bun.write(join(secretsDirectory, "staging.env"), stagingEnv),
  ]);

  const environment = { ...process.env };
  for (const name of [
    "DEEPSEEK_API_KEY",
    "NATIVE_RELEASE_TIER",
    "NATIVE_TEST_VALUE",
    "VITE_REVENUECAT_ANDROID_API_KEY",
    "VITE_REVENUECAT_IOS_API_KEY",
    "VITE_REVENUECAT_SYNC_ENTITLEMENT",
    "VITE_WS_URL",
  ]) {
    Reflect.deleteProperty(environment, name);
  }
  Object.assign(environment, processEnvironment);
  if (tier !== null) {
    Object.assign(environment, { NATIVE_RELEASE_TIER: tier });
  }

  try {
    const child = Bun.spawn(
      [
        "bundle",
        "exec",
        "ruby",
        "-r",
        copiedTargetPath,
        "-r",
        "json",
        "-e",
        "load_native_release_secrets_env; names = %w[VITE_REVENUECAT_IOS_API_KEY VITE_REVENUECAT_ANDROID_API_KEY VITE_REVENUECAT_SYNC_ENTITLEMENT VITE_WS_URL NATIVE_TEST_VALUE DEEPSEEK_API_KEY]; print JSON.generate({ environment: names.map { |name| ENV[name] }, appIdentifier: NATIVE_APP_IDENTIFIER, androidBuildVariant: NATIVE_RELEASE_TARGET.fetch(:android_build_variant), iosScheme: NATIVE_RELEASE_TARGET.fetch(:ios_scheme), iosConfiguration: NATIVE_RELEASE_TARGET.fetch(:ios_configuration) })",
      ],
      {
        cwd: resolve(repositoryRoot, "packages/app-capacitor"),
        env: environment,
        stderr: "pipe",
        stdout: "pipe",
      },
    );
    const [exitCode, stderr, stdout] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ]);
    if (exitCode !== 0) {
      throw new Error(`Ruby native release target failed: ${stderr}`);
    }
    return JSON.parse(stdout) as NativeReleaseSnapshot;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
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
    await expect(
      readFastlaneKeyProblem("appl_production", "appl_", "appl_production"),
    ).resolves.toContain("matches the production key");
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

  test("staging imports only its allowlisted native public keys", async () => {
    const snapshot = await readNativeReleaseEnvironment(
      "VITE_REVENUECAT_IOS_API_KEY=appl_root\nVITE_REVENUECAT_ANDROID_API_KEY=goog_root\nVITE_REVENUECAT_SYNC_ENTITLEMENT=sync\nVITE_WS_URL=wss://production.example\nNATIVE_TEST_VALUE=root\n",
      "VITE_REVENUECAT_IOS_API_KEY=appl_staging\nVITE_REVENUECAT_ANDROID_API_KEY=goog_staging\nVITE_WS_URL=wss://staging.example\nNATIVE_TEST_VALUE=staging\nDEEPSEEK_API_KEY=server-secret\n",
    );

    expect(snapshot.environment).toEqual([
      "appl_staging",
      "goog_staging",
      "sync",
      null,
      "root",
      null,
    ]);
  });

  test("explicit native release environment values beat dotenv files", async () => {
    const snapshot = await readNativeReleaseEnvironment(
      "VITE_REVENUECAT_IOS_API_KEY=appl_root\nVITE_REVENUECAT_ANDROID_API_KEY=goog_root\nNATIVE_TEST_VALUE=root\n",
      "VITE_REVENUECAT_IOS_API_KEY=appl_staging\nVITE_REVENUECAT_ANDROID_API_KEY=goog_staging\nNATIVE_TEST_VALUE=staging\n",
      {
        NATIVE_TEST_VALUE: "process",
        VITE_REVENUECAT_IOS_API_KEY: "appl_process",
        VITE_WS_URL: "wss://process.example",
      },
    );

    expect(snapshot.environment).toEqual([
      "appl_process",
      "goog_staging",
      null,
      "wss://process.example",
      "process",
      null,
    ]);
  });

  test("staging drops production RevenueCat keys when its dotenv omits them", async () => {
    const snapshot = await readNativeReleaseEnvironment(
      "VITE_REVENUECAT_IOS_API_KEY=appl_root\nVITE_REVENUECAT_ANDROID_API_KEY=goog_root\nNATIVE_TEST_VALUE=root\n",
      "NATIVE_TEST_VALUE=staging\n",
    );

    expect(snapshot.environment).toEqual([
      null,
      null,
      null,
      null,
      "root",
      null,
    ]);
  });

  test("staging can override the shared RevenueCat entitlement", async () => {
    const snapshot = await readNativeReleaseEnvironment(
      "VITE_REVENUECAT_SYNC_ENTITLEMENT=production-sync\n",
      "VITE_REVENUECAT_SYNC_ENTITLEMENT=staging-sync\n",
    );

    expect(snapshot.environment[2]).toBe("staging-sync");
  });

  test("production keeps its default target and root release environment", async () => {
    const snapshot = await readNativeReleaseEnvironment(
      "VITE_REVENUECAT_IOS_API_KEY=appl_root\nVITE_REVENUECAT_ANDROID_API_KEY=goog_root\nVITE_WS_URL=wss://production.example\nNATIVE_TEST_VALUE=root\n",
      "VITE_REVENUECAT_IOS_API_KEY=appl_staging\nDEEPSEEK_API_KEY=server-secret\n",
      {},
      null,
    );

    expect(snapshot).toEqual({
      androidBuildVariant: "release",
      appIdentifier: "com.tearleads.app",
      environment: [
        "appl_root",
        "goog_root",
        null,
        "wss://production.example",
        "root",
        null,
      ],
      iosConfiguration: "Release",
      iosScheme: "App",
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

  test("native API defaults are tier-specific", async () => {
    await expect(nativeDefaultApi("production")).resolves.toBe(
      "https://api.tearleads.com",
    );
    await expect(nativeDefaultApi("staging")).resolves.toBe(
      "https://api.tearleads.de",
    );
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
      "native_release_disallowed_store_key('VITE_REVENUECAT_ANDROID_API_KEY')",
    );
    expect(iosLoadIndex).toBeGreaterThan(-1);
    expect(iosGuardIndex).toBeGreaterThan(iosLoadIndex);
    expect(iosFastfile).toContain(
      "native_release_disallowed_store_key('VITE_REVENUECAT_IOS_API_KEY')",
    );
  });
});
