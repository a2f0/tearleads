import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { isProjectionVerificationCancelledError } from "../keyingProjectionVerification/types";
import { principalHistoryRootOwners } from "../sqlite/principalHistoryNodeRetentionSchema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import {
  discardPrincipalHistoryPrefix,
  loadPrincipalHistoryPrefix,
  type PrincipalHistoryPrefix,
  savePrincipalHistoryPrefix,
} from "./principalHistoryPrefixPersistence";

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

test("obsolete prefix schemas require the repository's explicit database reset", async () => {
  const sqlite = await createTestExecSql("obsolete-principal-prefix");
  try {
    await sqlite.execSql(`CREATE TABLE principal_history_prefixes (
      scope_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
      version INTEGER NOT NULL, head_json TEXT NOT NULL, progress TEXT NOT NULL
    )`);
    await expect(
      loadPrincipalHistoryPrefix(sqlite.execSql, "test-scope"),
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
  const input = {
    indexRootHash: "opaque-index-root",
    execSql: sqlite.execSql,
    stillCurrent: () => true,
  };
  try {
    const previous = prefix(32);
    const latest = prefix(66);
    await savePrincipalHistoryPrefix({ ...input, prefix: previous });
    await savePrincipalHistoryPrefix({
      ...input,
      prefix: latest,
      indexRootHash: "newer-index-root",
    });
    const { db } = getClientSQLitePersistenceRuntime(sqlite.execSql);
    const owners = await db.select().from(principalHistoryRootOwners);
    expect(owners).toMatchObject([{ rootHash: "newer-index-root" }]);
    await savePrincipalHistoryPrefix({ ...input, prefix: previous });
    expect(
      await loadPrincipalHistoryPrefix(sqlite.execSql, latest.scopeId),
    ).toEqual(latest);
    await discardPrincipalHistoryPrefix({ ...input, prefix: previous });
    expect(await db.select().from(principalHistoryRootOwners)).toEqual(owners);
    expect(
      await loadPrincipalHistoryPrefix(sqlite.execSql, latest.scopeId),
    ).toEqual(latest);
    await discardPrincipalHistoryPrefix({ ...input, prefix: latest });
    expect(await db.select().from(principalHistoryRootOwners)).toEqual([]);
    expect(
      await loadPrincipalHistoryPrefix(sqlite.execSql, latest.scopeId),
    ).toBeNull();
  } finally {
    sqlite.close();
  }
});

test("a rebuilt root at the same version can repair a completed prefix", async () => {
  const sqlite = await createTestExecSql("principal-prefix-repair");
  const input = {
    indexRootHash: "opaque-index-root",
    execSql: sqlite.execSql,
    stillCurrent: () => true,
  };
  try {
    const previous = prefix(66);
    const repaired = { ...previous, progress: "repaired-authenticated-prefix" };
    await savePrincipalHistoryPrefix({ ...input, prefix: previous });
    await savePrincipalHistoryPrefix({ ...input, prefix: repaired });
    await discardPrincipalHistoryPrefix({ ...input, prefix: previous });
    expect(
      await loadPrincipalHistoryPrefix(sqlite.execSql, previous.scopeId),
    ).toEqual(repaired);
  } finally {
    sqlite.close();
  }
});

test.each([false, true])(
  "a lower replay replaces only its rejected prefix: superseded=%s",
  async (superseded) => {
    const sqlite = await createTestExecSql("principal-prefix-lower-repair");
    const input = {
      indexRootHash: "opaque-index-root",
      execSql: sqlite.execSql,
      stillCurrent: () => true,
    };
    try {
      const rejected = prefix(66);
      const replacement = prefix(32);
      const concurrent = {
        ...rejected,
        progress: "concurrent-verified-prefix",
      };
      await savePrincipalHistoryPrefix({ ...input, prefix: rejected });
      if (superseded)
        await savePrincipalHistoryPrefix({ ...input, prefix: concurrent });
      await savePrincipalHistoryPrefix({
        ...input,
        prefix: replacement,
        rejectedPrefix: rejected,
      });
      expect(
        await loadPrincipalHistoryPrefix(sqlite.execSql, rejected.scopeId),
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
    const input = {
      indexRootHash: "opaque-index-root",
      execSql: sqlite.execSql,
      stillCurrent: () => false,
    };
    try {
      await savePrincipalHistoryPrefix({
        ...input,
        prefix: previous,
        stillCurrent: () => true,
      });
      const pending =
        operation === "save"
          ? savePrincipalHistoryPrefix({ ...input, prefix: prefix(66) })
          : discardPrincipalHistoryPrefix({ ...input, prefix: previous });
      expect(await pending.catch(isProjectionVerificationCancelledError)).toBe(
        true,
      );
      expect(
        await loadPrincipalHistoryPrefix(sqlite.execSql, previous.scopeId),
      ).toEqual(previous);
    } finally {
      sqlite.close();
    }
  },
);
