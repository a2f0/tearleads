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

  await expect(insert.execute()).rejects.toThrow();
});
