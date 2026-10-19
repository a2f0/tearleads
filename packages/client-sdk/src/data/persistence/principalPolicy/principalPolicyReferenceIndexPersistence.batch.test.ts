import { beforeAll, expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { and, asc, eq } from "drizzle-orm";
import { createSuccessorPrincipalPolicyBundle } from "../../../../test/helpers/policyCacheFixtures";
import { principalPolicyBundleStates } from "../../principals/principalPolicyStates";
import { principalPolicyBundleReferences } from "../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { createExecSql, type ExecSql } from "../../sqlite/sqlSchema";
import { ensurePrincipalPolicyTables } from "./principalPolicyPersistence";
import { indexPrincipalPolicyBundleInTransaction } from "./principalPolicyReferenceIndexPersistence";

type ReferenceRow = typeof principalPolicyBundleReferences.$inferInsert;
type IndexBundle = typeof indexPrincipalPolicyBundleInTransaction;

/** The per-state loop the batched index replaced, kept as reference behavior. */
const indexOneStateAtATime: IndexBundle = async (tx, bundle) => {
  const exact = (row: ReferenceRow) =>
    and(
      eq(principalPolicyBundleReferences.principalType, row.principalType),
      eq(principalPolicyBundleReferences.principalId, row.principalId),
      eq(principalPolicyBundleReferences.version, row.version),
      eq(principalPolicyBundleReferences.stateHash, row.stateHash),
      eq(principalPolicyBundleReferences.keyEpoch, row.keyEpoch),
      eq(principalPolicyBundleReferences.keyFingerprint, row.keyFingerprint),
    );
  const head = bundle.currentState;
  for (const state of principalPolicyBundleStates(bundle)) {
    if (
      state.principalType !== head.principalType ||
      state.principalId !== head.principalId
    )
      throw new KeyingVerificationError(
        "object_mismatch",
        "principal policy bundle reference belongs to another principal",
      );
    const row: ReferenceRow = {
      principalType: state.principalType,
      principalId: state.principalId,
      version: state.version,
      stateHash: state.stateHash,
      keyEpoch: state.keyEpoch,
      keyFingerprint: state.keyFingerprint,
      bundleVersion: head.version,
      bundleStateHash: head.stateHash,
    };
    const conflicts = await tx
      .select({
        bundleStateHash: principalPolicyBundleReferences.bundleStateHash,
      })
      .from(principalPolicyBundleReferences)
      .where(
        and(
          exact(row),
          eq(principalPolicyBundleReferences.bundleVersion, row.bundleVersion),
        ),
      );
    if (conflicts.some((c) => c.bundleStateHash !== row.bundleStateHash))
      throw new KeyingVerificationError(
        "equivocation",
        "principal policy reference has conflicting bundle heads at one version",
      );
    await tx
      .insert(principalPolicyBundleReferences)
      .values(row)
      .onConflictDoNothing()
      .run();
    const [stored] = await tx
      .select({ bundleVersion: principalPolicyBundleReferences.bundleVersion })
      .from(principalPolicyBundleReferences)
      .where(
        and(
          exact(row),
          eq(
            principalPolicyBundleReferences.bundleStateHash,
            row.bundleStateHash,
          ),
        ),
      )
      .limit(1);
    if (stored?.bundleVersion !== row.bundleVersion)
      throw new KeyingVerificationError(
        "equivocation",
        "principal policy reference index conflicts with the bundle head",
      );
  }
};

let template: PrincipalPolicyBundleResponse;
beforeAll(async () => {
  template = (await createSuccessorPrincipalPolicyBundle()).bundle;
});

interface StateFields {
  readonly principalId: string;
  readonly version: number;
  readonly stateHash: string;
  readonly keyEpoch: number;
  readonly keyFingerprint: string;
}

function bundleOf(
  states: readonly StateFields[],
): PrincipalPolicyBundleResponse {
  const previous = template.previousStates[0];
  const head = states.at(-1);
  if (!previous || !head) throw new Error("Missing bundle fixture");
  const toState = (fields: StateFields) => ({
    ...template.currentState,
    ...fields,
  });
  return {
    ...template,
    previousStates: states
      .slice(0, -1)
      .map((fields) => ({ ...previous, state: toState(fields) })),
    currentState: toState(head),
  };
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

async function referenceDatabase(key: string) {
  const sqlite = await createTestExecSql(key);
  await ensurePrincipalPolicyTables(sqlite.execSql);
  const runtime = getClientSQLitePersistenceRuntime(sqlite.execSql);
  return {
    ...sqlite,
    runtime,
    async run(
      index: IndexBundle,
      seed: readonly ReferenceRow[],
      bundle: PrincipalPolicyBundleResponse,
    ) {
      let failure: unknown = null;
      await runtime.transaction(
        async (tx: ClientSQLiteTransactionScope) => {
          await tx.delete(principalPolicyBundleReferences).run();
          for (const row of seed)
            await tx
              .insert(principalPolicyBundleReferences)
              .values(row)
              .onConflictDoNothing()
              .run();
          // Catch inside the transaction so rows written before a failure stay.
          try {
            await index(tx, bundle);
          } catch (error) {
            failure = error;
          }
        },
        { behavior: "immediate" },
      );
      const rows = await runtime.db
        .select()
        .from(principalPolicyBundleReferences)
        .orderBy(
          asc(principalPolicyBundleReferences.principalId),
          asc(principalPolicyBundleReferences.version),
          asc(principalPolicyBundleReferences.stateHash),
          asc(principalPolicyBundleReferences.keyEpoch),
          asc(principalPolicyBundleReferences.keyFingerprint),
          asc(principalPolicyBundleReferences.bundleStateHash),
        );
      const error =
        failure instanceof KeyingVerificationError
          ? { code: failure.code, message: failure.message }
          : failure;
      return { error, rows };
    },
  };
}

test("batched reference indexing matches the per-state loop on random stored references", async () => {
  const reference = await referenceDatabase("policy-reference-loop");
  const batched = await referenceDatabase("policy-reference-batch");
  try {
    const random = seededRandom(2544);
    const pick = <T>(values: readonly T[]): T => {
      const value = values[Math.floor(random() * values.length)];
      if (value === undefined) throw new Error("Empty choice");
      return value;
    };
    const fields = (): StateFields => ({
      principalId: random() < 0.1 ? "group-2" : "group-1",
      version: 1 + Math.floor(random() * 4),
      stateHash: pick(["state-a", "state-b"]),
      keyEpoch: pick([1, 2]),
      keyFingerprint: pick(["key-a", "key-b"]),
    });
    const outcomes = { failures: 0, successes: 0 };
    for (let iteration = 0; iteration < 400; iteration++) {
      const states = Array.from(
        { length: 1 + Math.floor(random() * 6) },
        fields,
      );
      const head = states.at(-1);
      if (head && random() < 0.8)
        states[states.length - 1] = {
          ...head,
          principalId: "group-1",
        };
      const seed = Array.from(
        { length: Math.floor(random() * 7) },
        (): ReferenceRow => ({
          principalType: "group",
          ...fields(),
          bundleVersion: 1 + Math.floor(random() * 4),
          bundleStateHash: pick(["state-a", "state-b", "state-c"]),
        }),
      );
      const bundle = bundleOf(states);
      const expected = await reference.run(indexOneStateAtATime, seed, bundle);
      const actual = await batched.run(
        indexPrincipalPolicyBundleInTransaction,
        seed,
        bundle,
      );
      expect(actual).toEqual(expected);
      outcomes[expected.error ? "failures" : "successes"] += 1;
    }
    // Both branches are exercised, not just one.
    expect(outcomes.failures).toBeGreaterThan(40);
    expect(outcomes.successes).toBeGreaterThan(40);
  } finally {
    reference.close();
    batched.close();
  }
});

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

test("indexing a 128-version bundle takes a constant number of statements", async () => {
  const sqlite = await createTestExecSql("policy-reference-budget");
  try {
    await ensurePrincipalPolicyTables(sqlite.execSql);
    const bundle = bundleOf(
      Array.from({ length: 128 }, (_, index) => ({
        principalId: "group-1",
        version: index + 1,
        stateHash: `state-${index + 1}`,
        keyEpoch: 1,
        keyFingerprint: "key-1",
      })),
    );
    const counted = countingExecSql(sqlite.execSql);
    const runtime = getClientSQLitePersistenceRuntime(counted.execSql);
    const index = async () => {
      counted.counter.statements = 0;
      await runtime.transaction(
        (tx) => indexPrincipalPolicyBundleInTransaction(tx, bundle),
        { behavior: "immediate" },
      );
      return counted.counter.statements;
    };
    // BEGIN, one lookup, two 124-row inserts, COMMIT (was 3V + 2 = 386).
    expect(await index()).toBe(5);
    // An unchanged head only reads: BEGIN, one lookup, COMMIT.
    expect(await index()).toBe(3);
    expect(
      await getClientSQLitePersistenceRuntime(sqlite.execSql)
        .db.select()
        .from(principalPolicyBundleReferences),
    ).toHaveLength(128);
  } finally {
    sqlite.close();
  }
});
