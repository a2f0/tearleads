import { expect, test } from "bun:test";
import type { CloudflareApi } from "./cloudflareApi";
import { readDeployedConfig } from "./deployedConfig";

function deployedFixture(input: { driveId?: string; flags?: unknown } = {}) {
  const calls: string[] = [];
  const poolBindings = Object.entries({
    POSTGRES_COALESCE_WRITES: "true",
    POSTGRES_POOL_MAX: "4",
    POSTGRES_POOL_MAX_USES: "1",
    POSTGRES_REQUEST_SCOPED: "true",
  }).map(([name, text]) => ({ name, text, type: "plain_text" }));
  const api: CloudflareApi = async (path) => {
    calls.push(path);
    if (path.endsWith("/settings"))
      return {
        bindings: [
          {
            name: "HYPERDRIVE",
            type: "hyperdrive",
            id: input.driveId ?? "a".repeat(32),
          },
          ...poolBindings,
        ],
        placement: { mode: "targeted", target: [1] },
        compatibility_date: "2026-08-17",
        compatibility_flags: input.flags ?? [
          "nodejs_compat",
          "enable_request_signal",
        ],
      };
    if (path === "/workers/subdomain") return { subdomain: "example" };
    return { caching: { disabled: true } };
  };
  return { api, calls, poolBindings };
}

for (const tier of ["staging", "production"] as const) {
  test(`copies deployed configuration and the API region hint for ${tier}`, async () => {
    const f = deployedFixture();
    const config = await readDeployedConfig(f.api, "source", tier);
    expect(config).toEqual({
      hyperdriveId: "a".repeat(32),
      poolBindings: f.poolBindings,
      placement: { mode: "targeted", target: [1] },
      uploadPlacement: { mode: "targeted", region: "aws:us-east-1" },
      compatibilityDate: "2026-08-17",
      compatibilityFlags: ["nodejs_compat", "enable_request_signal"],
      subdomain: "example",
    });
    expect(f.calls).toContain(`/hyperdrive/configs/${"a".repeat(32)}`);
  });
}

test("invalid Hyperdrive IDs cannot reach a configuration URL", async () => {
  const f = deployedFixture({ driveId: "../other" });
  await expect(readDeployedConfig(f.api, "source", "staging")).rejects.toThrow(
    "Hyperdrive ID",
  );
  expect(f.calls).toEqual(["/workers/scripts/source/settings"]);
});

test("compatibility flags must all be strings", async () => {
  const f = deployedFixture({ flags: ["nodejs_compat", false] });
  await expect(readDeployedConfig(f.api, "source", "staging")).rejects.toThrow(
    "Node compatibility",
  );
});

test("cannot benchmark a cache-enabled Hyperdrive binding", async () => {
  const api: CloudflareApi = async (path) =>
    path.includes("settings")
      ? {
          bindings: [
            { name: "HYPERDRIVE", type: "hyperdrive", id: "a".repeat(32) },
          ],
        }
      : { caching: { disabled: false } };
  await expect(readDeployedConfig(api, "source", "staging")).rejects.toThrow(
    "cache",
  );
});

test("refuses to compare request-scoped measurements with a shared API pool", async () => {
  const api: CloudflareApi = async (path) =>
    path.includes("settings")
      ? {
          bindings: [
            { name: "HYPERDRIVE", type: "hyperdrive", id: "a".repeat(32) },
            ...Object.entries({
              POSTGRES_COALESCE_WRITES: "true",
              POSTGRES_POOL_MAX: "4",
              POSTGRES_POOL_MAX_USES: "1",
              POSTGRES_REQUEST_SCOPED: "false",
            }).map(([name, text]) => ({ name, text, type: "plain_text" })),
          ],
        }
      : { caching: { disabled: true } };
  await expect(readDeployedConfig(api, "source", "staging")).rejects.toThrow(
    "request-scoped pool",
  );
});
