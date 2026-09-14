import { expect, test } from "bun:test";
import { checkLinuxFixture } from "./verifyLinuxArtifacts.testUtils";

for (const tier of ["staging", "production"] as const) {
  test(`${tier} verifies a real installer and compressed updater fixture`, async () => {
    await checkLinuxFixture(tier);
  });
  for (const failure of [
    "installer",
    "filename",
    "hash",
    "api",
    "index.html",
    "worker.js",
    "sqlite3.wasm",
    "installer-map",
    "update-map",
    "artifact-map",
  ]) {
    test(`${tier} rejects invalid ${failure} artifacts`, async () => {
      await expect(checkLinuxFixture(tier, failure)).rejects.toThrow();
    });
  }
}
