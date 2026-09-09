import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { build } from "vite";

test("production Vite bundles round-trip Loro without synchronous XHR", async () => {
  const root = resolve(import.meta.dir, "..");
  const entry = resolve(root, "tests/loro-round-trip-fixture.ts");
  const loroEntry = Bun.resolveSync(
    "@tearleads/loro",
    resolve(root, "../client-sdk"),
  );
  const result = await build({
    root,
    configFile: resolve(root, "vite.config.ts"),
    mode: "production",
    logLevel: "silent",
    // bun test sets NODE_ENV=test; select the real release browser exports.
    resolve: { conditions: ["module", "browser", "production"] },
    // The VM executes an IIFE, so supply the native module URL explicitly.
    define: {
      "import.meta.url": JSON.stringify(
        "capacitor://localhost/assets/loro-smoke.js",
      ),
    },
    plugins: [
      {
        name: "loro-round-trip-fixture",
        resolveId: (id) => (id === entry ? entry : undefined),
        load: (id) =>
          id === entry
            ? `
              import { createDocument, exportFullHistorySnapshot, importSnapshot }
                from ${JSON.stringify(loroEntry)};
              export async function roundTrip() {
                const source = await createDocument("source");
                const target = await createDocument("target");
                try {
                  source.getText("body").insert(0, "native Loro works");
                  importSnapshot(target, exportFullHistorySnapshot(source));
                  return target.getText("body").toString();
                } finally {
                  source.free();
                  target.free();
                }
              }
            `
            : undefined,
      },
    ],
    build: {
      write: false,
      sourcemap: false,
      lib: {
        entry,
        name: "LoroSmoke",
        formats: ["iife"],
        fileName: () => "assets/loro-smoke.js",
      },
    },
  });
  const bundles = Array.isArray(result) ? result : [result];
  const bundle = bundles[0];
  if (bundles.length !== 1 || !bundle || !("output" in bundle)) {
    throw new Error("Expected one production bundle");
  }
  const chunk = bundle.output.find((output) => output.type === "chunk");
  if (!chunk) throw new Error("Production bundle has no JavaScript");
  const roundTrip: () => Promise<string> = runInNewContext(
    `${chunk.code}\nLoroSmoke.roundTrip`,
    {
      crypto,
      TextEncoder,
      TextDecoder,
      URL,
      atob,
      btoa,
      XMLHttpRequest: class {
        open() {
          throw new Error("Synchronous XHR is unavailable in WKWebView");
        }
      },
    },
  );
  expect(await roundTrip()).toBe("native Loro works");
}, 30_000);
