import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createDocumentDiscoveryEvidenceStore } from "../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import {
  documentDiscoveryHeads,
  documentDiscoverySequence,
} from "../../data/sqlite/documentDiscoveryEvidenceSchema";
import {
  clientSqlTables,
  containerDocumentTombstoneHolds,
  containers,
  documentContainerProjection,
} from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { clearRemoteSyncState } from "./remoteReset";

test("remote reset clears tombstone holds with the link rows they hide", async () => {
  const { close, execSql } = await createTestExecSql(
    "sync-remote-reset-tombstone-holds",
  );
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const stale = "2026-05-01T00:00:00.000Z";
    await db.insert(containers).values({
      id: "child",
      organizationId: "org-old",
      parentId: null,
      metadataDocumentId: null,
      systemSlot: null,
      localCreatedAt: stale,
      localUpdatedAt: stale,
      serverCreatedAt: stale,
      serverUpdatedAt: stale,
    });
    await db.insert(documentContainerProjection).values({
      containerId: "child",
      documentId: "doc-remote-old",
      updatedAt: stale,
    });
    await db.insert(containerDocumentTombstoneHolds).values({
      containerId: "child",
      documentId: "doc-remote-old",
      tombstonedAt: stale,
      updatedAt: stale,
    });

    const store = createDocumentDiscoveryEvidenceStore(execSql);
    const generation = await store.begin();
    const candidate = {
      documentId: "doc-remote-old",
      containerId: "child",
      listedContainerIds: ["child"],
      accessEpoch: 1,
      accessStateHash: "old-head",
      createdAt: stale,
      linkedContainerIds: ["child"],
    };
    const head = {
      accessEpoch: 1,
      accessStateHash: "old-head",
      linkedContainerIds: ["child"],
    };
    await store.stage(
      [candidate, { ...candidate, documentId: "pending-only" }],
      generation,
    );
    await store.stage(
      [
        {
          ...candidate,
          documentId: "other-doc",
          containerId: "other-org",
          listedContainerIds: ["other-org"],
        },
      ],
      generation,
    );
    await store.saveHead(candidate.documentId, head, generation);
    await clearRemoteSyncState(execSql, { organizationId: "org-old" });
    expect(await store.pending(["child"], 32)).toEqual([]);
    expect(await store.pending(["other-org"], 32)).toHaveLength(1);
    expect(await db.select().from(documentDiscoveryHeads)).toEqual([]);
    expect(await db.select().from(documentDiscoverySequence)).toMatchObject([
      { generation, invalidatedThrough: generation },
    ]);
    expect(await store.stage([candidate], generation)).toBe(false);
    expect(await store.saveHead(candidate.documentId, head, generation)).toBe(
      false,
    );
    const newer = await store.begin();
    expect(newer).toBeGreaterThan(generation);
    expect(await store.stage([candidate], newer)).toBe(true);
    expect(await store.saveHead(candidate.documentId, head, newer)).toBe(true);

    expect(await db.select().from(containerDocumentTombstoneHolds)).toEqual([]);
    expect(await db.select().from(documentContainerProjection)).toEqual([]);
  } finally {
    close();
  }
});
