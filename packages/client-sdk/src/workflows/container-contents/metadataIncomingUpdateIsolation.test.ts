import { expect, test } from "bun:test";
import {
  createDocument,
  exportFullHistorySnapshot,
  getTextValue,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { applyIncomingContainerMetadataUpdates } from "./metadataIncomingUpdateIsolation";

test("metadata live import applies rotation snapshots before ordinary updates", async () => {
  const current = await createDocument("metadata-checkpoint-current");
  const rotated = await createDocument("metadata-checkpoint-rotated");
  rotated.getText("text").update("rotation baseline");
  rotated.commit();
  const snapshot = exportFullHistorySnapshot(rotated);
  const vectors = getUpdateVersionVectors(snapshot);

  applyIncomingContainerMetadataUpdates(current, {
    decryptedUpdates: [
      {
        checkpointKind: "rotate_baseline",
        checkpointPayloadKind: "full_history_snapshot",
        id: "550e8400-e29b-41d4-a716-4466554400cc",
        ...vectors,
        sourceVersionVector: vectors.partialEndVersionVector,
        updateData: snapshot,
      },
    ],
  });

  expect(getTextValue(current)).toBe("rotation baseline");
});
