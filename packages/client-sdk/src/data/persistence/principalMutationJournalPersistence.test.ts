import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  PendingPrincipalMutationError,
  PrincipalMutationJournalRepository,
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
  const shared = { stillCurrent: () => true };
  try {
    const candidates = [row("first"), row("second")];
    const results = await Promise.allSettled(
      candidates.map((candidate) =>
        new PrincipalMutationJournalRepository(
          sqlite.execSql,
        ).claimPrincipalMutationJournal({ ...shared, row: candidate }),
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
    expect(
      await new PrincipalMutationJournalRepository(
        sqlite.execSql,
      ).loadPrincipalMutationJournal("scope"),
    ).toEqual(winner);
    await expect(
      new PrincipalMutationJournalRepository(
        sqlite.execSql,
      ).claimPrincipalMutationJournal({ ...shared, row: row("third") }),
    ).rejects.toBeInstanceOf(PendingPrincipalMutationError);
    expect(
      await new PrincipalMutationJournalRepository(
        sqlite.execSql,
      ).loadPrincipalMutationJournal("scope"),
    ).toEqual(winner);
  } finally {
    sqlite.close();
  }
});

test("a stale acknowledgement cannot clear a newer operation", async () => {
  const sqlite = await createTestExecSql("principal-journal-clear");
  const shared = { stillCurrent: () => true };
  try {
    const previous = row("first");
    const current = row("second");
    await new PrincipalMutationJournalRepository(
      sqlite.execSql,
    ).claimPrincipalMutationJournal({ ...shared, row: previous });
    await new PrincipalMutationJournalRepository(
      sqlite.execSql,
    ).clearPrincipalMutationJournal({ ...shared, row: previous });
    await new PrincipalMutationJournalRepository(
      sqlite.execSql,
    ).claimPrincipalMutationJournal({ ...shared, row: current });
    expect(
      await new PrincipalMutationJournalRepository(
        sqlite.execSql,
      ).clearPrincipalMutationJournal({ ...shared, row: previous }),
    ).toBe(false);
    expect(
      await new PrincipalMutationJournalRepository(
        sqlite.execSql,
      ).loadPrincipalMutationJournal("scope"),
    ).toEqual(current);
    expect(
      await new PrincipalMutationJournalRepository(
        sqlite.execSql,
      ).clearPrincipalMutationJournal({ ...shared, row: current }),
    ).toBe(true);
    expect(
      await new PrincipalMutationJournalRepository(
        sqlite.execSql,
      ).loadPrincipalMutationJournal("scope"),
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
        await new PrincipalMutationJournalRepository(
          sqlite.execSql,
        ).claimPrincipalMutationJournal({
          row: candidate,
          stillCurrent: () => true,
        });
      const journal = new PrincipalMutationJournalRepository(sqlite.execSql);
      const input = { row: candidate, stillCurrent: () => false };
      await expect(
        operation === "claim"
          ? journal.claimPrincipalMutationJournal(input)
          : journal.clearPrincipalMutationJournal(input),
      ).rejects.toThrow();
      expect(
        await new PrincipalMutationJournalRepository(
          sqlite.execSql,
        ).loadPrincipalMutationJournal("scope"),
      ).toEqual(operation === "claim" ? null : candidate);
    } finally {
      sqlite.close();
    }
  },
);
