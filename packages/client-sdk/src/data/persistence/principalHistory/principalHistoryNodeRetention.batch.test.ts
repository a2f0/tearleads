import { expect, test } from "bun:test";
import type { PrincipalHistoryIndexNode } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { and, asc, eq } from "drizzle-orm";
import {
  principalHistoryEntries,
  principalHistoryEvidenceTables,
  principalHistoryNodes,
} from "../../sqlite/schema/principalHistoryEvidenceSchema";
import { principalHistoryNodeReferences } from "../../sqlite/schema/principalHistoryNodeRetentionSchema";
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
  type PrincipalHistoryEvidencePage,
  writePrincipalHistoryEvidencePage,
} from "./principalHistoryEvidencePersistence";
import { writePrincipalHistoryNodes } from "./principalHistoryNodeRetention";
import {
  decrementPrincipalHistoryNodeReference,
  incrementPrincipalHistoryNodeReference,
  type PrincipalHistoryNodeScope,
} from "./principalHistoryRootOwnership";

type WriteNodes = typeof writePrincipalHistoryNodes;
type NodeReference = typeof principalHistoryNodeReferences.$inferInsert;
type NodeRow = typeof principalHistoryNodes.$inferInsert;

/** The per-node writer the batch replaced, kept as reference behavior. */
const writeOneNodeAtATime: WriteNodes = async (tx, scope, nodes) => {
  for (const node of nodes) {
    const [previous] = await tx
      .select()
      .from(principalHistoryNodeReferences)
      .where(
        and(
          eq(principalHistoryNodeReferences.scopeId, scope.scopeId),
          eq(principalHistoryNodeReferences.hash, node.hash),
        ),
      )
      .limit(1);
    if (
      previous?.leftHash !== node.leftHash ||
      previous.rightHash !== node.rightHash
    ) {
      const [existing] = await tx
        .select({ hash: principalHistoryNodes.hash })
        .from(principalHistoryNodes)
        .where(
          and(
            eq(principalHistoryNodes.scopeId, scope.scopeId),
            eq(principalHistoryNodes.hash, node.hash),
          ),
        )
        .limit(1);
      for (const hash of [node.leftHash, node.rightHash])
        await incrementPrincipalHistoryNodeReference(tx, scope, hash);
      await tx
        .insert(principalHistoryNodeReferences)
        .values({
          ...scope,
          ...node,
          referenceCount: previous?.referenceCount ?? 0,
          managed: previous?.managed || !existing,
        })
        .onConflictDoUpdate({
          target: [
            principalHistoryNodeReferences.scopeId,
            principalHistoryNodeReferences.hash,
          ],
          set: {
            leftHash: node.leftHash,
            rightHash: node.rightHash,
            managed: previous?.managed || !existing,
          },
        })
        .run();
      for (const hash of [previous?.leftHash, previous?.rightHash])
        if (hash) await decrementPrincipalHistoryNodeReference(tx, scope, hash);
    }
    const row = { ...scope, ...node };
    await tx
      .insert(principalHistoryNodes)
      .values(row)
      .onConflictDoUpdate({
        target: [principalHistoryNodes.scopeId, principalHistoryNodes.hash],
        set: row,
      })
      .run();
  }
};

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

async function nodeDatabase(key: string) {
  const sqlite = await createTestExecSql(key);
  await ensureSqlTables(sqlite.execSql, principalHistoryEvidenceTables);
  const runtime = getClientSQLitePersistenceRuntime(sqlite.execSql);
  return {
    ...sqlite,
    async run(
      write: WriteNodes,
      scope: PrincipalHistoryNodeScope,
      seed: { references: NodeReference[]; nodes: NodeRow[] },
      pages: readonly (readonly PrincipalHistoryIndexNode[])[],
    ) {
      await runtime.transaction(async (tx: ClientSQLiteTransactionScope) => {
        for (const reference of seed.references)
          await tx
            .insert(principalHistoryNodeReferences)
            .values(reference)
            .onConflictDoNothing()
            .run();
        for (const node of seed.nodes)
          await tx
            .insert(principalHistoryNodes)
            .values(node)
            .onConflictDoNothing()
            .run();
      });
      for (const page of pages)
        await runtime.transaction((tx) => write(tx, scope, page));
      return {
        references: await runtime.db
          .select()
          .from(principalHistoryNodeReferences)
          .where(eq(principalHistoryNodeReferences.scopeId, scope.scopeId))
          .orderBy(asc(principalHistoryNodeReferences.hash)),
        nodes: await runtime.db
          .select()
          .from(principalHistoryNodes)
          .where(eq(principalHistoryNodes.scopeId, scope.scopeId))
          .orderBy(asc(principalHistoryNodes.hash)),
      };
    },
  };
}

test("batched node writes match the per-node writer on random stored graphs", async () => {
  const reference = await nodeDatabase("principal-node-loop");
  const batched = await nodeDatabase("principal-node-batch");
  try {
    const random = seededRandom(2544);
    const hashes = ["h0", "h1", "h2", "h3", "h4", "h5", "h6", "h7"];
    const pick = () => {
      const hash = hashes[Math.floor(random() * hashes.length)];
      if (!hash) throw new Error("Empty choice");
      return hash;
    };
    const node = (hash = pick()): PrincipalHistoryIndexNode => ({
      hash,
      leftHash: pick(),
      rightHash: pick(),
    });
    let edgeChanges = 0;
    for (let iteration = 0; iteration < 300; iteration++) {
      const scope = { scopeId: `scope-${iteration}`, organizationId: "org-1" };
      const references = hashes
        .filter(() => random() < 0.5)
        .map((hash): NodeReference => {
          const edges = random() < 0.5 ? node(hash) : null;
          return {
            ...scope,
            // A foreign organization's row in the same scope is never decremented.
            organizationId: random() < 0.2 ? "org-2" : "org-1",
            hash,
            referenceCount: Math.floor(random() * 3),
            managed: random() < 0.5,
            leftHash: edges?.leftHash ?? null,
            rightHash: edges?.rightHash ?? null,
          };
        });
      const nodes = hashes
        .filter(() => random() < 0.4)
        .map((hash): NodeRow => ({ ...scope, ...node(hash) }));
      const pages = Array.from({ length: 1 + Math.floor(random() * 2) }, () =>
        Array.from({ length: 1 + Math.floor(random() * 6) }, () => {
          const stored = references[Math.floor(random() * references.length)];
          // Unchanged edges take the early return; repeated hashes stay in.
          return stored?.leftHash && stored.rightHash && random() < 0.3
            ? {
                hash: stored.hash,
                leftHash: stored.leftHash,
                rightHash: stored.rightHash,
              }
            : node();
        }),
      );
      const seed = { references, nodes };
      const expected = await reference.run(
        writeOneNodeAtATime,
        scope,
        seed,
        pages,
      );
      const actual = await batched.run(
        writePrincipalHistoryNodes,
        scope,
        seed,
        pages,
      );
      expect(actual).toEqual(expected);
      edgeChanges += expected.references.length;
    }
    expect(edgeChanges).toBeGreaterThan(300);
  } finally {
    reference.close();
    batched.close();
  }
});

/** A complete history index over `leaves` leaves, children before parents. */
function historyPage(
  leaves: number,
  prefix: string,
): PrincipalHistoryEvidencePage {
  const nodes: PrincipalHistoryIndexNode[] = [];
  let level = Array.from(
    { length: leaves },
    (_, index) => `${prefix}leaf-${index}`,
  );
  for (let depth = 1; level.length > 1; depth++) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const [leftHash, rightHash] = [level[index], level[index + 1]];
      if (!leftHash || !rightHash) throw new Error("Unbalanced fixture");
      const hash = `${prefix}node-${depth}-${index / 2}`;
      nodes.push({ hash, leftHash, rightHash });
      next.push(hash);
    }
    level = next;
  }
  return {
    indexRootHash: level[0] ?? "",
    scopeId: "scope-1",
    organizationId: "org-1",
    entries: Array.from({ length: leaves }, (_, index) => ({
      leafHash: `${prefix}leaf-${index}`,
      entryJson: JSON.stringify({ version: index + 1 }),
    })),
    nodes,
  };
}

function countingExecSql(execSql: ExecSql) {
  const counter = { statements: 0 };
  return {
    counter,
    execSql: createExecSql({
      async exec({ sql, bind, rowMode }) {
        counter.statements += 1;
        const rows =
          rowMode === "array"
            ? await execSql(sql, bind, { rowMode: "array" })
            : await execSql(sql, bind);
        return { rows };
      },
    }),
  };
}

test("saving a 128-entry evidence page takes a constant number of statements", async () => {
  const sqlite = await createTestExecSql("principal-evidence-budget");
  try {
    await ensureSqlTables(sqlite.execSql, principalHistoryEvidenceTables);
    const counted = countingExecSql(sqlite.execSql);
    const runtime = getClientSQLitePersistenceRuntime(counted.execSql);
    const save = async (page: PrincipalHistoryEvidencePage) => {
      counted.counter.statements = 0;
      await runtime.transaction(
        (tx) => writePrincipalHistoryEvidencePage(tx, page),
        { behavior: "immediate" },
      );
      return counted.counter.statements;
    };
    const page = historyPage(128, "");
    expect(page.nodes).toHaveLength(127);
    // BEGIN, entries, reference and node lookups, two 142-row reference
    // upserts, one node upsert, COMMIT (was 899 inside the transaction).
    expect(await save(page)).toBe(8);
    // An identical page only rewrites entries and nodes (was 391).
    expect(await save(page)).toBe(6);
    const { db } = getClientSQLitePersistenceRuntime(sqlite.execSql);
    expect(await db.select().from(principalHistoryEntries)).toHaveLength(128);
    expect(await db.select().from(principalHistoryNodes)).toHaveLength(127);
    expect(await db.select().from(principalHistoryNodeReferences)).toHaveLength(
      255,
    );
  } finally {
    sqlite.close();
  }
});

test("an evidence page matches the per-node writer for new, repeated and appended pages", async () => {
  const reference = await nodeDatabase("principal-evidence-loop");
  const batched = await nodeDatabase("principal-evidence-batch");
  try {
    const scope = { scopeId: "scope-1", organizationId: "org-1" };
    const first = historyPage(128, "");
    const next = historyPage(64, "next-");
    // The appended page reuses the first page's root as a child.
    const appended = [
      ...next.nodes,
      {
        hash: "joined-root",
        leftHash: first.indexRootHash,
        rightHash: next.indexRootHash,
      },
    ];
    const pages = [first.nodes, first.nodes, appended, first.nodes];
    const seed = { references: [], nodes: [] };
    expect(
      await batched.run(writePrincipalHistoryNodes, scope, seed, pages),
    ).toEqual(await reference.run(writeOneNodeAtATime, scope, seed, pages));
  } finally {
    reference.close();
    batched.close();
  }
});
