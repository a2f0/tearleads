import { expect, test } from "bun:test";
import type { RequestFailure } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import { principalMutationJournalFixture } from "../../../test/helpers/principalMutationJournalFixture";
import {
  claimPrincipalMutationJournal,
  loadPrincipalMutationJournal,
} from "../../data/persistence/principalMutationJournalPersistence";
import {
  principalMutationJournalScopeId,
  sealPrincipalMutation,
} from "../../data/principals/principalMutationJournal";
import {
  type PrincipalMutationJournalContext,
  PrincipalMutationOutcomeUnknownError,
  recoverJournaledPrincipalMutation,
  submitJournaledPrincipalMutation,
} from "./principalMutationJournalSession";

function refusal(
  kind: RequestFailure["kind"],
  status: number | null,
): RequestFailure {
  return {
    ok: false,
    kind,
    status,
    statusText: "fixture",
    message: "fixture",
    method: "POST",
    path: "/fixture",
    report() {},
  };
}

test.each([
  { status: 400, code: undefined, retires: true },
  { status: 401, code: undefined, retires: true },
  { status: 402, code: undefined, retires: true },
  { status: 403, code: undefined, retires: true },
  { status: 404, code: undefined, retires: false },
  { status: 409, code: undefined, retires: true },
  { status: 413, code: undefined, retires: false },
  { status: 422, code: undefined, retires: false },
  { status: 429, code: undefined, retires: false },
  { status: 503, code: undefined, retires: false },
  {
    status: 503,
    code: "principal_history_preparation_unavailable",
    retires: true,
  },
])(
  "initial refusal preserves the documented outcome boundary: %j",
  async ({ status, code, retires }) => {
    const fixture = await principalMutationJournalFixture();
    const sqlite = await createTestExecSql("journal-initial-refusal");
    const scopeId = await principalMutationJournalScopeId(fixture.scope);
    const response: RequestFailure = {
      ...refusal("http", status),
      ...(code ? { code } : {}),
    };
    try {
      const pending = submitJournaledPrincipalMutation({
        ...fixture,
        execSql: sqlite.execSql,
        stillCurrent: () => true,
        submit: async () => response,
      });
      if (retires) expect(await pending).toEqual(response);
      else
        await expect(pending).rejects.toBeInstanceOf(
          PrincipalMutationOutcomeUnknownError,
        );
      const row = await loadPrincipalMutationJournal(sqlite.execSql, scopeId);
      if (retires) expect(row).toBeNull();
      else expect(row).not.toBeNull();
    } finally {
      sqlite.close();
    }
  },
);

test("a lost acknowledgement retains the exact body for a fresh recovery context", async () => {
  const fixture = await principalMutationJournalFixture();
  const sqlite = await createTestExecSql("journal-restart");
  const scopeId = await principalMutationJournalScopeId(fixture.scope);
  const authored = structuredClone(fixture.mutation);
  let submissions = 0;
  const context: PrincipalMutationJournalContext = {
    ...fixture,
    execSql: sqlite.execSql,
    stillCurrent: () => true,
    submit: async (mutation) => {
      submissions += 1;
      // Persistence precedes network dispatch; transport owns a distinct copy.
      expect(
        await loadPrincipalMutationJournal(sqlite.execSql, scopeId),
      ).not.toBeNull();
      expect(mutation).toEqual(authored);
      mutation.request.groupPolicy.encryptedPayload.ciphertext =
        "transport changed";
      return refusal("outcome-unknown", null);
    },
  };
  try {
    await expect(
      submitJournaledPrincipalMutation({
        ...context,
        mutation: fixture.mutation,
      }),
    ).rejects.toBeInstanceOf(PrincipalMutationOutcomeUnknownError);
    expect(submissions).toBe(1);
    expect(
      await loadPrincipalMutationJournal(sqlite.execSql, scopeId),
    ).not.toBeNull();
    const recovered = await recoverJournaledPrincipalMutation({
      ...context,
      scope: { ...context.scope },
      signingKeyPair: structuredClone(context.signingKeyPair),
      submit: async (mutation) => {
        submissions += 1;
        expect(mutation).toEqual(authored);
        return { ok: true, data: fixture.response };
      },
    });
    expect(recovered?.mutation).toEqual(authored);
    expect(submissions).toBe(2);
    expect(
      await loadPrincipalMutationJournal(sqlite.execSql, scopeId),
    ).toBeNull();
  } finally {
    sqlite.close();
  }
});

test.each([403, 409, 503])(
  "a later HTTP %s cannot erase an earlier uncertain commit",
  async (status) => {
    const fixture = await principalMutationJournalFixture();
    const sqlite = await createTestExecSql("journal-refused-recovery");
    const row = await sealPrincipalMutation(fixture);
    try {
      await claimPrincipalMutationJournal({
        execSql: sqlite.execSql,
        row,
        stillCurrent: () => true,
      });
      await expect(
        recoverJournaledPrincipalMutation({
          ...fixture,
          execSql: sqlite.execSql,
          stillCurrent: () => true,
          submit: async () => ({
            ...refusal("http", status),
            ...(status === 503
              ? { code: "principal_history_preparation_unavailable" }
              : {}),
          }),
        }),
      ).rejects.toBeInstanceOf(PrincipalMutationOutcomeUnknownError);
      expect(
        await loadPrincipalMutationJournal(sqlite.execSql, row.scopeId),
      ).toEqual(row);
    } finally {
      sqlite.close();
    }
  },
);

test.each(["unknown", "refused", "malformed", "expired"] as const)(
  "a newly submitted %s result retires only a known refusal",
  async (outcome) => {
    const fixture = await principalMutationJournalFixture();
    const sqlite = await createTestExecSql("journal-submission-outcome");
    const scopeId = await principalMutationJournalScopeId(fixture.scope);
    let current = true;
    try {
      const pending = submitJournaledPrincipalMutation({
        ...fixture,
        execSql: sqlite.execSql,
        stillCurrent: () => current,
        submit: async () => {
          if (outcome === "unknown") return refusal("http", 500);
          if (outcome === "refused") return refusal("http", 409);
          const response = structuredClone(fixture.response);
          if (outcome === "malformed")
            response.groupPolicy.currentState.signature += "A";
          if (outcome === "expired") current = false;
          return { ok: true as const, data: response };
        },
      });
      if (outcome === "refused") expect((await pending).ok).toBe(false);
      else await expect(pending).rejects.toThrow();
      expect(
        await loadPrincipalMutationJournal(sqlite.execSql, scopeId),
      ).toEqual(outcome === "refused" ? null : expect.anything());
    } finally {
      sqlite.close();
    }
  },
);

test("an unresolved request prevents another submission before HTTP", async () => {
  const fixture = await principalMutationJournalFixture();
  const sqlite = await createTestExecSql("journal-no-overwrite");
  const row = await sealPrincipalMutation(fixture);
  let submissions = 0;
  try {
    await claimPrincipalMutationJournal({
      execSql: sqlite.execSql,
      row,
      stillCurrent: () => true,
    });
    await expect(
      submitJournaledPrincipalMutation({
        ...fixture,
        execSql: sqlite.execSql,
        stillCurrent: () => true,
        submit: async () => {
          submissions += 1;
          return { ok: true, data: fixture.response };
        },
      }),
    ).rejects.toThrow("Resolve the pending principal mutation");
    expect(submissions).toBe(0);
    expect(
      await loadPrincipalMutationJournal(sqlite.execSql, row.scopeId),
    ).toEqual(row);
  } finally {
    sqlite.close();
  }
});

test.each([false, true])(
  "a throwing transport preserves typed uncertain work (recovering=%s)",
  async (recovering) => {
    const fixture = await principalMutationJournalFixture();
    const sqlite = await createTestExecSql("journal-thrown-transport");
    const row = await sealPrincipalMutation(fixture);
    const cause = new Error("transport threw after possible dispatch");
    try {
      if (recovering)
        await claimPrincipalMutationJournal({
          execSql: sqlite.execSql,
          row,
          stillCurrent: () => true,
        });
      const context = {
        ...fixture,
        execSql: sqlite.execSql,
        stillCurrent: () => true,
        submit: async () => {
          throw cause;
        },
      };
      const pending = recovering
        ? recoverJournaledPrincipalMutation(context)
        : submitJournaledPrincipalMutation(context);
      await expect(pending).rejects.toBeInstanceOf(
        PrincipalMutationOutcomeUnknownError,
      );
      await expect(pending).rejects.toMatchObject({ cause });
      expect(
        await loadPrincipalMutationJournal(sqlite.execSql, row.scopeId),
      ).not.toBeNull();
    } finally {
      sqlite.close();
    }
  },
);
