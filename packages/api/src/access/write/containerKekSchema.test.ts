import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containerKeyEpochs } from "@tearleads/api-shared/schema";

test("container KEK predecessor bridge columns are all present or all absent", async () => {
  const insert = db.insert(containerKeyEpochs).values({
    id: `partial-bridge:${crypto.randomUUID()}`,
    containerId: crypto.randomUUID(),
    keyEpoch: 2,
    accessManifestHash: "partial-bridge-manifest",
    predecessorContainerKeyEpochId: "partial-bridge-predecessor",
    createdByEventHash: "partial-bridge-event",
    createdByManifestHash: "partial-bridge-manifest",
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
    "container_key_epochs_predecessor_bridge_complete",
  );
});
