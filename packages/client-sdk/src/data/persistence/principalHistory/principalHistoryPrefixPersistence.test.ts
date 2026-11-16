import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { signedRecoveryHistory } from "../../../../test/helpers/principalHistoryRecovery";
import { isProjectionVerificationCancelledError } from "../../keyingProjectionVerification/types";
import { principalHistoryPrefixes } from "../../sqlite/schema/principalHistoryEvidenceSchema";
import { principalKeyEnvelopeArchive } from "../../sqlite/schema/principalHistoryRetentionSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { createExecSql } from "../../sqlite/sqlSchema";
import type { PrincipalHistoryPrefix } from "./principalHistoryPrefixPersistence";
import { PrincipalHistoryRepository } from "./principalHistoryRepository";

function prefix(version: number): PrincipalHistoryPrefix {
  return {
    scopeId: "test-scope",
    organizationId: "org-1",
    version,
    headJson: JSON.stringify({ version }),
    currentJson: "{}",
    progress: `authenticated-prefix-${version}`,
  };
}

test("discarding a missing prefix initializes its tables on a fresh database", async () => {
  const sqlite = await createTestExecSql("principal-prefix-cold-discard");
  try {
    const repository = new PrincipalHistoryRepository(sqlite.execSql);
    await repository.discardPrincipalHistoryPrefix({
      prefix: prefix(1),
      stillCurrent: () => true,
    });
    const { db } = getClientSQLitePersistenceRuntime(sqlite.execSql);
    expect(await db.select().from(principalHistoryPrefixes)).toEqual([]);
    expect(
      await repository.loadPrincipalHistoryPrefix("test-scope"),
    ).toBeNull();
  } finally {
    sqlite.close();
  }
});

test("obsolete prefix schemas require the repository's explicit database reset", async () => {
  const sqlite = await createTestExecSql("obsolete-principal-prefix");
  try {
    await sqlite.execSql(`CREATE TABLE principal_history_prefixes (
      scope_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
      version INTEGER NOT NULL, head_json TEXT NOT NULL, progress TEXT NOT NULL
    )`);
    await expect(
      new PrincipalHistoryRepository(sqlite.execSql).loadPrincipalHistoryPrefix(
        "test-scope",
      ),
    ).rejects.toThrow(
      "Local database schema for principal_history_prefixes is obsolete; reset the local database before continuing",
    );
    const columns = await sqlite.execSql(
      "PRAGMA table_info(principal_history_prefixes)",
    );
    expect(
      columns.some((column) => Reflect.get(column, "name") === "current_json"),
    ).toBe(false);
  } finally {
    sqlite.close();
  }
});

test("older completion and stale discard preserve the newest completed prefix", async () => {
  const sqlite = await createTestExecSql("principal-prefix-concurrency");
  const repository = new PrincipalHistoryRepository(sqlite.execSql);
  const input = {
    indexRootHash: "opaque-index-root",
    stillCurrent: () => true,
  };
  try {
    const previous = prefix(32);
    const latest = prefix(66);
    await repository.savePrincipalHistoryPrefix({ ...input, prefix: previous });
    await repository.savePrincipalHistoryPrefix({
      ...input,
      prefix: latest,
      indexRootHash: "newer-index-root",
    });
    const { db } = getClientSQLitePersistenceRuntime(sqlite.execSql);
    const roots = () =>
      db
        .select({ rootHash: principalHistoryPrefixes.rootHash })
        .from(principalHistoryPrefixes);
    const owners = await roots();
    expect(owners).toEqual([{ rootHash: "newer-index-root" }]);
    await repository.savePrincipalHistoryPrefix({ ...input, prefix: previous });
    expect(await repository.loadPrincipalHistoryPrefix(latest.scopeId)).toEqual(
      latest,
    );
    await repository.discardPrincipalHistoryPrefix({
      ...input,
      prefix: previous,
    });
    expect(await roots()).toEqual(owners);
    expect(await repository.loadPrincipalHistoryPrefix(latest.scopeId)).toEqual(
      latest,
    );
    await repository.discardPrincipalHistoryPrefix({
      ...input,
      prefix: latest,
    });
    expect(await roots()).toEqual([]);
    expect(
      await repository.loadPrincipalHistoryPrefix(latest.scopeId),
    ).toBeNull();
  } finally {
    sqlite.close();
  }
});

test("a rebuilt root at the same version can repair its rejected completed prefix", async () => {
  const sqlite = await createTestExecSql("principal-prefix-repair");
  const repository = new PrincipalHistoryRepository(sqlite.execSql);
  const input = {
    indexRootHash: "opaque-index-root",
    stillCurrent: () => true,
  };
  try {
    const previous = prefix(66);
    const repaired = { ...previous, progress: "repaired-authenticated-prefix" };
    await repository.savePrincipalHistoryPrefix({ ...input, prefix: previous });
    await repository.savePrincipalHistoryPrefix({
      ...input,
      prefix: repaired,
      rejectedPrefix: previous,
    });
    await repository.discardPrincipalHistoryPrefix({
      ...input,
      prefix: previous,
    });
    expect(
      await repository.loadPrincipalHistoryPrefix(previous.scopeId),
    ).toEqual(repaired);
  } finally {
    sqlite.close();
  }
});

test("identical completion preserves progress while repairing root ownership", async () => {
  const sqlite = await createTestExecSql("principal-prefix-identical");
  const repository = new PrincipalHistoryRepository(sqlite.execSql);
  const input = {
    indexRootHash: "verified-index-root",
    stillCurrent: () => true,
  };
  try {
    const previous = prefix(66);
    await repository.savePrincipalHistoryPrefix({ ...input, prefix: previous });
    const { db } = getClientSQLitePersistenceRuntime(sqlite.execSql);
    await db
      .update(principalHistoryPrefixes)
      .set({ rootHash: "corrupt-root-hint" })
      .run();
    await repository.savePrincipalHistoryPrefix({
      ...input,
      prefix: { ...previous, progress: "resealed-identical-prefix" },
    });
    expect(
      await repository.loadPrincipalHistoryPrefix(previous.scopeId),
    ).toEqual(previous);
    expect(
      await db
        .select({ rootHash: principalHistoryPrefixes.rootHash })
        .from(principalHistoryPrefixes),
    ).toEqual([{ rootHash: input.indexRootHash }]);
  } finally {
    sqlite.close();
  }
});

test.each([false, true])(
  "a lower replay replaces only its rejected prefix: superseded=%s",
  async (superseded) => {
    const sqlite = await createTestExecSql("principal-prefix-lower-repair");
    const repository = new PrincipalHistoryRepository(sqlite.execSql);
    const input = {
      indexRootHash: "opaque-index-root",
      stillCurrent: () => true,
    };
    try {
      const rejected = prefix(66);
      const replacement = prefix(32);
      const concurrent = {
        ...rejected,
        progress: "concurrent-verified-prefix",
      };
      await repository.savePrincipalHistoryPrefix({
        ...input,
        prefix: rejected,
      });
      if (superseded)
        await repository.savePrincipalHistoryPrefix({
          ...input,
          prefix: concurrent,
          rejectedPrefix: rejected,
        });
      await repository.savePrincipalHistoryPrefix({
        ...input,
        prefix: replacement,
        rejectedPrefix: rejected,
      });
      expect(
        await repository.loadPrincipalHistoryPrefix(rejected.scopeId),
      ).toEqual(superseded ? concurrent : replacement);
    } finally {
      sqlite.close();
    }
  },
);

test.each(["save", "discard"] as const)(
  "a retired lifetime cannot %s a completed prefix",
  async (operation) => {
    const sqlite = await createTestExecSql("principal-prefix-lifetime");
    const previous = prefix(32);
    const repository = new PrincipalHistoryRepository(sqlite.execSql);
    const input = {
      indexRootHash: "opaque-index-root",
      stillCurrent: () => false,
    };
    try {
      await repository.savePrincipalHistoryPrefix({
        ...input,
        prefix: previous,
        stillCurrent: () => true,
      });
      const pending =
        operation === "save"
          ? repository.savePrincipalHistoryPrefix({
              ...input,
              prefix: prefix(66),
            })
          : repository.discardPrincipalHistoryPrefix({
              ...input,
              prefix: previous,
            });
      expect(await pending.catch(isProjectionVerificationCancelledError)).toBe(
        true,
      );
      expect(
        await repository.loadPrincipalHistoryPrefix(previous.scopeId),
      ).toEqual(previous);
    } finally {
      sqlite.close();
    }
  },
);

test("an identical completion archives its key envelopes once", async () => {
  const sqlite = await createTestExecSql("principal-prefix-archive-once");
  const archives: string[] = [];
  const execSql = createExecSql({
    async exec({ sql, bind, rowMode }) {
      if (sql.startsWith('insert into "principal_key_envelope_archive"'))
        archives.push(sql);
      return {
        rows: await sqlite.execSql(
          sql,
          bind,
          rowMode ? { rowMode } : undefined,
        ),
      };
    },
  });
  try {
    const { bundle } = await signedRecoveryHistory(2);
    const completed = {
      ...prefix(bundle.currentState.version),
      currentJson: JSON.stringify(bundle),
    };
    const repository = new PrincipalHistoryRepository(execSql);
    const input = {
      indexRootHash: "verified-index-root",
      stillCurrent: () => true,
    };
    await repository.savePrincipalHistoryPrefix({
      ...input,
      prefix: completed,
    });
    expect(archives).toHaveLength(1);
    archives.length = 0;
    await repository.savePrincipalHistoryPrefix({
      ...input,
      prefix: completed,
    });
    // The previous prefix's archive repeated this one's (was 2).
    expect(archives).toHaveLength(1);
    const { db } = getClientSQLitePersistenceRuntime(sqlite.execSql);
    expect(await db.select().from(principalKeyEnvelopeArchive)).toMatchObject([
      { version: bundle.currentState.version },
    ]);
  } finally {
    sqlite.close();
  }
});
