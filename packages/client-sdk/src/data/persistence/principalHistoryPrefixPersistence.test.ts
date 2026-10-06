import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { isProjectionVerificationCancelledError } from "../keyingProjectionVerification/types";
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

test("older completion and stale discard preserve the newest completed prefix", async () => {
  const sqlite = await createTestExecSql("principal-prefix-concurrency");
  const input = { execSql: sqlite.execSql, stillCurrent: () => true };
  try {
    const previous = prefix(32);
    const latest = prefix(66);
    await savePrincipalHistoryPrefix({ ...input, prefix: previous });
    await savePrincipalHistoryPrefix({ ...input, prefix: latest });
    await savePrincipalHistoryPrefix({ ...input, prefix: previous });
    expect(
      await loadPrincipalHistoryPrefix(sqlite.execSql, latest.scopeId),
    ).toEqual(latest);
    await discardPrincipalHistoryPrefix({ ...input, prefix: previous });
    expect(
      await loadPrincipalHistoryPrefix(sqlite.execSql, latest.scopeId),
    ).toEqual(latest);
    await discardPrincipalHistoryPrefix({ ...input, prefix: latest });
    expect(
      await loadPrincipalHistoryPrefix(sqlite.execSql, latest.scopeId),
    ).toBeNull();
  } finally {
    sqlite.close();
  }
});

test("a rebuilt root at the same version can repair a completed prefix", async () => {
  const sqlite = await createTestExecSql("principal-prefix-repair");
  const input = { execSql: sqlite.execSql, stillCurrent: () => true };
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

test.each(["save", "discard"] as const)(
  "a retired lifetime cannot %s a completed prefix",
  async (operation) => {
    const sqlite = await createTestExecSql("principal-prefix-lifetime");
    const previous = prefix(32);
    const input = { execSql: sqlite.execSql, stillCurrent: () => false };
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
