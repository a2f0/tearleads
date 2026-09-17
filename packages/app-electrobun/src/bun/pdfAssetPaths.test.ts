import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { resolvePdfAssetPath } from "./pdfAssetPaths";

const packageDir = resolve(import.meta.dir, "../..");
const sourceModuleUrl = new URL("./index.ts", import.meta.url).href;

test("PDF assets resolve from the package when the dev main process is bundled", () => {
  const bundledModuleUrl = "file:///tmp/electrobun-dev/bun/index.js";
  for (const asset of [
    "legacy/build/pdf.worker.min.mjs",
    "cmaps/UniJIS-UCS2-H.bcmap",
    "wasm/openjpeg.wasm",
  ]) {
    const path = resolvePdfAssetPath(packageDir, asset, bundledModuleUrl);
    expect(path).toBe(resolve(packageDir, "node_modules/pdfjs-dist", asset));
    expect(existsSync(path)).toBe(true);
  }
});

test("PDF assets also resolve from an unbundled source module", () => {
  const path = resolvePdfAssetPath(
    undefined,
    "legacy/build/pdf.worker.min.mjs",
    sourceModuleUrl,
  );
  expect(existsSync(path)).toBe(true);
});
