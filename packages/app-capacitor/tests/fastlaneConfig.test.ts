import { expect, test } from "bun:test";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");

async function loadFastlaneTier(tier: "production" | "staging") {
  const child = Bun.spawn(["bundle", "exec", "fastlane", "lanes"], {
    cwd: packageRoot,
    env: {
      ...process.env,
      FASTLANE_OPT_OUT_USAGE: "1",
      FASTLANE_SKIP_UPDATE_CHECK: "1",
      NATIVE_RELEASE_TIER: tier,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Fastlane failed to load ${tier}: ${stderr}`);
  }
  return stderr;
}

test("Fastlane loads both release tiers without redefining constants", async () => {
  for (const tier of ["production", "staging"] as const) {
    const stderr = await loadFastlaneTier(tier);
    expect(stderr).not.toContain("already initialized constant");
  }
});
