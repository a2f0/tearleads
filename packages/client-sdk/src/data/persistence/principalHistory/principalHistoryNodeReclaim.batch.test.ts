import { expect, test } from "bun:test";
import type { PrincipalHistoryIndexNode } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { and, asc, eq } from "drizzle-orm";
import {
  principalHistoryEvidenceTables,
  principalHistoryNodes,
} from "../../sqlite/schema/principalHistoryEvidenceSchema";
import {
  principalHistoryNodeReferences,
  principalHistoryNodeRetentionTables,
  principalHistoryRootOwners,
} from "../../sqlite/schema/principalHistoryNodeRetentionSchema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import {
  createExecSql,
  type ExecSql,
  ensureSqlTables,
} from "../../sqlite/sqlSchema";
import { writePrincipalHistoryEvidencePage } from "./principalHistoryEvidencePersistence";
import { reclaimPrincipalHistoryNodes } from "./principalHistoryNodeRetention";
import {
  decrementPrincipalHistoryNodeReference,
  foldablePrincipalHistoryRootEdges,
  loadPrincipalHistoryRootRetention,
  type PrincipalHistoryNodeScope,
  retainPrincipalHistoryRoot,
  writePrincipalHistoryRootRetention,
} from "./principalHistoryRootOwnership";

type Reclaim = typeof reclaimPrincipalHistoryNodes;
type NodeReference = typeof principalHistoryNodeReferences.$inferInsert;
type NodeRow = typeof principalHistoryNodes.$inferInsert;
type OwnerRow = typeof principalHistoryRootOwners.$inferInsert;

/** The per-node reclamation the set statements replaced, kept as reference behavior. */
const reclaimOneNodeAtATime: Reclaim = async (tx, scope) => {
  let reclaimed = 0;
  while (reclaimed < 64) {
    const obsolete = await tx
      .select()
      .from(principalHistoryNodeReferences)
      .where(
        and(
          eq(principalHistoryNodeReferences.scopeId, scope.scopeId),
          eq(
            principalHistoryNodeReferences.organizationId,
            scope.organizationId,
          ),
          eq(principalHistoryNodeReferences.managed, true),
          eq(principalHistoryNodeReferences.referenceCount, 0),
        ),
      )
      .orderBy(asc(principalHistoryNodeReferences.hash))
      .limit(64 - reclaimed);
    if (obsolete.length === 0) break;
    for (const node of obsolete) {
      await tx
        .delete(principalHistoryNodes)
        .where(
          and(
            eq(principalHistoryNodes.scopeId, scope.scopeId),
            eq(principalHistoryNodes.organizationId, scope.organizationId),
            eq(principalHistoryNodes.hash, node.hash),
          ),
        )
        .run();
      await tx
        .delete(principalHistoryNodeReferences)
        .where(
          and(
            eq(principalHistoryNodeReferences.scopeId, scope.scopeId),
            eq(principalHistoryNodeReferences.hash, node.hash),
          ),
        )
        .run();
      for (const hash of [node.leftHash, node.rightHash])
        if (hash) await decrementPrincipalHistoryNodeReference(tx, scope, hash);
      reclaimed += 1;
    }
  }
  return reclaimed;
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

interface Seed {
  readonly references: NodeReference[];
  readonly nodes: NodeRow[];
  readonly owners?: OwnerRow[];
}

async function retentionDatabase(key: string) {
  const sqlite = await createTestExecSql(key);
  await ensureSqlTables(sqlite.execSql, [
    ...principalHistoryEvidenceTables,
    ...principalHistoryNodeRetentionTables,
  ]);
  const counter = { statements: 0 };
  const counted: ExecSql = createExecSql({
    async exec({ sql, bind, rowMode }) {
      counter.statements += 1;
      const rows =
        rowMode === "array"
          ? await sqlite.execSql(sql, bind, { rowMode: "array" })
          : await sqlite.execSql(sql, bind);
      return { rows };
    },
  });
  const runtime = getClientSQLitePersistenceRuntime(counted);
  return {
    ...sqlite,
    counter,
    async seed(seed: Seed) {
      await runtime.transaction(async (tx) => {
        for (const table of [
          principalHistoryNodeReferences,
          principalHistoryNodes,
          principalHistoryRootOwners,
        ])
          await tx.delete(table).run();
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
        for (const owner of seed.owners ?? [])
          await tx.insert(principalHistoryRootOwners).values(owner).run();
      });
    },
    /** Statements `work` issued, without the transaction's BEGIN and COMMIT. */
    async run<T>(
      work: (tx: ClientSQLiteTransactionScope) => Promise<T>,
    ): Promise<{ result: T; statements: number }> {
      let statements = 0;
      const result = await runtime.transaction(async (tx) => {
        counter.statements = 0;
        const value = await work(tx);
        statements = counter.statements;
        return value;
      });
      return { result, statements };
    },
    async snapshot() {
      return {
        references: await runtime.db
          .select()
          .from(principalHistoryNodeReferences)
          .orderBy(
            asc(principalHistoryNodeReferences.scopeId),
            asc(principalHistoryNodeReferences.hash),
          ),
        nodes: await runtime.db
          .select()
          .from(principalHistoryNodes)
          .orderBy(
            asc(principalHistoryNodes.scopeId),
            asc(principalHistoryNodes.hash),
          ),
        owners: await runtime.db
          .select()
          .from(principalHistoryRootOwners)
          .orderBy(asc(principalHistoryRootOwners.id)),
      };
    },
  };
}

const scope: PrincipalHistoryNodeScope = {
  scopeId: "scope-1",
  organizationId: "org-1",
};

function randomGraph(random: () => number, size: number): Seed {
  const hashes = Array.from({ length: size }, (_, index) => `h${index}`);
  const pick = () => hashes[Math.floor(random() * hashes.length)] ?? "h0";
  const references = hashes
    .filter(() => random() < 0.8)
    .map((hash): NodeReference => {
      const internal = random() < 0.7;
      return {
        // Another scope or organization sharing a hash is never touched.
        scopeId: random() < 0.1 ? "scope-2" : scope.scopeId,
        organizationId: random() < 0.15 ? "org-2" : scope.organizationId,
        hash,
        referenceCount: random() < 0.5 ? 0 : Math.floor(random() * 3),
        managed: random() < 0.8,
        leftHash: internal ? pick() : null,
        rightHash: internal ? pick() : null,
      };
    });
  const nodes = references
    .filter(() => random() < 0.8)
    .map(
      (reference): NodeRow => ({
        scopeId: reference.scopeId,
        organizationId:
          random() < 0.1 ? "org-2" : (reference.organizationId ?? ""),
        hash: reference.hash,
        leftHash: reference.leftHash ?? "leaf",
        rightHash: reference.rightHash ?? "leaf",
      }),
    );
  return { references, nodes };
}

test("set reclamation leaves the same table contents as the per-node loop after every pass", async () => {
  const reference = await retentionDatabase("principal-reclaim-loop");
  const batched = await retentionDatabase("principal-reclaim-batch");
  try {
    const random = seededRandom(2699);
    let reclaimed = 0;
    for (let iteration = 0; iteration < 200; iteration++) {
      // Some graphs exceed one pass's 64-node bound.
      const seed = randomGraph(random, iteration % 5 === 0 ? 160 : 12);
      await reference.seed(seed);
      await batched.seed(seed);
      for (let pass = 0; pass < 4; pass++) {
        const expected = await reference.run((tx) =>
          reclaimOneNodeAtATime(tx, scope),
        );
        const actual = await batched.run((tx) =>
          reclaimPrincipalHistoryNodes(tx, scope),
        );
        expect(actual.result).toBe(expected.result);
        expect(await batched.snapshot()).toEqual(await reference.snapshot());
        reclaimed += expected.result;
        if (expected.result === 0) break;
      }
    }
    expect(reclaimed).toBeGreaterThan(1000);
  } finally {
    reference.close();
    batched.close();
  }
});

test("reclaiming 64 obsolete nodes takes a constant number of statements", async () => {
  const reference = await retentionDatabase("principal-reclaim-budget-loop");
  const batched = await retentionDatabase("principal-reclaim-budget-batch");
  try {
    // 64 obsolete nodes over 64 live leaves, and a kept subtree beside them.
    const obsolete = Array.from({ length: 64 }, (_, index) => ({
      ...scope,
      hash: `obsolete-${String(index).padStart(2, "0")}`,
      leftHash: `leaf-${index}`,
      rightHash: index % 2 === 0 ? "shared-leaf" : `leaf-${index}`,
    }));
    const seed: Seed = {
      references: [
        ...obsolete.map((node) => ({
          ...node,
          referenceCount: 0,
          managed: true,
        })),
        ...Array.from({ length: 64 }, (_, index) => ({
          ...scope,
          hash: `leaf-${index}`,
          referenceCount: 3,
          managed: false,
        })),
        { ...scope, hash: "shared-leaf", referenceCount: 40, managed: false },
      ],
      nodes: obsolete,
    };
    await reference.seed(seed);
    await batched.seed(seed);
    const expected = await reference.run((tx) =>
      reclaimOneNodeAtATime(tx, scope),
    );
    const actual = await batched.run((tx) =>
      reclaimPrincipalHistoryNodes(tx, scope),
    );
    expect(actual.result).toBe(64);
    expect(expected.result).toBe(64);
    expect(await batched.snapshot()).toEqual(await reference.snapshot());
    // One select, then 4 statements per node; the bound ends the pass.
    expect(expected.statements).toBe(257);
    // One select, two deletes, one decrement per multiplicity (1, 2 and 32).
    expect(actual.statements).toBe(6);
  } finally {
    reference.close();
    batched.close();
  }
});

function randomPage(random: () => number) {
  const hashes = Array.from({ length: 10 }, (_, index) => `h${index}`);
  const pick = () => hashes[Math.floor(random() * hashes.length)] ?? "h0";
  const nodes = Array.from(
    { length: Math.floor(random() * 5) },
    (): PrincipalHistoryIndexNode => ({
      hash: pick(),
      leftHash: pick(),
      rightHash: pick(),
    }),
  );
  const pageScope =
    random() < 0.8 ? scope : { scopeId: "scope-1", organizationId: "org-2" };
  return {
    page: {
      ...pageScope,
      indexRootHash: nodes.at(-1)?.hash ?? pick(),
      entries: [],
      nodes,
    },
    owner: {
      id: "stage:1",
      scopeId: random() < 0.85 ? scope.scopeId : "scope-2",
      organizationId: random() < 0.85 ? scope.organizationId : "org-2",
      rootHash: random() < 0.7 ? (nodes.at(-1)?.hash ?? pick()) : pick(),
    },
  };
}

test("root ownership folded into the node write matches its separate statements", async () => {
  const reference = await retentionDatabase("principal-root-fold-loop");
  const batched = await retentionDatabase("principal-root-fold-batch");
  try {
    const random = seededRandom(32);
    let folded = 0;
    for (let iteration = 0; iteration < 300; iteration++) {
      const graph = randomGraph(random, 10);
      const previous = randomPage(random).owner;
      const seed = {
        ...graph,
        owners: random() < 0.75 ? [previous] : [],
      };
      const { page, owner } = randomPage(random);
      await reference.seed(seed);
      await batched.seed(seed);
      const expected = await reference.run(async (tx) => {
        await writePrincipalHistoryEvidencePage(tx, page);
        await retainPrincipalHistoryRoot(tx, owner);
      });
      const actual = await batched.run(async (tx) => {
        const retention = await loadPrincipalHistoryRootRetention(tx, owner);
        const edges = foldablePrincipalHistoryRootEdges(retention, page);
        if (edges) folded += 1;
        await writePrincipalHistoryEvidencePage(tx, page, edges);
        await writePrincipalHistoryRootRetention(tx, retention, edges);
      });
      expect(await batched.snapshot()).toEqual(await reference.snapshot());
      expect(actual.statements).toBeLessThanOrEqual(expected.statements);
    }
    expect(folded).toBeGreaterThan(100);
  } finally {
    reference.close();
    batched.close();
  }
});

test("a stage save folds its root increment and previous-root decrement", async () => {
  const reference = await retentionDatabase("principal-root-budget-loop");
  const batched = await retentionDatabase("principal-root-budget-batch");
  try {
    const nodes = [
      { hash: "root-2", leftHash: "root-1", rightHash: "leaf-3" },
      { hash: "root-1", leftHash: "leaf-1", rightHash: "leaf-2" },
    ];
    const page = { ...scope, indexRootHash: "root-2", entries: [], nodes };
    const owner = { ...scope, id: "stage:1", rootHash: "root-2" };
    const seed: Seed = {
      references: [
        {
          ...scope,
          hash: "root-1",
          referenceCount: 1,
          managed: true,
          leftHash: "leaf-1",
          rightHash: "leaf-2",
        },
      ],
      nodes: [
        { ...scope, hash: "root-1", leftHash: "leaf-1", rightHash: "leaf-2" },
      ],
      owners: [{ ...owner, rootHash: "root-1" }],
    };
    await reference.seed(seed);
    await batched.seed(seed);
    const expected = await reference.run(async (tx) => {
      await writePrincipalHistoryEvidencePage(tx, page);
      await retainPrincipalHistoryRoot(tx, owner);
    });
    const actual = await batched.run(async (tx) => {
      const retention = await loadPrincipalHistoryRootRetention(tx, owner);
      const edges = foldablePrincipalHistoryRootEdges(retention, page);
      await writePrincipalHistoryEvidencePage(tx, page, edges);
      await writePrincipalHistoryRootRetention(tx, retention, edges);
    });
    expect(await batched.snapshot()).toEqual(await reference.snapshot());
    expect(actual.statements).toBe(expected.statements - 2);
  } finally {
    reference.close();
    batched.close();
  }
});
