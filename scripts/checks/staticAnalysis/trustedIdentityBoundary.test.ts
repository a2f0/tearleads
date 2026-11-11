import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isolatedGitEnv } from "./fixture.testUtils";

const checker = resolve(import.meta.dir, "../lintPackageAssertions.ts");
const gateway = "packages/client-sdk/src/data/trustedUserIdentity";

function lint(files: Record<string, string>) {
  const cwd = mkdtempSync(join(tmpdir(), "tearleads-identity-boundary-"));
  try {
    for (const [path, identifier] of Object.entries(files)) {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), `export const value = ${identifier};\n`);
    }
    const result = Bun.spawnSync([process.execPath, checker], {
      cwd,
      env: isolatedGitEnv(),
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      code: result.exitCode,
      output: result.stdout.toString() + result.stderr.toString(),
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("only the named identity gateway modules may construct trusted brands", () => {
  const result = lint(
    Object.fromEntries(
      ["service", "types", "pinnedIdentity", "pinnedResolution"].map((name) => [
        `${gateway}/${name}.ts`,
        "brandTrustedUserIdentity",
      ]),
    ),
  );
  expect(result.output).toBe("");
  expect(result.code).toBe(0);
});

test("pin helpers do not widen raw identity, test factory, or brand access", () => {
  const forbidden = {
    [`${gateway}/untrusted.ts`]: "brandTrustedUserIdentity",
    "packages/client-sdk/src/data/principals/pinnedIdentity.ts":
      "brandTrustedUserIdentity",
    "packages/app/src/data/trustedUserIdentity/pinnedResolution.ts":
      "brandTrustedUserIdentity",
    [`${gateway}/service.ts`]: "getUserIdentity",
    [`${gateway}/pinnedIdentity.ts`]: "UserIdentityResponse",
    [`${gateway}/pinnedResolution.ts`]: "OrganizationUserRecipient",
    [`${gateway}/apiAdapter.ts`]: "brandTrustedUserIdentity",
    [`${gateway}/types.ts`]: "createTestTrustedUserIdentity",
  };
  const result = lint(forbidden);
  expect(result.code).toBe(1);
  expect(result.output).toContain("error package-trusted-identity-boundary");
  for (const [path, identifier] of Object.entries(forbidden)) {
    expect(result.output).toContain(`${path}:1:22 ${identifier}`);
  }
});

test("the API adapter alone retains access to raw remote identity contracts", () => {
  const result = lint({
    [`${gateway}/apiAdapter.ts`]:
      "[getUserIdentity, UserIdentityResponse, OrganizationUserRecipient]",
  });
  expect(result.output).toBe("");
  expect(result.code).toBe(0);
});
