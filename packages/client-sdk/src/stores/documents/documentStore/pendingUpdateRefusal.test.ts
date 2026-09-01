import { expect, test } from "bun:test";
import { createCoverageFixture } from "../../../../test/helpers/syncOutgoingCoverage";
import type { DocumentsPersistence } from "../../../workflows/documents";
import { rebaseDocumentAfterPendingUpdateRefusal } from "./pendingUpdateRefusal";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";

test("a refused enqueue atomically adopts and registers the winning identity", async () => {
  const fixture = await createCoverageFixture(
    "pending-update-refusal-identity",
    false,
  );
  try {
    await fixture.state.persistence.relinkPersistedDocument(fixture.execSql, {
      accessEpoch: 2,
      containerId: "replacement-container",
      documentId: "replacement-document",
      localId: fixture.localId,
    });
    const sqlClaims: unknown[] = [];
    const basePersistence = fixture.state.persistence;
    fixture.state.persistence = {
      ...basePersistence,
      async loadDocumentWithHistoryRestoreState(execSql, localId) {
        sqlClaims.push(execSql);
        return basePersistence.loadDocumentWithHistoryRestoreState(
          execSql,
          localId,
        );
      },
    } satisfies DocumentsPersistence;
    const registrations: Array<{
      documentId: string | null;
      localId: string;
    }> = [];
    fixture.state.effects = {
      ...fixture.state.effects,
      registerDocumentIdentity: (_domainScope, localId, documentId) => {
        registrations.push({ documentId, localId });
      },
    };
    const generation = captureDocumentStoreSyncGeneration(
      fixture.state,
      fixture.document,
    );
    if (!generation) throw new Error("Expected a live document generation");

    expect(
      await rebaseDocumentAfterPendingUpdateRefusal(fixture.state, generation),
    ).toBe(true);
    expect(fixture.state.record?.documentId).toBe("replacement-document");
    expect(registrations).toEqual([
      {
        documentId: "replacement-document",
        localId: fixture.localId,
      },
    ]);
    expect(sqlClaims).toHaveLength(1);
    expect(sqlClaims[0]).not.toBe(fixture.execSql);
  } finally {
    fixture.close();
  }
});
