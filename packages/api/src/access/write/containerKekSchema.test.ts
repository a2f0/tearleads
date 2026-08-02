import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containerKeyEpochs } from "@tearleads/api-shared/schema";

async function expectRotationArtifactInsertRejected(
  values: Partial<typeof containerKeyEpochs.$inferInsert>,
): Promise<void> {
  const insert = db.insert(containerKeyEpochs).values({
    id: `partial-artifacts:${crypto.randomUUID()}`,
    containerId: crypto.randomUUID(),
    keyEpoch: 2,
    accessManifestHash: "partial-artifacts-manifest",
    createdByEventHash: "partial-artifacts-event",
    createdByManifestHash: "partial-artifacts-manifest",
    ...values,
  });

  const failure = await insert.execute().then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(Error);
  const cause = failure instanceof Error ? failure.cause : null;
  const constraint =
    cause !== null && typeof cause === "object"
      ? Reflect.get(cause, "constraint")
      : null;
  expect(`${String(failure)} ${String(cause)} ${String(constraint)}`).toContain(
    "container_key_epochs_rotation_artifacts_complete",
  );
}

test("container KEK rotation artifact columns are all present or all absent", async () => {
  // A bridge fragment without the rest of the bridge or the keyring.
  await expectRotationArtifactInsertRejected({
    predecessorContainerKeyEpochId: `partial:${crypto.randomUUID()}`,
  });
  // A complete bridge without its keyring.
  await expectRotationArtifactInsertRejected({
    predecessorContainerKeyEpochId: `partial:${crypto.randomUUID()}`,
    predecessorBridgeVersion: 1,
    predecessorBridgeSuite: "partial-artifacts-suite",
    predecessorBridgeIv: "partial-artifacts-iv",
    wrappedPredecessorKey: "partial-artifacts-wrapped-key",
  });
  // A complete keyring without its bridge.
  await expectRotationArtifactInsertRejected({
    keyringIv: "partial-artifacts-keyring-iv",
    sealedKeyring: "partial-artifacts-sealed-keyring",
  });
  // A keyring fragment alongside a complete bridge.
  await expectRotationArtifactInsertRejected({
    predecessorContainerKeyEpochId: `partial:${crypto.randomUUID()}`,
    predecessorBridgeVersion: 1,
    predecessorBridgeSuite: "partial-artifacts-suite",
    predecessorBridgeIv: "partial-artifacts-iv",
    wrappedPredecessorKey: "partial-artifacts-wrapped-key",
    keyringIv: "partial-artifacts-keyring-iv",
  });
});
