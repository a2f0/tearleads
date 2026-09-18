import { expect, test } from "bun:test";
import { checkWindowsFixture } from "./verifyWindowsArtifacts.testUtils";

for (const tier of ["staging", "production"]) {
  test(`${tier} verifies a real Windows ZIP and compressed updater archive`, async () => {
    await checkWindowsFixture(tier);
  });
  for (const [failure, message] of [
    ["payload", "Installer payload must match"],
    ["update-hash", "Expected values to be strictly equal"],
    ["installer-hash", "Expected values to be strictly equal"],
    ["installer-map", "Source maps must not ship"],
    ["update-map", "Source maps must not ship"],
    ["artifact-map", "Source maps must not ship"],
    ["setup", "Missing setup executable"],
    ["api", "false == true"],
    ["cef", "Expected values to be strictly equal"],
    ["index.html", "false == true"],
    ["worker.js", "false == true"],
    ["sqlite3.wasm", "false == true"],
  ]) {
    test(`${tier} Windows archive verifier rejects ${failure}`, async () => {
      await expect(checkWindowsFixture(tier, failure)).rejects.toThrow(message);
    });
  }
}
