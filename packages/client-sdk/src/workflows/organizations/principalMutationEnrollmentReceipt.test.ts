import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import invariant from "invariant";
import { principalMutationJournalFixture } from "../../../test/helpers/principalMutationJournalFixture";
import { loadPrincipalMutationJournal } from "../../data/persistence/principalMutationJournalPersistence";
import { principalMutationJournalScopeId } from "../../data/principals/principalMutationJournal";
import {
  recoverJournaledPrincipalMutation,
  submitJournaledPrincipalMutation,
} from "./principalMutationJournalSession";

test.each(["missing", "changed"])(
  "a %s enrollment receipt preserves the entire authored request for retry",
  async (kind) => {
    const fixture = await principalMutationJournalFixture(true);
    const sqlite = await createTestExecSql("enrollment-receipt");
    const response = structuredClone(fixture.response);
    invariant(response.memberPolicy, "expected enrollment receipt");
    if (kind === "missing") delete response.memberPolicy;
    else
      response.memberPolicy.currentState.signedAt = "2026-04-01T00:00:00.000Z";
    const context = {
      ...fixture,
      execSql: sqlite.execSql,
      stillCurrent: () => true,
      submit: async () => ({ ok: true as const, data: response }),
    };
    try {
      const error =
        kind === "missing"
          ? "receipt Members policy differs"
          : "receipt state differs";
      await expect(
        submitJournaledPrincipalMutation({
          ...context,
          mutation: fixture.mutation,
        }),
      ).rejects.toThrow(error);
      const scopeId = await principalMutationJournalScopeId(fixture.scope);
      const saved = await loadPrincipalMutationJournal(sqlite.execSql, scopeId);
      expect(saved).not.toBeNull();
      await expect(recoverJournaledPrincipalMutation(context)).rejects.toThrow(
        error,
      );
      expect(
        await loadPrincipalMutationJournal(sqlite.execSql, scopeId),
      ).toEqual(saved);
      context.submit = async () => ({ ok: true, data: fixture.response });
      await recoverJournaledPrincipalMutation(context);
      expect(
        await loadPrincipalMutationJournal(sqlite.execSql, scopeId),
      ).toBeNull();
    } finally {
      sqlite.close();
    }
  },
);
