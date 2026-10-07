import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  getDefaultDatabaseWorkerEntrypointUrl,
  getSqliteLicensesUrl,
  getSqliteWasmAssetUrl,
} from "../src/assets";

test("asset helpers resolve existing worker, wasm, and license files", () => {
  expect(existsSync(getDefaultDatabaseWorkerEntrypointUrl())).toBe(true);
  expect(existsSync(getSqliteWasmAssetUrl())).toBe(true);
  expect(existsSync(getSqliteLicensesUrl())).toBe(true);
});
