import { expect, test } from "bun:test";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");

async function readFastlaneAppIdentifier(tier: "production" | "staging") {
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
  return { identities: JSON.parse(stdout), stderr };
}

test("Fastlane Appfile selects each release tier's store identity", async () => {
  const production = await readFastlaneAppIdentifier("production");
  const staging = await readFastlaneAppIdentifier("staging");

  expect(production.identities).toEqual({
    appIdentifier: "com.tearleads.app",
    packageName: "com.tearleads.app",
  });
  expect(staging.identities).toEqual({
    appIdentifier: "com.tearleads.app.staging",
    packageName: "com.tearleads.app.staging",
  });
  expect(production.stderr).not.toContain("already initialized constant");
  expect(staging.stderr).not.toContain("already initialized constant");
});
