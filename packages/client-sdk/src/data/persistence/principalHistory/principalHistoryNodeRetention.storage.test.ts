import { expect, test } from "bun:test";
import type { PrincipalHistoryIndexNode } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import {
  principalHistoryEvidenceTables,
  principalHistoryNodes,
} from "../../sqlite/schema/principalHistoryEvidenceSchema";
import {
  principalHistoryStages,
  principalHistoryStageTables,
} from "../../sqlite/schema/principalHistoryStageSchema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import {
  createExecSql,
  type ExecSql,
  ensureSqlTables,
} from "../../sqlite/sqlSchema";
import {
  reclaimPrincipalHistoryNodes,
  writePrincipalHistoryNodes,
} from "./principalHistoryNodeRetention";
import {
  principalHistoryRootRetention,
  principalHistoryStageRootOwnerColumns,
  releasePrincipalHistoryRoot,
  writePrincipalHistoryRootEdges,
} from "./principalHistoryRootOwnership";

const scope = { scopeId: "scope-1", organizationId: "org-1" };
const shared = { hash: "shared", leftHash: "leaf-1", rightHash: "leaf-2" };
const old = { hash: "old", leftHash: "shared", rightHash: "leaf-3" };
const next = { hash: "next", leftHash: "shared", rightHash: "leaf-4" };

/** Saves a stage row owning `rootHash`, as stage persistence does. */
async function retainStageRoot(
  tx: ClientSQLiteTransactionScope,
  id: string,
  rootHash: string,
) {
  const [previous] = await tx
    .select(principalHistoryStageRootOwnerColumns)
    .from(principalHistoryStages)
    .where(eq(principalHistoryStages.id, id))
    .limit(1);
  const root = { ...scope, rootHash };
  const row = {
    ...root,
    id,
    currentJson: "{}",
    afterVersion: 0,
    complete: false,
    touchedAt: 0,
    progress: id,
  };
  await tx
    .insert(principalHistoryStages)
    .values(row)
    .onConflictDoUpdate({ target: principalHistoryStages.id, set: row })
    .run();
  await writePrincipalHistoryRootEdges(
    tx,
    principalHistoryRootRetention(previous, root),
  );
}

/** Discards a stage row and the root it owns. */
async function releaseStageRoot(tx: ClientSQLiteTransactionScope, id: string) {
  const [owner] = await tx
    .select(principalHistoryStageRootOwnerColumns)
    .from(principalHistoryStages)
    .where(eq(principalHistoryStages.id, id))
    .limit(1);
  if (!owner) return;
  await releasePrincipalHistoryRoot(tx, owner);
  await tx
    .delete(principalHistoryStages)
    .where(eq(principalHistoryStages.id, id))
    .run();
}

async function fixture() {
  const sqlite = await createTestExecSql("principal-proof-retention");
  await ensureSqlTables(sqlite.execSql, [
    ...principalHistoryEvidenceTables,
    ...principalHistoryStageTables,
  ]);
  const runtime = getClientSQLitePersistenceRuntime(sqlite.execSql);
  return {
    ...sqlite,
    ...runtime,
    snapshot: async () => {
      const references = await runtime.db.select().from(principalHistoryNodes);
      return {
        // Stored nodes are the rows that carry child hashes.
        nodes: references.flatMap(
          ({ scopeId, organizationId, hash, leftHash, rightHash }) =>
            leftHash && rightHash
              ? [{ scopeId, organizationId, hash, leftHash, rightHash }]
              : [],
        ),
        references,
        owners: await runtime.db
          .select({
            id: principalHistoryStages.id,
            rootHash: principalHistoryStages.rootHash,
          })
          .from(principalHistoryStages),
      };
    },
  };
}

async function putNodes(
  tx: ClientSQLiteTransactionScope,
  nodes: readonly PrincipalHistoryIndexNode[],
) {
  await writePrincipalHistoryNodes(tx, scope, nodes);
}

test("shared nodes survive root replacement and the last owner releases the obsolete graph", async () => {
  const f = await fixture();
  try {
    await f.transaction(async (tx) => {
      await putNodes(tx, [old, next, shared]);
      for (const [id, rootHash] of [
        ["stage-old", "old"],
        ["prefix", "old"],
        ["stage-next", "next"],
      ]) {
        if (!id || !rootHash) throw new Error("Missing root fixture");
        await retainStageRoot(tx, id, rootHash);
      }
      expect(await reclaimPrincipalHistoryNodes(tx, scope)).toBe(0);
      await releaseStageRoot(tx, "stage-old");
      expect(await reclaimPrincipalHistoryNodes(tx, scope)).toBe(0);
      await retainStageRoot(tx, "prefix", "next");
      expect(await reclaimPrincipalHistoryNodes(tx, scope)).toBe(1);
    });
    expect((await f.snapshot()).nodes.map((node) => node.hash).sort()).toEqual([
      "next",
      "shared",
    ]);
    await f.transaction(async (tx) => {
      await releaseStageRoot(tx, "prefix");
      await releaseStageRoot(tx, "stage-next");
      expect(await reclaimPrincipalHistoryNodes(tx, scope)).toBe(2);
    });
    expect((await f.snapshot()).nodes).toEqual([]);
    expect((await f.snapshot()).owners).toEqual([]);
  } finally {
    f.close();
  }
});

test("repeated evidence and owner writes do not accumulate references", async () => {
  const f = await fixture();
  try {
    await f.transaction(async (tx) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await putNodes(tx, [old, shared]);
        await retainStageRoot(tx, "stage", "old");
      }
    });
    expect(
      (await f.snapshot()).references.every((row) => row.referenceCount === 1),
    ).toBe(true);
    await f.transaction(async (tx) => {
      await releaseStageRoot(tx, "stage");
      await releaseStageRoot(tx, "stage");
      expect(await reclaimPrincipalHistoryNodes(tx, scope)).toBe(2);
    });
    expect((await f.snapshot()).nodes).toEqual([]);
  } finally {
    f.close();
  }
});

test("pre-index nodes stay available after a newly indexed parent is reclaimed", async () => {
  const f = await fixture();
  try {
    await f.db
      .insert(principalHistoryNodes)
      .values({ ...scope, ...shared, referenceCount: 0, managed: false });
    await f.transaction(async (tx) => {
      await putNodes(tx, [shared, old]);
      await retainStageRoot(tx, "stage", "old");
      await releaseStageRoot(tx, "stage");
      expect(await reclaimPrincipalHistoryNodes(tx, scope)).toBe(1);
    });
    expect((await f.snapshot()).nodes).toEqual([{ ...scope, ...shared }]);
  } finally {
    f.close();
  }
});

test("reclamation cascades through at most 64 nodes and stays within scope and organization", async () => {
  const f = await fixture();
  try {
    const nodes = Array.from({ length: 100 }, (_, index) => ({
      hash: `node-${index}`,
      leftHash: index === 0 ? "leaf" : `node-${index - 1}`,
      rightHash: `right-${index}`,
    }));
    await f.transaction(async (tx) => {
      await putNodes(tx, nodes);
      for (const foreign of [
        { scopeId: "scope-2", organizationId: "org-1" },
        { scopeId: "scope-1", organizationId: "org-2" },
      ]) {
        const node = {
          ...shared,
          hash: foreign.organizationId + foreign.scopeId,
        };
        await writePrincipalHistoryNodes(tx, foreign, [node]);
      }
      expect(await reclaimPrincipalHistoryNodes(tx, scope)).toBe(64);
    });
    expect((await f.snapshot()).nodes).toHaveLength(38);
    await f.transaction(async (tx) => {
      expect(await reclaimPrincipalHistoryNodes(tx, scope)).toBe(36);
    });
    expect((await f.snapshot()).nodes).toHaveLength(2);
  } finally {
    f.close();
  }
});

test("guard rejection rolls back root changes, edge counts and proof deletion", async () => {
  const f = await fixture();
  try {
    await f.transaction(async (tx) => {
      await putNodes(tx, [old, shared]);
      await retainStageRoot(tx, "stage", "old");
    });
    const before = await f.snapshot();
    let current = true;
    let reclaimed = 0;
    const result = await f.guardedTransaction(
      async (tx) => {
        await releaseStageRoot(tx, "stage");
        reclaimed = await reclaimPrincipalHistoryNodes(tx, scope);
        current = false;
      },
      () => current,
    );
    expect(reclaimed).toBe(2);
    expect(result.committed).toBe(false);
    expect(await f.snapshot()).toEqual(before);
  } finally {
    f.close();
  }
});

test("unreferenced node selection uses the scoped liveness index without a full scan or sort", async () => {
  const f = await fixture();
  let selection: { sql: string; bind: Parameters<ExecSql>[1] } | undefined;
  const execSql = createExecSql({
    exec: async ({ sql, bind, rowMode }) => {
      if (
        sql.startsWith("select ") &&
        sql.includes('"managed" = ?') &&
        sql.includes("order by")
      )
        selection = { sql, bind };
      return {
        rows: await f.execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  });
  try {
    await f.transaction((tx) => putNodes(tx, [old, shared]));
    await getClientSQLitePersistenceRuntime(execSql).transaction((tx) =>
      reclaimPrincipalHistoryNodes(tx, scope),
    );
    if (!selection) throw new Error("Missing node reclamation selection");
    const plan = await f.execSql(
      `EXPLAIN QUERY PLAN ${selection.sql}`,
      selection.bind,
    );
    const details = plan.map((row) => String(Reflect.get(row, "detail")));
    expect(details).toContainEqual(
      expect.stringContaining("principal_history_nodes_reclaim_idx"),
    );
    expect(
      details.some(
        (detail) =>
          detail.startsWith("SCAN ") || detail.includes("USE TEMP B-TREE"),
      ),
    ).toBe(false);
  } finally {
    f.close();
  }
});
