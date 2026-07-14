import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getTextValue,
  getUpdateVersionVectors,
  importUpdates,
} from "@tearleads/loro";
import { importSyncedDocumentUpdates } from "./syncUpdateImport";

test("merges a full-history rotation snapshot into a behind reader with a concurrent local edit", async () => {
  const author = await createDocument("snapshot-merge-author");
  const empty = encodeVersionVector(author);
  author.getText("text").update("base");
  author.commit();

  const behindReader = await createDocument("snapshot-merge-reader");
  importUpdates(behindReader, [exportUpdatesSince(author, empty)]);
  behindReader.getText("text").insert(4, " local");
  behindReader.commit();

  author.getText("text").insert(4, " remote");
  author.commit();
  const checkpoint = exportFullHistorySnapshot(author);
  const checkpointVectors = getUpdateVersionVectors(checkpoint);
  const checkpointEnd = encodeVersionVector(author);

  author.getText("text").insert(author.getText("text").length, " later");
  author.commit();
  const later = exportUpdatesSince(author, checkpointEnd);
  const laterVectors = getUpdateVersionVectors(later);

  importSyncedDocumentUpdates(behindReader, [
    {
      checkpointKind: "rotate_baseline",
      checkpointPayloadKind: "full_history_snapshot",
      id: crypto.randomUUID(),
      ...checkpointVectors,
      sourceVersionVector: checkpointEnd,
      updateData: checkpoint,
    },
    {
      id: crypto.randomUUID(),
      ...laterVectors,
      updateData: later,
    },
  ]);

  expect(getTextValue(behindReader)).toContain(" local");
  expect(getTextValue(behindReader)).toContain(" remote");
  expect(getTextValue(behindReader)).toContain(" later");
});
