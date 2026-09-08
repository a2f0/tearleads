import { fileURLToPath } from "node:url";
import type { BunPlugin } from "bun";

/** Embeds Loro's WASM and JavaScript glue in browser and standalone Bun builds. */
export const loroWasmPlugin: BunPlugin = {
  name: "loro-inline-wasm",
  setup(build) {
    // The browser entry uses synchronous XHR; the Node entry dynamically
    // requires snippets. Neither dependency is emitted by Bun's bundler.
    build.onResolve({ filter: /^loro-crdt$/ }, () => ({
      path: fileURLToPath(import.meta.resolve("loro-crdt/base64")),
    }));
  },
};
