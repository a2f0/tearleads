import { beforeAll, expect, test } from "bun:test";
import { type DatabaseSession, db } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  accessManifests,
} from "@tearleads/api-shared/schema";
import { type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { isSqliteApiDatabase } from "../../utils/sqlDialect";
import { listCurrentContainerKekTargetClosureIdsMapped } from "./containerKekTargets";

const organizationId = crypto.randomUUID();
const rootId = crypto.randomUUID();
const childId = crypto.randomUUID();

function manifestRow(id: string, parentContainerId: string | null) {
  return {
    version: 1,
    objectKind: "container" as const,
    objectId: id,
    organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: `closure-plan-event:${id}`,
    structuralHash: "structure",
    grantRoot: "grants",
    referencedPrincipalHeads: [],
    keyTargetHash: "keys",
    manifestHash: `closure-plan-manifest:${id}`,
    state: {
      version: 1,
      containerId: id,
      containerKeyEpochId: `key:${id}`,
      parentContainerId,
    },
  };
}

async function insertContainers(
  rows: readonly ReturnType<typeof manifestRow>[],
): Promise<void> {
  await db.insert(accessManifests).values([...rows]);
  await db.insert(accessManifestHeads).values(
    rows.map((row) => ({
      objectKind: row.objectKind,
      objectId: row.objectId,
      organizationId,
      epoch: row.epoch,
      manifestHash: row.manifestHash,
    })),
  );
}

beforeAll(async () => {
  await insertContainers([
    manifestRow(rootId, null),
    manifestRow(childId, rootId),
  ]);
});

function closure(
  containerIds: readonly string[],
  executor: DatabaseSession = db,
) {
  return listCurrentContainerKekTargetClosureIdsMapped(
    containerIds,
    executor,
    (message) => new Error(message),
  );
}

test("the ancestor closure walks a child to its root", async () => {
  expect(await closure([childId])).toEqual([childId, rootId].sort());
});

// Only the exact lowercase canonical id names a parent, on both backends, as
// the text equality the uuid lookup replaced did. Malformed text must match
// nothing rather than fail the statement on Postgres's uuid cast.
test.each([
  ["uppercase", () => rootId.toUpperCase()],
  ["malformed", () => `${rootId}-not-a-uuid`],
])("an ancestor named by %s text is not resolved", async (_label, parentOf) => {
  const orphanId = crypto.randomUUID();
  await insertContainers([manifestRow(orphanId, parentOf())]);
  await expect(closure([orphanId])).rejects.toThrow(
    "Container KEK parent target is missing",
  );
});

async function capturedClosureQuery(): Promise<SQL> {
  let captured: SQL | undefined;
  const recording = {
    execute: (query: SQL) => {
      captured = query;
      return db.execute(query);
    },
  } as unknown as DatabaseSession;
  await closure([childId], recording);
  if (!captured) throw new Error("Expected the closure to run its query");
  return captured;
}

// Each recursive level must be one index lookup. SQLite otherwise drove the step
// from every container head, so the walk grew with the whole table: with 8,000
// unrelated heads, closing 101 seeds took 23 s and stalled CI past its timeout.
test.skipIf(!isSqliteApiDatabase())(
  "each ancestor level is one head index lookup on SQLite",
  async () => {
    const plan = await db.execute(
      sql`explain query plan ${await capturedClosureQuery()}`,
    );
    const details = plan.rows.map(({ detail }) => String(detail));
    const stepStart = details.indexOf("RECURSIVE STEP");
    expect(stepStart).toBeGreaterThan(0);
    const recursiveStep = details.slice(stepStart);
    expect(recursiveStep).toContain(
      "SEARCH h USING INDEX access_manifest_heads_object_idx (object_kind=? AND object_id=?)",
    );
    expect(recursiveStep).not.toContain(
      "SEARCH h USING INDEX access_manifest_heads_object_idx (object_kind=?)",
    );
  },
);

// Postgres can use the head index only while the recursive step compares the
// uuid column in its own type; casting it to text, as before, rules the index
// out. The planner's choice on these tiny tables says nothing at scale, so this
// checks the comparison the query actually sends.
test.skipIf(isSqliteApiDatabase())(
  "each ancestor level compares the head id as a uuid on Postgres",
  async () => {
    const query = await capturedClosureQuery();
    const { sql: text } = new PgDialect().sqlToQuery(query);
    expect(text).toContain("h.object_id = case when");
    expect(text).not.toContain("h.object_id::text = ");
  },
);
