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
