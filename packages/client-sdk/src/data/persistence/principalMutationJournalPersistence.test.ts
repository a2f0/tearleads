import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  claimPrincipalMutationJournal,
  clearPrincipalMutationJournal,
  loadPrincipalMutationJournal,
  PendingPrincipalMutationError,
  type PrincipalMutationJournalRow,
} from "./principalMutationJournalPersistence";

function row(request: string): PrincipalMutationJournalRow {
  return {
    scopeId: "scope",
    organizationId: "organization",
    serializedRequest: request,
    signature: `signed-${request}`,
  };
}

test("concurrent authors leave one exact request and cannot replace it", async () => {
  const sqlite = await createTestExecSql("principal-journal-concurrent");
  const shared = { execSql: sqlite.execSql, stillCurrent: () => true };
  try {
    const candidates = [row("first"), row("second")];
    const results = await Promise.allSettled(
      candidates.map((candidate) =>
        claimPrincipalMutationJournal({ ...shared, row: candidate }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const loser = results.find((result) => result.status === "rejected");
    expect(loser?.status === "rejected" && loser.reason).toBeInstanceOf(
      PendingPrincipalMutationError,
    );
    const winner =
      candidates[results.findIndex((result) => result.status === "fulfilled")];
    if (!winner) throw new Error("Expected one journal winner");
    expect(await loadPrincipalMutationJournal(sqlite.execSql, "scope")).toEqual(
      winner,
    );
    await expect(
      claimPrincipalMutationJournal({ ...shared, row: row("third") }),
    ).rejects.toBeInstanceOf(PendingPrincipalMutationError);
    expect(await loadPrincipalMutationJournal(sqlite.execSql, "scope")).toEqual(
      winner,
    );
  } finally {
    sqlite.close();
  }
});

test("a stale acknowledgement cannot clear a newer operation", async () => {
  const sqlite = await createTestExecSql("principal-journal-clear");
  const shared = { execSql: sqlite.execSql, stillCurrent: () => true };
  try {
    const previous = row("first");
    const current = row("second");
    await claimPrincipalMutationJournal({ ...shared, row: previous });
    await clearPrincipalMutationJournal({ ...shared, row: previous });
    await claimPrincipalMutationJournal({ ...shared, row: current });
    await clearPrincipalMutationJournal({ ...shared, row: previous });
    expect(await loadPrincipalMutationJournal(sqlite.execSql, "scope")).toEqual(
      current,
    );
    await clearPrincipalMutationJournal({ ...shared, row: current });
    expect(
      await loadPrincipalMutationJournal(sqlite.execSql, "scope"),
    ).toBeNull();
  } finally {
    sqlite.close();
  }
});

test.each(["claim", "clear"] as const)(
  "an expired database or session lifetime cannot %s authored work",
  async (operation) => {
    const sqlite = await createTestExecSql("principal-journal-lifetime");
    const candidate = row("first");
    try {
      if (operation === "clear")
        await claimPrincipalMutationJournal({
          execSql: sqlite.execSql,
          row: candidate,
          stillCurrent: () => true,
        });
      const mutate =
        operation === "claim"
          ? claimPrincipalMutationJournal
          : clearPrincipalMutationJournal;
      await expect(
        mutate({
          execSql: sqlite.execSql,
          row: candidate,
          stillCurrent: () => false,
        }),
      ).rejects.toThrow();
      expect(
        await loadPrincipalMutationJournal(sqlite.execSql, "scope"),
      ).toEqual(operation === "claim" ? null : candidate);
    } finally {
      sqlite.close();
    }
  },
);
