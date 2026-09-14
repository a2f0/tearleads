import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bunLaunchVariables, runMacosRelease } from "./releaseMacos.testUtils";

for (const [tier, channel, bucket, api] of [
  [
    "staging",
    "canary",
    "downloads-staging.tearleads.com",
    "api-staging.tearleads.com",
  ],
  ["production", "stable", "downloads.tearleads.com", "api.tearleads.com"],
] as const) {
  test(`${tier} publishes verified payloads before its channel metadata`, async () => {
    const result = await runMacosRelease(["upload", tier]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.calls.slice(0, 6)).toEqual([
      `secrets ${tier === "production" ? "prod" : tier}`,
      "credentials",
      "dependencies",
      "icons",
      `build --env=${channel} ${tier} https://${api} wss://${api}/events`,
      "stapler",
    ]);
    const uploads = result.calls.slice(6);
    expect(uploads).toHaveLength(5);
    for (const upload of uploads) expect(upload).toContain(`s3://${bucket}/`);
    expect(uploads[0]).toContain(".dmg ");
    expect(uploads[1]).toContain(".dmg.sha256 ");
    expect(uploads[1]).toContain("--content-type text/plain");
    expect(uploads[2]).toContain(".app.tar.zst ");
    expect(uploads[3]).toContain(`${channel}-macos-arm64-update.json`);
    expect(uploads[4]).toContain(`${channel}-macos-arm64-download.json`);
    for (const [key, content] of Object.entries(result.previous))
      if (!key.endsWith(".json")) expect(result.published[key]).toBe(content);
    const discovery = JSON.parse(
      result.published[`${channel}-macos-arm64-download.json`] ?? "{}",
    );
    expect(result.published[discovery.installer]).toBe("installer\n");
    expect(result.published[discovery.checksum]).toContain(
      `  ${discovery.installer}\n`,
    );
    expect(result.stdout).toContain(
      `Download: https://s3.us-east-1.amazonaws.com/${bucket}/`,
    );
  });
}

test("build mode verifies artifacts without AWS credentials or publication", async () => {
  const result = await runMacosRelease(["build", "production"]);
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.calls).toContain("stapler");
  expect(result.calls).not.toContain("credentials");
  expect(result.calls).not.toContain("token-leak");
  expect(result.calls.some((call) => call.startsWith("upload "))).toBe(false);
});

test("no release step or Bun process inherits Bun launch variables", async () => {
  const directory = mkdtempSync(join(tmpdir(), "macos-release-launch-"));
  try {
    const mark = join(directory, "preloaded");
    const preload = join(directory, "preload.ts");
    writeFileSync(
      preload,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(mark)}, "");\n`,
    );
    const result = await runMacosRelease(["upload", "staging"], "", {
      ...Object.fromEntries(
        bunLaunchVariables.map((name) => [name, "hostile"]),
      ),
      BUN_OPTIONS: `--preload=${preload}`,
      BUN_INSPECT_PRELOAD: preload,
    });
    expect(
      result.calls.filter((call) => call.startsWith("bun-launch")),
    ).toEqual([]);
    expect(existsSync(mark)).toBe(false);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("Download:");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a dirty checkout refuses the release before secrets or any Bun process, whatever GIT_DIR says", async () => {
  const result = await runMacosRelease(["upload", "production"], "dirty", {
    GIT_DIR: "/clean/checkout/elsewhere",
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.calls).toEqual([]);
  expect(result.stderr).toContain("require a clean Git checkout");
});

for (const failure of ["signing", "build", "missing", "notarization"]) {
  test(`${failure} failure prevents publishing any artifacts`, async () => {
    const result = await runMacosRelease(["upload", "production"], failure);
    expect(result.exitCode).not.toBe(0);
    expect(result.calls.some((call) => call.startsWith("upload "))).toBe(false);
    expect(result.stdout).not.toContain("Download:");
    if (failure === "signing") expect(result.calls).toEqual(["secrets prod"]);
    if (failure === "missing")
      expect(result.stderr).toContain("Missing release artifact");
  });
}

for (const [failure, count] of [
  ["payload", 1],
  ["checksum", 2],
] as const) {
  test(`${failure} upload failure prevents publishing update metadata`, async () => {
    const result = await runMacosRelease(["upload", "staging"], failure);
    expect(result.exitCode).not.toBe(0);
    const uploads = result.calls.filter((call) => call.startsWith("upload "));
    expect(uploads).toHaveLength(count);
    for (const [key, content] of Object.entries(result.previous))
      expect(result.published[key]).toBe(content);
    expect(uploads.some((upload) => upload.includes("-update.json"))).toBe(
      false,
    );
    expect(result.stdout).not.toContain("Download:");
  });
}

test("metadata upload failure does not report successful publication", async () => {
  const result = await runMacosRelease(["upload", "production"], "metadata");
  expect(result.exitCode).not.toBe(0);
  for (const [key, content] of Object.entries(result.previous))
    expect(result.published[key]).toBe(content);
  expect(result.stdout).not.toContain("Download:");
});

for (const args of [[], ["upload", "prod"], ["upload", "staging", "extra"]]) {
  test(`invalid release arguments ${args.join(" ")} cause no external operations`, async () => {
    const result = await runMacosRelease(args);
    expect(result.exitCode).toBe(1);
    expect(result.calls).toEqual([]);
  });
}
