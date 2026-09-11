import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const origin = "http://127.0.0.1:3002";
const commit = "b".repeat(40);
const dsn = `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`;
const configured = {
  origin,
  scriptUrl: `${origin}/chunk-abc123.js`,
  dsn,
  environment: "staging",
  commit,
};

// Stand-ins for everything the renderer mounts, so this drives the real
// entrypoint without booting React, SQLite, or a Sentry transport. The browser
// client is the only thing that opens a transport or registers window
// listeners, so counting its construction proves whether a build is inert.
const mocks: Record<string, string> = {
  "@tearleads/client-sdk/sqlite": `export const PERSISTENT_STORAGE_POLICY = "persistent";
    export function createSQLiteRuntime() { return {}; }`,
  "@tearleads/diagnostics/browser": `export function createBrowserDiagnostics(config) {
    const state = globalThis.fixture; state.created++;
    if (state.factoryThrow) throw new Error("Synthetic factory failure");
    state.config = config; return { flush: async () => true };
  }`,
  "app/client": `export function renderApp(root, options) {
    globalThis.fixture.hostConfig = options.hostConfig;
  }`,
  "app/host/AppHostConfig": `export const APP_HOST_PROFILES = { app: {} };
    export function createAppBuildInfo(info) { return info; }
    export function createAppHostConfig(options) { return options; }
    export function resolveAppHostRuntimeConfig() {
      return { apiBaseUrl: "http://localhost:3001", wsUrl: "ws://localhost:3001/events" };
    }`,
  "react-dom/client": `export function createRoot() { return {}; }`,
};

// Every way a desktop build can fail to qualify. "development" is the shipped
// default: no Sentry project exists yet, and the dev server strips the defines.
const gateCases = `[
  ["configured", {}],
  ["production", { environment: "production" }],
  ["development", { dsn: undefined, commit: undefined, environment: undefined }],
  ["unconfigured", { dsn: "" }],
  ["foreign-dsn", { dsn: "https://attacker.invalid/1" }],
  ["stale-commit", { commit: "unknown" }],
  ["unknown-tier", { environment: "dev" }],
  ["foreign-origin", { scriptUrl: "https://app.tearleads.com/chunk-abc123.js" }],
  ["nested-script", { scriptUrl: "${origin}/assets/chunk-abc123.js" }],
  ["factory", { factoryThrow: true }],
]`;

test("desktop diagnostics reach the host config only for a configured release", async () => {
  const directory = await mkdtemp(join(tmpdir(), "electrobun-sentry-runtime-"));
  try {
    await Bun.write(
      join(directory, "entry.ts"),
      `
import { configureElectrobunSentry } from ${JSON.stringify(join(import.meta.dirname, "sentry.ts"))};
const base = ${JSON.stringify(configured)};
function mount(state) {
  globalThis.fixture = { created: 0, ...state };
  globalThis.window = { location: { origin: state.origin } };
}
mount({ ...base, ...JSON.parse(process.env.ELECTROBUN_FIXTURE) });
globalThis.location = { protocol: "http:" };
globalThis.document = { getElementById: () => ({}) };
// Imported dynamically so the globals above exist before the module entrypoint
// evaluates, and before the gate matrix below reassigns the fixture.
await import(${JSON.stringify(join(import.meta.dirname, "../renderer/index.tsx"))});
const { config, created, hostConfig } = globalThis.fixture;
const renderer = {
  declared: "diagnostics" in hostConfig, enabled: Boolean(hostConfig.diagnostics),
  created, release: config?.release, dist: config?.dist,
  origin: config?.origin, scriptPath: config?.scriptPath,
};
const gate = [];
for (const [name, changes] of ${gateCases}) {
  mount({ ...base, ...changes });
  const diagnostics = configureElectrobunSentry();
  gate.push({
    name, enabled: Boolean(diagnostics), created: globalThis.fixture.created,
    release: globalThis.fixture.config?.release,
    dist: globalThis.fixture.config?.dist,
  });
}
console.log(JSON.stringify({ renderer, gate }));
`,
    );
    const result = await Bun.build({
      entrypoints: [join(directory, "entry.ts")],
      outdir: directory,
      naming: "runtime.js",
      target: "bun",
      define: {
        "import.meta.url": "globalThis.fixture.scriptUrl",
        "process.env.BUN_PUBLIC_SENTRY_ELECTROBUN_COMMIT":
          "globalThis.fixture.commit",
        "process.env.BUN_PUBLIC_SENTRY_ELECTROBUN_DSN":
          "globalThis.fixture.dsn",
        "process.env.BUN_PUBLIC_SENTRY_ELECTROBUN_ENVIRONMENT":
          "globalThis.fixture.environment",
      },
      plugins: [
        {
          name: "electrobun-diagnostics-fixture",
          setup(build) {
            build.onResolve(
              {
                filter:
                  /^(?:app\/(?:client|host\/AppHostConfig)|react-dom\/client|@tearleads\/(?:client-sdk\/sqlite|diagnostics\/browser))$/u,
              },
              (args) => ({ path: args.path, namespace: "electrobun-fixture" }),
            );
            build.onLoad(
              { filter: /.*/u, namespace: "electrobun-fixture" },
              (args) => ({ contents: mocks[args.path] ?? "", loader: "js" }),
            );
          },
        },
      ],
    });
    expect(result.success).toBe(true);
    for (const [fixture, enabled] of [
      [{}, true],
      [{ dsn: "" }, false],
    ] as const) {
      const child = Bun.spawn(
        [process.execPath, join(directory, "runtime.js")],
        {
          env: { ...process.env, ELECTROBUN_FIXTURE: JSON.stringify(fixture) },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const output = await new Response(child.stdout).text();
      expect(await child.exited).toBe(0);
      const { renderer, gate } = JSON.parse(output);
      // The field is always threaded; only its value depends on the build.
      expect(renderer).toEqual({
        declared: true,
        enabled,
        created: enabled ? 1 : 0,
        release: enabled ? `tearleads-electrobun@${commit}` : undefined,
        dist: enabled ? "staging-app" : undefined,
        origin: enabled ? origin : undefined,
        scriptPath: enabled ? "/chunk-abc123.js" : undefined,
      });
      expect(gate).toHaveLength(10);
      for (const row of gate) {
        expect(row.enabled).toBe(
          ["configured", "production"].includes(row.name),
        );
        // Nothing but a resolved config may construct a client: an unconfigured
        // desktop build has no transport and no window listeners at all.
        expect(row.created).toBe(row.enabled || row.name === "factory" ? 1 : 0);
        if (row.enabled) {
          expect(row.release).toBe(`tearleads-electrobun@${commit}`);
          expect(row.dist).toBe(
            row.name === "production" ? "production-app" : "staging-app",
          );
        }
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
