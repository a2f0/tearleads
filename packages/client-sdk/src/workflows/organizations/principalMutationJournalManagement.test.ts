import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { principalMutationJournalFixture } from "../../../test/helpers/principalMutationJournalFixture";
import {
  claimPrincipalMutationJournal,
  loadPrincipalMutationJournal,
} from "../../data/persistence/principalMutationJournalPersistence";
import { sealPrincipalMutation } from "../../data/principals/principalMutationJournal";
import {
  abandonJournaledPrincipalMutation,
  readJournaledPrincipalMutation,
} from "./principalMutationJournalManagement";
import {
  recoverJournaledPrincipalMutation,
  submitJournaledPrincipalMutation,
} from "./principalMutationJournalSession";

test.each([403, 409, 503])(
  "an explicit choice can stop retrying unresolved work after HTTP %s",
  async (status) => {
    const fixture = await principalMutationJournalFixture();
    const sqlite = await createTestExecSql("journal-explicit-abandon");
    const context = {
      ...fixture,
      execSql: sqlite.execSql,
      stillCurrent: () => true,
    };
    const row = await sealPrincipalMutation(fixture);
    try {
      await claimPrincipalMutationJournal({ ...context, row });
      await expect(
        recoverJournaledPrincipalMutation({
          ...context,
          submit: async () => ({
            ok: false,
            kind: "http",
            status,
            statusText: "fixture",
            message: "fixture",
            method: "PUT",
            path: "/fixture",
            report() {},
          }),
        }),
      ).rejects.toThrow("may have committed");
      const mutation = await readJournaledPrincipalMutation(context);
      expect(mutation).toEqual(fixture.mutation);
      if (!mutation || mutation.kind !== undefined)
        throw new Error("Missing compound authored work");
      expect(
        await abandonJournaledPrincipalMutation({
          ...context,
          mutation,
          acknowledgeUnknownOutcome: true,
        }),
      ).toBe(true);
      expect(
        await loadPrincipalMutationJournal(sqlite.execSql, row.scopeId),
      ).toBeNull();
      // Abandonment neither submits nor writes a current-policy checkpoint.
      expect(
        await sqlite.execSql(
          "SELECT name FROM sqlite_master WHERE name = 'principal_policy_checkpoints'",
        ),
      ).toHaveLength(0);
    } finally {
      sqlite.close();
    }
  },
);

test.each(["changed", "corrupt", "expired"] as const)(
  "a %s inspected request cannot clear authored work",
  async (failure) => {
    const fixture = await principalMutationJournalFixture();
    const sqlite = await createTestExecSql("journal-abandon-guard");
    let current = true;
    const context = {
      ...fixture,
      execSql: sqlite.execSql,
      stillCurrent: () => current,
    };
    const row = await sealPrincipalMutation(fixture);
    try {
      await claimPrincipalMutationJournal({ ...context, row });
      const mutation = await readJournaledPrincipalMutation(context);
      if (!mutation || mutation.kind !== undefined)
        throw new Error("Missing compound authored work");
      if (failure === "changed")
        mutation.request.groupPolicy.encryptedPayload.ciphertext += "changed";
      if (failure === "corrupt")
        await sqlite.execSql(
          "UPDATE principal_mutation_journal SET signature = ?",
          ["corrupt"],
        );
      if (failure === "expired") current = false;
      await expect(
        abandonJournaledPrincipalMutation({
          ...context,
          mutation,
          acknowledgeUnknownOutcome: true,
        }),
      ).rejects.toThrow();
      expect(
        await loadPrincipalMutationJournal(sqlite.execSql, row.scopeId),
      ).not.toBeNull();
    } finally {
      sqlite.close();
    }
  },
);

test("a fresh lifetime can explicitly abandon a definitive refusal retained by an expired caller", async () => {
  const fixture = await principalMutationJournalFixture();
  const sqlite = await createTestExecSql("journal-expired-refusal");
  let current = true;
  const context = {
    ...fixture,
    execSql: sqlite.execSql,
    stillCurrent: () => current,
  };
  try {
    await expect(
      submitJournaledPrincipalMutation({
        ...context,
        submit: async () => {
          current = false;
          return {
            ok: false,
            kind: "http",
            status: 409,
            statusText: "fixture",
            message: "fixture",
            method: "PUT",
            path: "/fixture",
            report() {},
          };
        },
      }),
    ).rejects.toThrow("generation expired");
    const fresh = { ...context, stillCurrent: () => true };
    const mutation = await readJournaledPrincipalMutation(fresh);
    expect(mutation).toEqual(fixture.mutation);
    if (!mutation) throw new Error("Missing retained request");
    expect(
      await abandonJournaledPrincipalMutation({
        ...fresh,
        mutation,
        acknowledgeUnknownOutcome: true,
      }),
    ).toBe(true);
    expect(await readJournaledPrincipalMutation(fresh)).toBeNull();
  } finally {
    sqlite.close();
  }
});
