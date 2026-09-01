import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { requireRubyBundle } from "./requireRubyBundle";

const packageRoot = resolve(import.meta.dir, "..");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recordValue(value: Record<string, unknown>, key: string): unknown {
  return value[key];
}

function parseStoreIdentity(stdout: string) {
  const value: unknown = JSON.parse(stdout);
  if (!isRecord(value)) {
    throw new Error("Fastlane store identity must be an object");
  }
  const appIdentifier = recordValue(value, "appIdentifier");
  const packageName = recordValue(value, "packageName");
  if (typeof appIdentifier !== "string" || typeof packageName !== "string") {
    throw new Error("Fastlane store identity fields must be strings");
  }
  return { appIdentifier, packageName };
}

async function readFastlaneAppIdentifier(tier: string) {
  await requireRubyBundle();
  const child = Bun.spawn(
    [
      "bundle",
      "exec",
      "ruby",
      "-e",
      'require "json"; require "credentials_manager"; puts JSON.generate({appIdentifier: CredentialsManager::AppfileConfig.try_fetch_value(:app_identifier), packageName: CredentialsManager::AppfileConfig.try_fetch_value(:package_name)})',
    ],
    {
      cwd: packageRoot,
      env: {
        ...process.env,
        FASTLANE_OPT_OUT_USAGE: "1",
        FASTLANE_SKIP_UPDATE_CHECK: "1",
        NATIVE_RELEASE_TIER: tier,
      },
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
    throw new Error(`Fastlane failed to load ${tier}: ${stderr}`);
  }
  try {
    return { identities: parseStoreIdentity(stdout), stderr };
  } catch {
    throw new Error(`Fastlane failed to load ${tier}: ${stderr}${stdout}`);
  }
}

test("Fastlane Appfile selects each release tier's store identity", async () => {
  const production = await readFastlaneAppIdentifier("production");
  const staging = await readFastlaneAppIdentifier("staging");

  expect(production.identities).toEqual({
    appIdentifier: "com.tearleads.app",
    packageName: "com.tearleads.app",
  });
  expect(staging.identities).toEqual({
    appIdentifier: "com.tearleads.staging.app",
    packageName: "com.tearleads.staging.app",
  });
  expect(production.stderr).not.toContain("already initialized constant");
  expect(staging.stderr).not.toContain("already initialized constant");
});

test("Fastlane Appfile rejects an unknown release tier", async () => {
  await expect(readFastlaneAppIdentifier("preview")).rejects.toThrow(
    "Unknown NATIVE_RELEASE_TIER",
  );
});

const fastlanePathConstantNames = [
  "ANDROID_DIR",
  "ANDROID_BUILD_IMAGES_SCRIPT",
  "IOS_PACKAGE_DIR",
  "IOS_DIR",
  "IOS_BUILD_IMAGES_SCRIPT",
  "NATIVE_SECRETS_DIR",
  "GOOGLE_PLAY_DEFAULT_JSON_KEY_PATH",
] as const;

type FastlanePathConstantName = (typeof fastlanePathConstantNames)[number];

const fastlanePathConstantsScript = [
  'require "json"',
  'require "fastlane"',
  "Fastlane.load_actions",
  'Fastlane::FastFile.new("fastlane/Fastfile")',
  "names = %w[ANDROID_DIR ANDROID_BUILD_IMAGES_SCRIPT IOS_PACKAGE_DIR IOS_DIR IOS_BUILD_IMAGES_SCRIPT GOOGLE_PLAY_DEFAULT_JSON_KEY_PATH]",
  "constants = names.to_h { |name| [name, Fastlane::FastFile.const_get(name)] }",
  'puts JSON.generate(constants.merge("NATIVE_SECRETS_DIR" => NATIVE_SECRETS_DIR))',
].join("; ");

function parseFastlanePathConstants(stdout: string) {
  const lastLine = stdout.trim().split("\n").at(-1);
  if (lastLine === undefined) {
    throw new Error("Fastlane path constants output is empty");
  }
  const value: unknown = JSON.parse(lastLine);
  if (!isRecord(value)) {
    throw new Error("Fastlane path constants must be an object");
  }
  const constants = {} as Record<FastlanePathConstantName, string>;
  for (const name of fastlanePathConstantNames) {
    const entry = recordValue(value, name);
    if (typeof entry !== "string") {
      throw new Error(`Fastlane path constant ${name} must be a string`);
    }
    constants[name] = entry;
  }
  return constants;
}

test("Fastlane lane files resolve paths outside their directory", async () => {
  await requireRubyBundle();
  const child = Bun.spawn(
    ["bundle", "exec", "ruby", "-e", fastlanePathConstantsScript],
    {
      cwd: packageRoot,
      env: {
        ...process.env,
        FASTLANE_OPT_OUT_USAGE: "1",
        FASTLANE_SKIP_UPDATE_CHECK: "1",
        NATIVE_RELEASE_TIER: "production",
      },
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
    throw new Error(`Fastlane path constants failed to load: ${stderr}`);
  }

  expect(parseFastlanePathConstants(stdout)).toEqual({
    ANDROID_DIR: resolve(packageRoot, "android"),
    ANDROID_BUILD_IMAGES_SCRIPT: resolve(
      packageRoot,
      "scripts/buildAndroidImages.sh",
    ),
    IOS_PACKAGE_DIR: packageRoot,
    IOS_DIR: resolve(packageRoot, "ios"),
    IOS_BUILD_IMAGES_SCRIPT: resolve(packageRoot, "scripts/buildIosImages.sh"),
    NATIVE_SECRETS_DIR: resolve(packageRoot, "../../.secrets"),
    GOOGLE_PLAY_DEFAULT_JSON_KEY_PATH: resolve(
      packageRoot,
      "../../.secrets/google-play-service-account-admin.json",
    ),
  });
});

const iosXcargsScript = [
  'require "json"',
  'require "fastlane"',
  "Fastlane.load_actions",
  'fastfile = Fastlane::FastFile.new("fastlane/Fastfile")',
  'FastlaneCore::Helper.singleton_class.define_method(:keychain_path) { |_name| "/tmp/Signing Keys/署名 keychain-db" }',
  'ENV["MATCH_KEYCHAIN_NAME"] = "release keychain"',
  'xcargs = fastfile.send(:ios_build_xcargs, { build_number: 2, version: "1.0" }, "TEAM")',
  "puts JSON.generate(Shellwords.split(xcargs))",
].join("; ");

test("iOS build flags preserve a keychain path containing whitespace and Unicode", async () => {
  await requireRubyBundle();
  const child = Bun.spawn(["bundle", "exec", "ruby", "-e", iosXcargsScript], {
    cwd: packageRoot,
    env: {
      ...process.env,
      FASTLANE_OPT_OUT_USAGE: "1",
      FASTLANE_SKIP_UPDATE_CHECK: "1",
      NATIVE_RELEASE_TIER: "production",
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  expect(exitCode, stderr).toBe(0);

  const xcargs = JSON.parse(stdout.trim().split("\n").at(-1) ?? "null");
  expect(xcargs).toContain(
    "OTHER_CODE_SIGN_FLAGS=--keychain /tmp/Signing\\ Keys/\\署\\名\\ keychain-db",
  );
});
