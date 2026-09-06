import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const cliEntry = fileURLToPath(new URL("./index.ts", import.meta.url));

async function runCli(
  args: readonly string[],
  env: Record<string, string | undefined>,
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const proc = Bun.spawn(["bun", cliEntry, ...args], {
    env: { ...process.env, ...env },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}

// Regression: the schema module resolves the database dialect on import and
// throws under NODE_ENV=production when API_DATABASE is unset. The command
// must apply its postgres default before that import, so a malformed
// fingerprint is reported as such rather than as a missing API_DATABASE.
test("make-admin defaults API_DATABASE before loading the schema", async () => {
  const result = await runCli(["make-admin", "not-a-fingerprint"], {
    API_DATABASE: undefined,
    NODE_ENV: "production",
  });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).not.toContain("API_DATABASE is required");
  expect(result.stderr).toContain(
    "Fingerprint must be the 64-character lowercase hex signing key fingerprint",
  );
}, 30_000);

test("make-admin and revoke-admin require a fingerprint argument", async () => {
  for (const command of ["make-admin", "revoke-admin"]) {
    const result = await runCli([command], { API_DATABASE: "memory" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("A signing key fingerprint is required");
  }
}, 30_000);
