import { expect, test } from "bun:test";
import {
  MAX_DOCUMENT_SYNC_OUTGOING_UPDATES,
  MAX_DOCUMENT_SYNC_UPDATE_DATA_CHARACTERS,
} from "@symcrypt/validators/util";
import { selectDocumentSyncOutgoingBatch } from "./documentSyncOutgoingBatch";

function updates(lengths: readonly number[]) {
  return lengths.map((length, index) => ({
    id: `update-${index}`,
    updateData: "A".repeat(length),
  }));
}

test("document sync outgoing batches cap count and preserve order", () => {
  const pending = updates(
    Array.from({ length: MAX_DOCUMENT_SYNC_OUTGOING_UPDATES + 1 }, () => 1),
  );

  expect(selectDocumentSyncOutgoingBatch(pending).map(({ id }) => id)).toEqual(
    pending.slice(0, MAX_DOCUMENT_SYNC_OUTGOING_UPDATES).map(({ id }) => id),
  );
});

test("document sync outgoing batches reserve recovery capacity", () => {
  const selected = selectDocumentSyncOutgoingBatch(updates([3, 3, 3]), {
    reservedDataCharacters: MAX_DOCUMENT_SYNC_UPDATE_DATA_CHARACTERS - 6,
    reservedUpdateCount: MAX_DOCUMENT_SYNC_OUTGOING_UPDATES - 2,
  });

  expect(selected.map(({ id }) => id)).toEqual(["update-0", "update-1"]);
});

test("document sync rejects an update that can never fit", () => {
  expect(() =>
    selectDocumentSyncOutgoingBatch(
      updates([MAX_DOCUMENT_SYNC_UPDATE_DATA_CHARACTERS + 1]),
    ),
  ).toThrow("Document sync update exceeds its data limit");
});
