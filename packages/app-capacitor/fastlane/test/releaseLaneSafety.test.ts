import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "../..");
const fastlaneGuardPath = resolve(
  packageRoot,
  "fastlane/lib/revenuecat_release_key.rb",
);
const capacitorReleaseConfigPath = resolve(
  packageRoot,
  "fastlane/lib/capacitor_release_config.rb",
);
const androidLanesPath = resolve(packageRoot, "fastlane/lanes/android.rb");
const iosLanesPath = resolve(packageRoot, "fastlane/lanes/ios.rb");

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

describe("Fastlane store-release safety", () => {
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
    ).resolves.toContain("independent baseline is unavailable");
    await expect(
      readFastlaneKeyProblem("appl_example", "appl_", "appl_root", "preview"),
    ).resolves.toContain("unknown release tier");
  });

  test("Fastlane rejects a generated config for the wrong native target", async () => {
    await expect(
      readCapacitorReleaseProblem(
        "com.tearleads.app",
        "com.tearleads.staging.app",
      ),
    ).resolves.toContain('instead of "com.tearleads.staging.app"');
    await expect(
      readCapacitorReleaseProblem(
        "com.tearleads.staging.app",
        "com.tearleads.staging.app",
      ),
    ).resolves.toBe("ok");
    await expect(
      readCapacitorReleaseProblem(
        "com.tearleads.staging.app",
        "com.tearleads.staging.app",
        "http://localhost:5173",
      ),
    ).resolves.toContain("server.url");
  });

  test("Fastlane validates keys after loading release secrets", async () => {
    const androidFastfile = await Bun.file(androidLanesPath).text();
    const iosFastfile = await Bun.file(iosLanesPath).text();
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

  test("iOS release signing uses an isolated Match keychain", async () => {
    const iosFastfile = await Bun.file(iosLanesPath).text();
    const buildLaneIndex = iosFastfile.indexOf(
      "lane :build_release do |options|",
    );
    const keychainIndex = iosFastfile.indexOf(
      "      with_ios_signing_keychain do",
      buildLaneIndex,
    );
    const buildMatchIndex = iosFastfile.indexOf(
      "        profile_name = install_ios_appstore_signing_assets!",
      keychainIndex,
    );

    expect(keychainIndex).toBeGreaterThan(buildLaneIndex);
    expect(buildMatchIndex).toBeGreaterThan(keychainIndex);
    expect(iosFastfile).toContain("with_ios_signing_keychain do");
    expect(iosFastfile).toContain("create_keychain(");
    expect(iosFastfile).toContain("password: password");
    expect(iosFastfile).toContain("default_keychain: true");
    expect(iosFastfile).toContain("delete_keychain(name: name)");
    expect(iosFastfile).toContain("OTHER_CODE_SIGN_FLAGS");
  });

  test("iOS release archives only the committed Swift package pins", async () => {
    const iosFastfile = await Bun.file(iosLanesPath).text();
    const buildLaneIndex = iosFastfile.indexOf(
      "lane :build_release do |options|",
    );
    const pinsIndex = iosFastfile.indexOf(
      "    ipa_path = SwiftPackagePins.verify_around(IOS_PACKAGE_RESOLVED_PATH) do",
      buildLaneIndex,
    );
    const keychainIndex = iosFastfile.indexOf(
      "      with_ios_signing_keychain do",
      pinsIndex,
    );
    const strictIndex = iosFastfile.indexOf(
      "            disable_package_automatic_updates: true,",
      keychainIndex,
    );
    const assetsIndex = iosFastfile.indexOf(
      "    assets = require_ios_testflight_assets!(ipa_path)",
      strictIndex,
    );

    expect(pinsIndex).toBeGreaterThan(buildLaneIndex);
    expect(keychainIndex).toBeGreaterThan(pinsIndex);
    expect(strictIndex).toBeGreaterThan(keychainIndex);
    expect(assetsIndex).toBeGreaterThan(strictIndex);
    expect(iosFastfile).toContain(
      "require_relative '../lib/swift_package_pins'",
    );
    expect(iosFastfile).toContain(
      "IOS_PACKAGE_RESOLVED_PATH = File.join(IOS_PROJECT_PATH, 'project.xcworkspace/xcshareddata/swiftpm/Package.resolved')",
    );
    expect(
      await Bun.file(
        resolve(
          packageRoot,
          "ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved",
        ),
      ).exists(),
    ).toBe(true);
  });

  test("only ios profiles may write match signing state", async () => {
    const iosFastfile = await Bun.file(iosLanesPath).text();
    const profilesLaneIndex = iosFastfile.indexOf(
      "  lane :profiles do |options|",
    );
    const nextLaneIndex = iosFastfile.indexOf(
      "  lane :",
      profilesLaneIndex + 1,
    );
    const writableOption = "        readonly: false,";
    const writableIndex = iosFastfile.indexOf(writableOption);

    expect(profilesLaneIndex).toBeGreaterThan(-1);
    expect(writableIndex).toBeGreaterThan(profilesLaneIndex);
    expect(writableIndex).toBeLessThan(nextLaneIndex);
    expect(
      iosFastfile.indexOf(
        "readonly: false",
        writableIndex + writableOption.length,
      ),
    ).toBe(-1);
    expect(iosFastfile).toContain("    readonly: true\n");
  });
});
