import { beforeAll, expect, test } from "bun:test";
import {
  createPrincipalPolicyHistoryVerifier,
  verifyPrincipalPolicyHistoryReferences,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { signedRecoveryHistory } from "../../../test/helpers/principalHistoryRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import {
  principalHistoryEntries,
  principalHistoryEvidenceTables,
  principalHistoryNodes,
} from "../sqlite/principalHistoryEvidenceSchema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { createExecSql, ensureSqlTables } from "../sqlite/sqlSchema";
import {
  loadPrincipalHistoryReference,
  preparePrincipalHistoryEvidencePage,
  writePrincipalHistoryEvidencePage,
} from "./principalHistoryEvidencePersistence";

let fixture: Awaited<ReturnType<typeof signedRecoveryHistory>>;
beforeAll(async () => {
  fixture = await signedRecoveryHistory();
});

async function evidenceFixture() {
  const sqlite = await createTestExecSql("principal-history-evidence");
  try {
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
    const cited = entries[15]?.state;
    if (!cited) throw new Error("Missing citation");
    const reference = principalPolicyHead({ ...bundle, currentState: cited });
    const input = {
      execSql: sqlite.execSql,
      scopeId: page.scopeId,
      history: finished.value,
      version: reference.version,
      expectedReference: reference,
    };
    const select = async () =>
      verifyPrincipalPolicyHistoryReferences({
        history: finished.value,
        references: [await loadPrincipalHistoryReference(input)],
      });
    return { ...sqlite, runtime, page, input, select };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

test("persisted index material selects an exact signed historical entry", async () => {
  const stored = await evidenceFixture();
  try {
    const selected = await stored.select();
    if (!selected.ok) throw selected.error;
    expect(
      selected.value.retainedEntries.map(({ state }) => state.version),
    ).toEqual([16, 66]);
    await expect(
      loadPrincipalHistoryReference({
        ...stored.input,
        scopeId: "another-scope",
      }),
    ).rejects.toMatchObject({ code: "missing_dependency" });
  } finally {
    stored.close();
  }
});

test("tampered stored signatures fail proof verification and accepted pages repair the cache", async () => {
  const stored = await evidenceFixture();
  try {
    const target = stored.page.entries[15];
    if (!target) throw new Error("Missing stored entry");
    const corrupt = JSON.parse(target.entryJson);
    corrupt.state.signature = fixture.bundle.currentState.signature;
    await stored.runtime.db
      .update(principalHistoryEntries)
      .set({ entryJson: JSON.stringify(corrupt) })
      .where(eq(principalHistoryEntries.leafHash, target.leafHash))
      .run();
    const selected = await stored.select();
    expect(selected.ok).toBe(false);
    if (!selected.ok) expect(selected.error.code).toBe("hash_mismatch");
    await stored.runtime.transaction((tx) =>
      writePrincipalHistoryEvidencePage(tx, stored.page),
    );
    expect((await stored.select()).ok).toBe(true);
  } finally {
    stored.close();
  }
});

test("missing proof nodes cannot establish a citation", async () => {
  const stored = await evidenceFixture();
  try {
    await stored.runtime.db.delete(principalHistoryNodes).run();
    await expect(stored.select()).rejects.toMatchObject({
      code: "missing_dependency",
    });
  } finally {
    stored.close();
  }
});

test("historical selection reads only a logarithmic path and one entry", async () => {
  const stored = await evidenceFixture();
  try {
    let reads = 0;
    const execSql = createExecSql({
      async exec({ sql, bind, rowMode }) {
        const statement = sql.toLowerCase();
        if (
          statement.startsWith("select ") &&
          (statement.includes('from "principal_history_nodes"') ||
            statement.includes('from "principal_history_entries"'))
        )
          reads++;
        const rows =
          rowMode === "array"
            ? await stored.execSql(sql, bind, { rowMode: "array" })
            : await stored.execSql(sql, bind);
        return { rows };
      },
    });
    const proof = await loadPrincipalHistoryReference({
      ...stored.input,
      execSql,
    });
    const selected = await verifyPrincipalPolicyHistoryReferences({
      history: stored.input.history,
      references: [proof],
    });
    expect(selected.ok).toBe(true);
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThanOrEqual(Math.ceil(Math.log2(66)) + 1);
  } finally {
    stored.close();
  }
});

test("a discarded transaction cannot publish accepted evidence", async () => {
  const stored = await evidenceFixture();
  try {
    let current = true;
    const result = await stored.runtime.guardedTransaction(
      async (tx) => {
        await writePrincipalHistoryEvidencePage(tx, {
          ...stored.page,
          scopeId: "discarded-scope",
        });
        current = false;
      },
      () => current,
      { behavior: "immediate" },
    );
    expect(result.committed).toBe(false);
    await expect(
      loadPrincipalHistoryReference({
        ...stored.input,
        scopeId: "discarded-scope",
      }),
    ).rejects.toMatchObject({ code: "missing_dependency" });
    expect((await stored.select()).ok).toBe(true);
  } finally {
    stored.close();
  }
});
