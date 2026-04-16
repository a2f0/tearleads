import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  getDefaultDatabaseWorkerEntrypointUrl,
  getSqliteWasmAssetUrl,
} from "../src/assets";

test("asset helpers resolve existing worker and wasm files", () => {
  expect(existsSync(getDefaultDatabaseWorkerEntrypointUrl())).toBe(true);
  expect(existsSync(getSqliteWasmAssetUrl())).toBe(true);
});
