import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { principalMutationJournalFixture } from "../../../test/helpers/principalMutationJournalFixture";
import { loadPrincipalMutationJournal } from "../../data/persistence/principalMutationJournalPersistence";
import {
  type AuthoredPrincipalMutation,
  principalMutationJournalScopeId,
} from "../../data/principals/principalMutationJournal";
import {
  recoverJournaledPrincipalMutation,
  submitJournaledPrincipalMutation,
} from "./principalMutationJournalSession";

test.each([undefined, "group-create", "group-delete", "organization"] as const)(
  "a custom transport's wrong receipt kind preserves the %s journal",
  async (kind) => {
    const fixture = await principalMutationJournalFixture();
    const sqlite = await createTestExecSql("journal-wrong-operation");
    const { groupId, request } = fixture.mutation;
    const mutation: AuthoredPrincipalMutation =
      kind === "group-create"
        ? {
            kind,
            groupId,
            request: {
              groupId,
              initialGroupPolicy: request.groupPolicy,
              organizationPolicy: request.organizationPolicy,
            },
          }
        : kind === "group-delete"
          ? {
              kind,
              groupId,
              request: { organizationPolicy: request.organizationPolicy },
            }
          : kind === "organization"
            ? { kind, groupId: null, request: request.organizationPolicy }
            : fixture.mutation;
    const context = {
      ...fixture,
      execSql: sqlite.execSql,
      stillCurrent: () => true,
      // Bypass the HTTP schema boundary to exercise the host callback contract.
      submit: async () => ({
        ok: true as const,
        data:
          kind === undefined
            ? fixture.response.organizationPolicy
            : fixture.response,
      }),
    };
    try {
      await expect(
        submitJournaledPrincipalMutation({ ...context, mutation }),
      ).rejects.toThrow(
        "Principal mutation receipt operation or target differs",
      );
      const scopeId = await principalMutationJournalScopeId(fixture.scope);
      const saved = await loadPrincipalMutationJournal(sqlite.execSql, scopeId);
      expect(saved).not.toBeNull();
      await expect(recoverJournaledPrincipalMutation(context)).rejects.toThrow(
        "Principal mutation receipt operation or target differs",
      );
      expect(
        await loadPrincipalMutationJournal(sqlite.execSql, scopeId),
      ).toEqual(saved);
    } finally {
      sqlite.close();
    }
  },
);
