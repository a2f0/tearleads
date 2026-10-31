import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import maintenanceWorker, {
  MAINTENANCE_HEADER,
  MAINTENANCE_RETRY_AFTER_SECONDS,
} from "./maintenanceModeWorker";

interface WorkerConfig {
  readonly main?: string;
  readonly triggers?: { readonly crons?: readonly string[] };
  readonly exports?: Record<
    string,
    {
      readonly type: string;
      readonly state?: string;
      readonly storage?: string;
    }
  >;
  readonly durable_objects?: unknown;
  readonly hyperdrive?: unknown;
  readonly env: Record<
    string,
    {
      readonly name: string;
      readonly durable_objects?: {
        readonly bindings: readonly { readonly class_name: string }[];
      };
      readonly hyperdrive?: unknown;
    }
  >;
}

async function readConfig(file: string): Promise<WorkerConfig> {
  const text = await readFile(
    new URL(`../../${file}`, import.meta.url),
    "utf8",
  );
  return Bun.JSONC.parse(text) as WorkerConfig;
}

const api = "https://api.example.test";

describe("maintenance Worker", () => {
  test.each([
    ["GET", "/"],
    ["POST", "/auth/register"],
    ["DELETE", "/sessions/current"],
  ])("refuses %s %s with 503, Retry-After, and CORS", async (method, path) => {
    const response = await maintenanceWorker.fetch(
      new Request(`${api}${path}`, {
        method,
        headers: { origin: "https://app.example.test" },
      }),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe(
      String(MAINTENANCE_RETRY_AFTER_SECONDS),
    );
    expect(response.headers.get(MAINTENANCE_HEADER)).toBe("reset");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-expose-headers")).toContain(
      "retry-after",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "The API is under maintenance; retry later",
    });
  });

  test("answers a CORS preflight so the browser reads the 503", async () => {
    const response = await maintenanceWorker.fetch(
      new Request(`${api}/auth/register`, {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.test",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type, authorization",
        },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "POST",
    );
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "content-type, authorization",
    );
  });

  test("refuses WebSocket upgrades too", async () => {
    const response = await maintenanceWorker.fetch(
      new Request(`${api}/events`, { headers: { upgrade: "websocket" } }),
    );
    expect(response.status).toBe(503);
  });
});

describe("wrangler.maintenance.jsonc", () => {
  test("replaces each deployed tier's API Worker under its own name", async () => {
    const [live, maintenance] = await Promise.all([
      readConfig("wrangler.jsonc"),
      readConfig("wrangler.maintenance.jsonc"),
    ]);
    expect(Object.keys(maintenance.env).sort()).toEqual(["prod", "staging"]);
    for (const tier of ["staging", "prod"]) {
      expect(maintenance.env[tier]?.name).toBe(live.env[tier]?.name);
      expect(maintenance.env[tier]?.durable_objects).toBeUndefined();
      expect(maintenance.env[tier]?.hyperdrive).toBeUndefined();
    }
    expect(maintenance.main).toBe("./src/worker/maintenanceModeWorker.ts");
    expect(maintenance.durable_objects).toBeUndefined();
    expect(maintenance.triggers?.crons).toEqual([]);
  });

  test("deletes every Durable Object class the API exports", async () => {
    const [live, maintenance] = await Promise.all([
      readConfig("wrangler.jsonc"),
      readConfig("wrangler.maintenance.jsonc"),
    ]);
    const liveExports = Object.entries(live.exports ?? {});
    const liveClasses = liveExports.map(([name]) => name).sort();
    expect(liveClasses.length).toBeGreaterThan(0);
    for (const [, entry] of liveExports) {
      expect(entry).toEqual({ type: "durable-object", storage: "sqlite" });
    }
    for (const tier of ["staging", "prod"]) {
      const bound = (live.env[tier]?.durable_objects?.bindings ?? [])
        .map((binding) => binding.class_name)
        .sort();
      expect(bound).toEqual(liveClasses);
    }
    expect(maintenance.exports).toEqual(
      Object.fromEntries(
        liveClasses.map((name) => [
          name,
          { type: "durable-object", state: "deleted" },
        ]),
      ),
    );
  });
});
