import { expect, test } from "bun:test";
import {
  classifyDocumentSyncCheckpointFields,
  DOCUMENT_SYNC_ROTATION_CHECKPOINT_KIND,
  DOCUMENT_SYNC_ROTATION_CHECKPOINT_PAYLOAD_KIND,
  type DocumentSyncCheckpointFieldClassification,
} from "./documentSyncCheckpoint";

type PresenceBit = 0 | 1;
type PresenceKey = `${PresenceBit}${PresenceBit}${PresenceBit}`;

const expectedByPresence = {
  "000": "absent",
  "001": "invalid",
  "010": "invalid",
  "011": "invalid",
  "100": "invalid",
  "101": "invalid",
  "110": "invalid",
  "111": "rotation-baseline",
} satisfies Record<PresenceKey, DocumentSyncCheckpointFieldClassification>;

function presenceBit(present: boolean): PresenceBit {
  return present ? 1 : 0;
}

test("classifies every decoded checkpoint field-presence state", () => {
  const states = [false, true] as const;
  const visited = new Set<PresenceKey>();

  for (const checkpointKindPresent of states) {
    for (const checkpointPayloadKindPresent of states) {
      for (const sourceVersionVectorPresent of states) {
        const key = `${presenceBit(checkpointKindPresent)}${presenceBit(
          checkpointPayloadKindPresent,
        )}${presenceBit(sourceVersionVectorPresent)}` as PresenceKey;
        visited.add(key);

        expect(
          classifyDocumentSyncCheckpointFields({
            checkpointKind: checkpointKindPresent
              ? DOCUMENT_SYNC_ROTATION_CHECKPOINT_KIND
              : undefined,
            checkpointPayloadKind: checkpointPayloadKindPresent
              ? DOCUMENT_SYNC_ROTATION_CHECKPOINT_PAYLOAD_KIND
              : undefined,
            sourceVersionVector: sourceVersionVectorPresent
              ? '{"actor":1}'
              : undefined,
          }),
        ).toBe(expectedByPresence[key]);
      }
    }
  }

  expect(visited.size).toBe(8);
});

test("classifies source-vector presence by definedness", () => {
  // Field-level Zod validation rejects empty strings before this classifier runs.
  expect(
    classifyDocumentSyncCheckpointFields({
      checkpointKind: DOCUMENT_SYNC_ROTATION_CHECKPOINT_KIND,
      checkpointPayloadKind: DOCUMENT_SYNC_ROTATION_CHECKPOINT_PAYLOAD_KIND,
      sourceVersionVector: "",
    }),
  ).toBe("rotation-baseline");
});
