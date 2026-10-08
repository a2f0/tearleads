import { expect, test } from "bun:test";
import type { PrincipalHistoryIndexNode } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  principalHistoryEvidenceTables,
  principalHistoryNodes,
} from "../sqlite/principalHistoryEvidenceSchema";
import {
  principalHistoryNodeReferences,
  principalHistoryNodeRetentionTables,
  principalHistoryRootOwners,
} from "../sqlite/principalHistoryNodeRetentionSchema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../sqlite/sqlitePersistenceRuntime";
import {
  createExecSql,
  type ExecSql,
  ensureSqlTables,
} from "../sqlite/sqlSchema";
import {
  reclaimPrincipalHistoryNodes,
  recordPrincipalHistoryNodeEdges,
} from "./principalHistoryNodeRetention";
import {
  releasePrincipalHistoryRoot,
  retainPrincipalHistoryRoot,
} from "./principalHistoryRootOwnership";

const scope = { scopeId: "scope-1", organizationId: "org-1" };
const shared = { hash: "shared", leftHash: "leaf-1", rightHash: "leaf-2" };
const old = { hash: "old", leftHash: "shared", rightHash: "leaf-3" };
const next = { hash: "next", leftHash: "shared", rightHash: "leaf-4" };

async function fixture() {
  const sqlite = await createTestExecSql("principal-proof-retention");
  await ensureSqlTables(sqlite.execSql, [
    ...principalHistoryEvidenceTables,
    ...principalHistoryNodeRetentionTables,
  ]);
  const runtime = getClientSQLitePersistenceRuntime(sqlite.execSql);
  return {
    ...sqlite,
    ...runtime,
    snapshot: async () => ({
      nodes: await runtime.db.select().from(principalHistoryNodes),
      references: await runtime.db
        .select()
        .from(principalHistoryNodeReferences),
      owners: await runtime.db.select().from(principalHistoryRootOwners),
    }),
  };
}

async function putNodes(
  tx: ClientSQLiteTransactionScope,
  nodes: readonly PrincipalHistoryIndexNode[],
) {
  for (const node of nodes) {
    await recordPrincipalHistoryNodeEdges(tx, scope, node);
    await tx
      .insert(principalHistoryNodes)
      .values({ ...scope, ...node })
      .onConflictDoNothing()
      .run();
  }
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
        await retainPrincipalHistoryRoot(tx, { ...scope, id, rootHash });
      }
      expect(await reclaimPrincipalHistoryNodes(tx, scope)).toBe(0);
      await releasePrincipalHistoryRoot(tx, "stage-old");
      expect(await reclaimPrincipalHistoryNodes(tx, scope)).toBe(0);
      await retainPrincipalHistoryRoot(tx, {
        ...scope,
        id: "prefix",
        rootHash: "next",
      });
      expect(await reclaimPrincipalHistoryNodes(tx, scope)).toBe(1);
    });
    expect((await f.snapshot()).nodes.map((node) => node.hash).sort()).toEqual([
      "next",
      "shared",
    ]);
    await f.transaction(async (tx) => {
      await releasePrincipalHistoryRoot(tx, "prefix");
      await releasePrincipalHistoryRoot(tx, "stage-next");
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
        await retainPrincipalHistoryRoot(tx, {
          ...scope,
          id: "stage",
          rootHash: "old",
        });
      }
    });
    expect(
      (await f.snapshot()).references.every((row) => row.referenceCount === 1),
    ).toBe(true);
    await f.transaction(async (tx) => {
      await releasePrincipalHistoryRoot(tx, "stage");
      await releasePrincipalHistoryRoot(tx, "stage");
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
    await f.db.insert(principalHistoryNodes).values({ ...scope, ...shared });
    await f.transaction(async (tx) => {
      await putNodes(tx, [shared, old]);
      await retainPrincipalHistoryRoot(tx, {
        ...scope,
        id: "stage",
        rootHash: "old",
      });
      await releasePrincipalHistoryRoot(tx, "stage");
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
        await recordPrincipalHistoryNodeEdges(tx, foreign, node);
        await tx
          .insert(principalHistoryNodes)
          .values({ ...foreign, ...node })
          .run();
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
      await retainPrincipalHistoryRoot(tx, {
        ...scope,
        id: "stage",
        rootHash: "old",
      });
    });
    const before = await f.snapshot();
    let current = true;
    let reclaimed = 0;
    const result = await f.guardedTransaction(
      async (tx) => {
        await releasePrincipalHistoryRoot(tx, "stage");
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
      expect.stringContaining("principal_history_node_references_reclaim_idx"),
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
