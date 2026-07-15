import { test } from "bun:test";
import { verifyContainerKekState } from "./index";
import {
  createContainerKeyEpochFixture,
  createContainerManifestFixture,
  expectVerificationError,
} from "./testFixtures";

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
