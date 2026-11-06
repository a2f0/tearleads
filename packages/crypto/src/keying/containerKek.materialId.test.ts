import { test } from "bun:test";
import { createContainerManifestFixture } from "./containerAccess.testFixtures";
import { createContainerKeyEpochFixture } from "./containerKek.testFixtures";
import { verifyContainerKekState } from "./index";
import { expectVerificationError } from "./verificationError.testFixtures";

test("verifyContainerKekState rejects legacy non-material epoch ids", async () => {
  const manifest = await createContainerManifestFixture({
    containerId: "legacy-container",
    containerKeyEpochId: "legacy-container-key-epoch",
    directGrants: [],
  });

  expectVerificationError(
    await verifyContainerKekState({
      containerManifest: manifest,
      keyEpoch: await createContainerKeyEpochFixture({ manifest }),
      wraps: [],
    }),
    "invalid_shape",
  );
});
