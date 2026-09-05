import { expect, test } from "bun:test";
import { requireCurrentImportBlobMode } from "./importMetadata";

test.each([
  "outdated-snapshot",
  "outdated-update",
] as const)("metadata refuses %s instead of adapting the obsolete encoding", (mode) => {
  expect(() => requireCurrentImportBlobMode(mode)).toThrow(
    "Obsolete Loro encoding",
  );
});

test.each([
  "snapshot",
  "shallow-snapshot",
  "update",
] as const)("metadata preserves the current %s mode for the caller's protocol checks", (mode) => {
  expect(requireCurrentImportBlobMode(mode)).toBe(mode);
});
