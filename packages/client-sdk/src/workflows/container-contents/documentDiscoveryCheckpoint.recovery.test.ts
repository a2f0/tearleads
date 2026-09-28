import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { createDocumentDiscoveryEvidenceStore } from "../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import {
  accessManifestCheckpoints,
  clientSqlTables,
} from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";

test("discovery uses the replacement organization's pin while retaining the old pin", async () => {
  const { close, execSql } = await createTestExecSql("discovery-recovery-pins");
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    await db.insert(accessManifestCheckpoints).values([
      {
        objectKind: "document",
        organizationId: "old-org",
        objectId: "document",
        epoch: 9,
        manifestHash: "old-head",
        updatedAt: "2026-09-28",
      },
      {
        objectKind: "document",
        organizationId: "new-org",
        objectId: "document",
        epoch: 1,
        manifestHash: "new-head",
        updatedAt: "2026-09-28",
      },
    ]);
    const store = createDocumentDiscoveryEvidenceStore(execSql);
    const head = {
      organizationId: "new-org",
      accessEpoch: 1,
      accessStateHash: "new-head",
      linkedContainerIds: ["new-root"],
    };
    await store.saveHead("document", head, await store.begin());
    expect(await store.loadHead("document", "new-head")).toMatchObject({
      accessEpoch: 1,
      accessStateHash: "new-head",
      linkedContainerIds: ["new-root"],
    });

    // A replayed old-organization head must not strand the replacement cache
    // behind that other organization's higher epoch counter.
    await store.saveHead(
      "document",
      {
        organizationId: "old-org",
        accessEpoch: 9,
        accessStateHash: "old-head",
        linkedContainerIds: ["old-root"],
      },
      await store.begin(),
    );
    await store.saveHead("document", head, await store.begin());
    expect(await store.loadHead("document", "new-head")).toEqual(head);

    // A newer pin in the same organization must still invalidate cached links.
    await db
      .update(accessManifestCheckpoints)
      .set({ epoch: 2, manifestHash: "unlinked-head" })
      .where(eq(accessManifestCheckpoints.organizationId, "new-org"));
    expect(await store.loadHead("document", "new-head")).toBeNull();
    expect(await db.select().from(accessManifestCheckpoints)).toHaveLength(2);
    // A matching pin from another organization cannot authorize the cached head.
    await db
      .delete(accessManifestCheckpoints)
      .where(eq(accessManifestCheckpoints.organizationId, "new-org"));
    await db
      .update(accessManifestCheckpoints)
      .set({ epoch: 1, manifestHash: "new-head" })
      .where(eq(accessManifestCheckpoints.organizationId, "old-org"));
    expect(await store.loadHead("document", "new-head")).toBeNull();
  } finally {
    close();
  }
});
