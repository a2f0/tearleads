import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import invariant from "invariant";
import { principalMutationJournalFixture } from "../../../../test/helpers/principalMutationJournalFixture";
import { PrincipalMutationJournalRepository } from "../../../data/persistence/principalMutationJournalPersistence";
import { principalMutationJournalScopeId } from "../../../data/principals/principalMutationJournal";
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
    else response.memberPolicy.head.version += 1;
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
          : "acknowledgement names another head";
      await expect(
        submitJournaledPrincipalMutation({
          ...context,
          mutation: fixture.mutation,
        }),
      ).rejects.toThrow(error);
      const scopeId = await principalMutationJournalScopeId(fixture.scope);
      const saved = await new PrincipalMutationJournalRepository(
        sqlite.execSql,
      ).loadPrincipalMutationJournal(scopeId);
      expect(saved).not.toBeNull();
      await expect(recoverJournaledPrincipalMutation(context)).rejects.toThrow(
        error,
      );
      expect(
        await new PrincipalMutationJournalRepository(
          sqlite.execSql,
        ).loadPrincipalMutationJournal(scopeId),
      ).toEqual(saved);
      context.submit = async () => ({ ok: true, data: fixture.response });
      await recoverJournaledPrincipalMutation(context);
      expect(
        await new PrincipalMutationJournalRepository(
          sqlite.execSql,
        ).loadPrincipalMutationJournal(scopeId),
      ).toBeNull();
    } finally {
      sqlite.close();
    }
  },
);
