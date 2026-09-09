import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks: Record<string, string> = {
  "@capacitor/core": `export const Capacitor = {
    isNativePlatform: () => globalThis.fixture.native,
    getPlatform: () => globalThis.fixture.platform,
  };`,
  "@capacitor/app": `export const App = { addListener: async (name, listener) => {
    const state = globalThis.fixture; state.listener = name;
    if (state.listenerReject) throw new Error("Synthetic listener failure");
    state.pause = listener; return { remove: async () => {} };
  } };`,
  "@tearleads/diagnostics/browser": `export function createBrowserDiagnostics(config) {
    const state = globalThis.fixture;
    if (state.factoryReject) throw new Error("Synthetic factory failure");
    state.config = config;
    return { flush: async () => {
      state.flushed++;
      if (state.flushReject) throw new Error("Synthetic flush failure");
    } };
  }`,
};

test("native initialization gates reporting, rejects bad manifests, and flushes on pause without breaking the app", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native-sentry-runtime-"));
  try {
    await Bun.write(
      join(directory, "entry.ts"),
      `
import { configureNativeSentry } from ${JSON.stringify(join(import.meta.dirname, "sentry.ts"))};
globalThis.window = { location: { href: "https://localhost/", origin: "https://localhost" } };
globalThis.fetch = async (url) => {
  const state = globalThis.fixture; state.fetches++; state.url = String(url);
  if (state.response === "reject") throw new Error("Synthetic network failure");
  if (state.response === "http") return new Response("unavailable", { status: 503 });
  if (state.response === "json") return new Response("not JSON");
  return new Response(JSON.stringify({
    commit: state.response === "stale" ? "c".repeat(40) : state.commit,
    platform: state.platform, environment: state.environment,
    paths: ["/assets/main.js"],
  }));
};
const cases = [
  ["ios", {}], ["android", { platform: "android", environment: "production" }],
  ["browser", { native: false }], ["development", { production: false }],
  ["unconfigured", { dsn: "" }], ["http", { response: "http" }],
  ["invalid-json", { response: "json" }], ["network", { response: "reject" }],
  ["stale", { response: "stale" }], ["factory", { factoryReject: true }],
  ["listener", { listenerReject: true }], ["flush", { flushReject: true }],
];
const results = [];
for (const [name, changes] of cases) {
  const state = globalThis.fixture = {
    native: true, production: true, platform: "ios", environment: "staging",
    dsn: "https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1", commit: "b".repeat(40),
    fetches: 0, flushed: 0, ...changes,
  };
  const diagnostics = await configureNativeSentry();
  state.pause?.();
  await Promise.resolve();
  results.push({
    name, enabled: Boolean(diagnostics), fetches: state.fetches, url: state.url,
    flushed: state.flushed, listener: state.listener,
    release: state.config?.release, environment: state.config?.environment,
  });
}
console.log(JSON.stringify(results));
`,
    );
    const result = await Bun.build({
      entrypoints: [join(directory, "entry.ts")],
      outdir: directory,
      naming: "runtime.js",
      target: "bun",
      define: {
        "import.meta.env.PROD": "globalThis.fixture.production",
        "import.meta.env.VITE_SENTRY_DSN": "globalThis.fixture.dsn",
        "import.meta.env.VITE_SENTRY_COMMIT": "globalThis.fixture.commit",
        "import.meta.env.VITE_SENTRY_PLATFORM": "globalThis.fixture.platform",
        "import.meta.env.VITE_SENTRY_ENVIRONMENT":
          "globalThis.fixture.environment",
      },
      plugins: [
        {
          name: "native-diagnostics-fixture",
          setup(build) {
            build.onResolve(
              {
                filter:
                  /^@(?:capacitor\/(?:core|app)|tearleads\/diagnostics\/browser)$/u,
              },
              (args) => ({
                path: args.path,
                namespace: "native-fixture",
              }),
            );
            build.onLoad(
              { filter: /.*/u, namespace: "native-fixture" },
              (args) => ({
                contents: mocks[args.path] ?? "",
                loader: "js",
              }),
            );
          },
        },
      ],
    });
    expect(result.success).toBe(true);
    const child = Bun.spawn([process.execPath, join(directory, "runtime.js")], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    const results = JSON.parse(output);
    expect(results).toHaveLength(12);
    for (const row of results) {
      expect(row.enabled).toBe(
        ["ios", "android", "listener", "flush"].includes(row.name),
      );
      if (["browser", "development", "unconfigured"].includes(row.name)) {
        expect(row.fetches).toBe(0);
      } else {
        expect(row.fetches).toBe(1);
        expect(row.url).toBe("https://localhost/sentry-assets.json");
      }
      if (row.enabled) {
        expect(row.listener).toBe("pause");
        expect(row.flushed).toBe(row.name === "listener" ? 0 : 1);
        const platform = row.name === "android" ? "android" : "ios";
        expect(row.release).toBe(`tearleads-${platform}@${"b".repeat(40)}`);
        expect(row.environment).toBe(
          platform === "android" ? "production" : "staging",
        );
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
