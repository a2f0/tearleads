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

async function readNativeReleaseEnvironment(
  rootEnv: string,
  stagingEnv: string,
  processEnvironment: Record<string, string> = {},
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
  Reflect.deleteProperty(environment, "VITE_REVENUECAT_ANDROID_API_KEY");
  Reflect.deleteProperty(environment, "VITE_REVENUECAT_IOS_API_KEY");
  Reflect.deleteProperty(environment, "NATIVE_TEST_VALUE");
  Object.assign(environment, processEnvironment, {
    NATIVE_RELEASE_TIER: "staging",
  });

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
        "load_native_release_secrets_env; print JSON.generate(%w[VITE_REVENUECAT_IOS_API_KEY VITE_REVENUECAT_ANDROID_API_KEY NATIVE_TEST_VALUE].map { |name| ENV[name] })",
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
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    return JSON.parse(stdout) as [string | null, string | null, string | null];
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function buildNumberSelection(
  platform: "android" | "ios",
  option: string,
) {
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
    { stderr: "pipe", stdout: "pipe" },
  );
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
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

  test("staging dotenv values override root dotenv values", async () => {
    await expect(
      readNativeReleaseEnvironment(
        "VITE_REVENUECAT_IOS_API_KEY=appl_root\nVITE_REVENUECAT_ANDROID_API_KEY=goog_root\nNATIVE_TEST_VALUE=root\n",
        "VITE_REVENUECAT_IOS_API_KEY=appl_staging\nVITE_REVENUECAT_ANDROID_API_KEY=goog_staging\nNATIVE_TEST_VALUE=staging\n",
      ),
    ).resolves.toEqual(["appl_staging", "goog_staging", "staging"]);
  });

  test("explicit native release environment values beat dotenv files", async () => {
    await expect(
      readNativeReleaseEnvironment(
        "VITE_REVENUECAT_IOS_API_KEY=appl_root\nVITE_REVENUECAT_ANDROID_API_KEY=goog_root\nNATIVE_TEST_VALUE=root\n",
        "VITE_REVENUECAT_IOS_API_KEY=appl_staging\nVITE_REVENUECAT_ANDROID_API_KEY=goog_staging\nNATIVE_TEST_VALUE=staging\n",
        {
          NATIVE_TEST_VALUE: "process",
          VITE_REVENUECAT_IOS_API_KEY: "appl_process",
        },
      ),
    ).resolves.toEqual(["appl_process", "goog_staging", "process"]);
  });

  test("staging drops production RevenueCat keys when its dotenv omits them", async () => {
    await expect(
      readNativeReleaseEnvironment(
        "VITE_REVENUECAT_IOS_API_KEY=appl_root\nVITE_REVENUECAT_ANDROID_API_KEY=goog_root\nNATIVE_TEST_VALUE=root\n",
        "NATIVE_TEST_VALUE=staging\n",
      ),
    ).resolves.toEqual([null, null, "staging"]);
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

  test("staging API defaults stay out of production wrappers", async () => {
    const sharedRunner = await Bun.file(
      resolve(repositoryRoot, "scripts/nativeRelease.sh"),
    ).text();

    expect(sharedRunner).toContain(
      "staging) printf '%s\\n' \"https://api.tearleads.de\"",
    );
    expect(sharedRunner).toContain('export NATIVE_RELEASE_TIER="$native_tier"');
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
