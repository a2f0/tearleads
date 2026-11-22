import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { createDocument, exportAllUpdates } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { listPendingDownloads } from "../documentQueries/pendingDownloads";
import { writeContainerMetadataValue } from "./containerMetadataDocument";
import {
  createContainerRecord,
  createDocumentRecord,
} from "./metadata.testFixtures";
import { isFolderMetadataQueuedForDownload } from "./metadataDownloadCompletion";

async function exportedMetadata(name: string | null): Promise<string> {
  const doc = await createDocument(`metadata-queue-rule-${name ?? "empty"}`);
  if (name !== null) writeContainerMetadataValue(doc, { icon: null, name });
  return bytesToBase64(exportAllUpdates(doc));
}

// The completion check decides from the record in memory what the queue
// decides in SQL; each stored state must get the same answer from both.
test("the folder queue rule matches listPendingDownloads for every stored state", async () => {
  const { close, execSql } = await createTestExecSql("metadata-queue-rule");
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    const stored = await exportedMetadata("Stored");
    const states = {
      emptyFrontier: {
        documentId: "remote-empty",
        metadataUpdates: await exportedMetadata(null),
      },
      local: { documentId: null, metadataUpdates: stored },
      paging: {
        documentId: "remote-paging",
        metadataUpdates: stored,
        pullContinuation: {
          commitLsn: "0/3",
          commitLsnMode: "tracked" as const,
          cursor: "page-2",
        },
      },
      recovering: { documentId: "remote-recovering", metadataUpdates: stored },
      stored: { documentId: "remote-stored", metadataUpdates: stored },
      unpulled: { documentId: "remote-unpulled", metadataUpdates: "" },
    };
    for (const [id, fields] of Object.entries(states))
      await sqlContainerContentsPersistence.saveContainer(
        execSql,
        createContainerRecord({
          id,
          metadataDocumentId: fields.documentId,
          parentId: null,
        }),
        createDocumentRecord({ id, ...fields }),
      );
    await execSql(
      "UPDATE documents SET pull_continuation = :cursor WHERE app_kind = 'container-metadata' AND local_id = :localId",
      { ":cursor": "not-json", ":localId": "recovering" },
    );

    const queued = new Set(
      (await listPendingDownloads(execSql)).map((item) => item.localId),
    );
    expect([...queued].sort()).toEqual([
      "emptyFrontier",
      "paging",
      "recovering",
      "unpulled",
    ]);
    for (const id of Object.keys(states)) {
      const loaded =
        await sqlContainerContentsPersistence.loadContainerMetadataState(
          execSql,
          id,
        );
      if (!loaded?.record) throw new Error(`Expected stored ${id}`);
      expect({
        id,
        queued: isFolderMetadataQueuedForDownload(loaded.record),
      }).toEqual({
        id,
        queued: queued.has(id),
      });
    }
  } finally {
    close();
  }
});
