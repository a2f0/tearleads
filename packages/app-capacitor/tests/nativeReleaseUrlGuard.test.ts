import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const nativeReleaseScript = resolve(repositoryRoot, "scripts/nativeRelease.sh");

async function nativeDefaultApi(tier: "production" | "staging") {
  const child = Bun.spawn(
    [
      "sh",
      "-c",
      '. "$1"; native_release_default_api "$2"',
      "sh",
      nativeReleaseScript,
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

async function runTierHostGuard(
  name: "VITE_API_BASE_URL" | "VITE_WS_URL",
  tier: "production" | "staging",
  url: string,
) {
  const child = Bun.spawn(
    [
      "sh",
      "-c",
      '. "$1"; native_release_require_tier_host "$2" "$3" "$4"',
      "sh",
      nativeReleaseScript,
      name,
      tier,
      url,
    ],
    { stderr: "pipe" },
  );
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr };
}

describe("native release URL guards", () => {
  test("uses tier-specific API defaults", async () => {
    await expect(nativeDefaultApi("production")).resolves.toBe(
      "https://api.tearleads.com",
    );
    await expect(nativeDefaultApi("staging")).resolves.toBe(
      "https://api.tearleads.de",
    );
  });

  test("rejects cross-tier and deceptive hosts", async () => {
    const stagingWrong = await Promise.all(
      [
        "https://api.tearleads.com/",
        "https://api.tearleads.com:443",
        "https://API.tearleads.com",
        "https://api.tearleads.com/v1",
      ].map((url) => runTierHostGuard("VITE_API_BASE_URL", "staging", url)),
    );
    const productionWrong = await runTierHostGuard(
      "VITE_API_BASE_URL",
      "production",
      "https://api.tearleads.de",
    );
    const stagingSocketWrong = await runTierHostGuard(
      "VITE_WS_URL",
      "staging",
      "wss://api.tearleads.com/v1/events",
    );
    const deceptiveStagingSockets = await Promise.all(
      [
        "wss://tearleads.de.example/socket",
        "wss://evil.example#@events.tearleads.de",
        "wss://evil.example?next=@events.tearleads.de",
      ].map((url) => runTierHostGuard("VITE_WS_URL", "staging", url)),
    );
    const stagingUnknown = await runTierHostGuard(
      "VITE_API_BASE_URL",
      "staging",
      "https://tearleads.com",
    );

    for (const result of stagingWrong) {
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("must use api.tearleads.de");
    }
    expect(productionWrong.exitCode).toBe(1);
    expect(productionWrong.stderr).toContain("must use api.tearleads.com");
    expect(stagingSocketWrong.exitCode).toBe(1);
    expect(stagingSocketWrong.stderr).toContain("VITE_WS_URL");
    for (const result of deceptiveStagingSockets) {
      expect(result.exitCode).toBe(1);
    }
    expect(stagingUnknown.exitCode).toBe(1);
  });

  test("requires secure schemes even on the correct tier host", async () => {
    const insecureApi = await runTierHostGuard(
      "VITE_API_BASE_URL",
      "staging",
      "http://api.tearleads.de",
    );
    const insecureSocket = await runTierHostGuard(
      "VITE_WS_URL",
      "staging",
      "ws://events.tearleads.de/socket",
    );

    expect(insecureApi.exitCode).toBe(1);
    expect(insecureApi.stderr).toContain("secure release scheme");
    expect(insecureSocket.exitCode).toBe(1);
    expect(insecureSocket.stderr).toContain("secure release scheme");
  });

  test("accepts selected-tier URLs and an omitted WebSocket URL", async () => {
    const results = await Promise.all([
      runTierHostGuard(
        "VITE_API_BASE_URL",
        "staging",
        "https://api.tearleads.de",
      ),
      runTierHostGuard(
        "VITE_WS_URL",
        "staging",
        "wss://events.tearleads.de/socket",
      ),
      runTierHostGuard(
        "VITE_WS_URL",
        "production",
        "wss://events.tearleads.com/socket",
      ),
      runTierHostGuard("VITE_WS_URL", "staging", ""),
    ]);

    for (const result of results) {
      expect(result.exitCode).toBe(0);
    }
  });
});
