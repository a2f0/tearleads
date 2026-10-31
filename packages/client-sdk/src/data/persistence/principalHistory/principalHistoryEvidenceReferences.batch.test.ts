import { beforeAll, expect, test } from "bun:test";
import {
  createPrincipalPolicyHistoryVerifier,
  KeyingVerificationError,
  type PrincipalPolicyHistoryReferenceProof,
  resolvePrincipalHistoryIndexProof,
  type VerifiedPrincipalPolicyHistory,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { isPrincipalPolicyStateChainEntryResponse } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { signedRecoveryHistory } from "../../../../test/helpers/principalHistoryRecovery";
import {
  principalHistoryEntries,
  principalHistoryEvidenceTables,
  principalHistoryNodes,
} from "../../sqlite/schema/principalHistoryEvidenceSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import {
  createExecSql,
  type ExecSql,
  ensureSqlTables,
} from "../../sqlite/sqlSchema";
import {
  loadPrincipalHistoryReferences,
  preparePrincipalHistoryEvidencePage,
  writePrincipalHistoryEvidencePage,
} from "./principalHistoryEvidencePersistence";

let fixture: Awaited<ReturnType<typeof signedRecoveryHistory>>;
beforeAll(async () => {
  fixture = await signedRecoveryHistory();
});

/** The per-version loader the level-by-level read replaced, kept as reference behavior. */
async function loadOneReferenceAtATime(input: {
  readonly execSql: ExecSql;
  readonly scopeId: string;
  readonly history: VerifiedPrincipalPolicyHistory;
  readonly version: number;
}): Promise<PrincipalPolicyHistoryReferenceProof> {
  const { db } = getClientSQLitePersistenceRuntime(input.execSql);
  const resolved = await resolvePrincipalHistoryIndexProof({
    rootHash: input.history.indexRootHash,
    treeSize: input.history.currentEntry.state.version,
    version: input.version,
    readNode: async (hash) => {
      const [row] = await db
        .select()
        .from(principalHistoryNodes)
        .where(
          and(
            eq(principalHistoryNodes.scopeId, input.scopeId),
            eq(principalHistoryNodes.hash, hash),
          ),
        )
        .limit(1);
      return row?.leftHash && row.rightHash
        ? { hash: row.hash, leftHash: row.leftHash, rightHash: row.rightHash }
        : null;
    },
  });
  const [row] = await db
    .select()
    .from(principalHistoryEntries)
    .where(
      and(
        eq(principalHistoryEntries.scopeId, input.scopeId),
        eq(principalHistoryEntries.leafHash, resolved.leafHash),
      ),
    )
    .limit(1);
  let entry: unknown;
  try {
    entry = row ? JSON.parse(row.entryJson) : null;
  } catch {
    entry = null;
  }
  if (!isPrincipalPolicyStateChainEntryResponse(entry))
    throw new KeyingVerificationError(
      "missing_dependency",
      "Principal history entry is missing or corrupt",
    );
  const { state } = entry;
  return {
    reference: {
      principalType: state.principalType,
      principalId: state.principalId,
      version: state.version,
      keyEpoch: state.keyEpoch,
      stateHash: state.stateHash,
      keyFingerprint: state.keyFingerprint,
    },
    entry,
    proof: resolved.proof,
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

async function storedHistory() {
  const sqlite = await createTestExecSql("principal-history-references");
  const { bundle, expectedHead } = fixture;
  const identity = await fixture.resolveTrustedUserIdentity(
    bundle.currentState.signerUserId,
  );
  if (!identity) throw new Error("Missing signer fixture");
  const verifier = createPrincipalPolicyHistoryVerifier({
    principalType: "group",
    principalId: expectedHead.principalId,
  });
  const entries = [
    ...bundle.previousStates,
    {
      state: bundle.currentState,
      projection: bundle.currentProjection,
      grants: bundle.currentGrants,
    },
  ];
  const appended = await verifier.append({
    entries,
    signerPublicKeys: [
      {
        userId: bundle.currentState.signerUserId,
        signingKeyFingerprint: identity.signingKeyFingerprint,
        signingPublicKey: identity.signingPublicKey,
      },
    ],
  });
  if (!appended.ok) throw appended.error;
  const finished = verifier.finish(expectedHead);
  if (!finished.ok) throw finished.error;
  const page = await preparePrincipalHistoryEvidencePage({
    indexRootHash: finished.value.indexRootHash,
    scopeId: "scope-1",
    organizationId: "org-1",
    entries,
    nodes: appended.value.indexNodes,
  });
  await ensureSqlTables(sqlite.execSql, principalHistoryEvidenceTables);
  const runtime = getClientSQLitePersistenceRuntime(sqlite.execSql);
  await runtime.transaction((tx) =>
    writePrincipalHistoryEvidencePage(tx, page),
  );
  const counted = countingExecSql(sqlite.execSql);
  await ensureSqlTables(counted.execSql, principalHistoryEvidenceTables);
  const base = { scopeId: page.scopeId, history: finished.value };
  return {
    ...sqlite,
    runtime,
    page,
    async serial(versions: readonly number[]) {
      counted.counter.statements = 0;
      const proofs: PrincipalPolicyHistoryReferenceProof[] = [];
      for (const version of versions)
        proofs.push(
          await loadOneReferenceAtATime({
            ...base,
            execSql: counted.execSql,
            version,
          }),
        );
      return { proofs, statements: counted.counter.statements };
    },
    async batched(versions: readonly number[]) {
      counted.counter.statements = 0;
      const proofs = await loadPrincipalHistoryReferences({
        ...base,
        execSql: counted.execSql,
        versions,
      });
      return { proofs, statements: counted.counter.statements };
    },
  };
}

function settle<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

const pageVersions = Array.from({ length: 33 }, (_, index) => 33 + index);

test("a page of history references reads one node set per level and one entry set", async () => {
  const stored = await storedHistory();
  try {
    // A display page: 33 references plus the durable checkpoint's version.
    const versions = [...pageVersions, 40];
    const serial = await stored.serial(versions);
    const batched = await stored.batched(versions);
    expect(batched.proofs).toEqual(serial.proofs);
    expect(serial.statements).toBe(267);
    // Seven node levels over 66 leaves, then one entries read (was 267).
    expect(batched.statements).toBe(8);
    // A typical recovery's three references (was 19).
    const recovery = [1, 33, 66];
    const serialRecovery = await stored.serial(recovery);
    const batchedRecovery = await stored.batched(recovery);
    expect(batchedRecovery.proofs).toEqual(serialRecovery.proofs);
    expect(serialRecovery.statements).toBe(19);
    expect(batchedRecovery.statements).toBe(8);
    // A single version costs what it always did: one node per level and its entry.
    expect((await stored.batched([16])).statements).toBe(
      (await stored.serial([16])).statements,
    );
  } finally {
    stored.close();
  }
});

test("the first failing version fails first, with the error loading it alone throws", async () => {
  const stored = await storedHistory();
  try {
    // Version 50's lowest index node is shared only with version 49.
    const path: string[] = [];
    await resolvePrincipalHistoryIndexProof({
      rootHash: stored.page.indexRootHash,
      treeSize: 66,
      version: 50,
      readNode: async (hash) => {
        path.push(hash);
        return stored.page.nodes.find((node) => node.hash === hash) ?? null;
      },
    });
    const lowest = path.at(-1);
    const corrupt = stored.page.entries[39];
    if (!lowest || !corrupt) throw new Error("Missing fixture rows");
    await stored.runtime.db
      .delete(principalHistoryNodes)
      .where(eq(principalHistoryNodes.hash, lowest))
      .run();
    await stored.runtime.db
      .update(principalHistoryEntries)
      .set({ entryJson: "{" })
      .where(eq(principalHistoryEntries.leafHash, corrupt.leafHash))
      .run();
    for (const versions of [
      [36, 40, 50],
      [36, 50, 40],
      [49, 40],
      [66, 50],
      [16, 66],
    ]) {
      const serial = await settle(stored.serial(versions));
      const batched = await settle(stored.batched(versions));
      expect(batched.ok).toBe(serial.ok);
      if (!batched.ok && !serial.ok) {
        expect(batched.error).toBeInstanceOf(KeyingVerificationError);
        expect(batched.error).toMatchObject({
          code: Reflect.get(Object(serial.error), "code"),
          message: Reflect.get(Object(serial.error), "message"),
        });
      } else if (batched.ok && serial.ok) {
        expect(batched.value.proofs).toEqual(serial.value.proofs);
      }
    }
    await expect(stored.batched([36, 40, 50])).rejects.toThrow(
      "Principal history entry is missing or corrupt",
    );
    await expect(stored.batched([36, 50, 40])).rejects.toThrow(
      "principal history index node is missing",
    );
  } finally {
    stored.close();
  }
});
