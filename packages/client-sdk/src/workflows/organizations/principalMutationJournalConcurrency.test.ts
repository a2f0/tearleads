import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import { principalMutationJournalFixture } from "../../../test/helpers/principalMutationJournalFixture";
import { loadPrincipalMutationJournal } from "../../data/persistence/principalMutationJournalPersistence";
import { principalMutationJournalScopeId } from "../../data/principals/principalMutationJournal";
import {
  type PrincipalMutationJournalContext,
  recoverJournaledPrincipalMutation,
  submitJournaledPrincipalMutation,
} from "./principalMutationJournalSession";

test("recovery waits for an owned dispatch instead of resubmitting it", async () => {
  const fixture = await principalMutationJournalFixture();
  const sqlite = await createTestExecSql("journal-owned-dispatch");
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let submissions = 0;
  const context: PrincipalMutationJournalContext = {
    ...fixture,
    execSql: sqlite.execSql,
    stillCurrent: () => true,
    submit: async () => {
      submissions += 1;
      started.resolve();
      await release.promise;
      return { ok: true, data: fixture.response };
    },
  };
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const initial = submitJournaledPrincipalMutation({
      ...context,
      mutation: fixture.mutation,
    });
    await started.promise;
    const recovery = recoverJournaledPrincipalMutation(context);
    releaseTimer = setTimeout(() => release.resolve(), 100);
    const [submitted, recovered] = await Promise.all([initial, recovery]);
    expect(submitted.ok).toBe(true);
    expect(submissions).toBe(1);
    expect(recovered).toBeNull();
  } finally {
    clearTimeout(releaseTimer);
    release.resolve();
    sqlite.close();
  }
});

test("an API-client cancellation before dispatch retires the never-submitted request", async () => {
  const fixture = await principalMutationJournalFixture();
  const sqlite = await createTestExecSql("journal-pre-dispatch-cancel");
  const api = new ApiClient(fixture.scope.identityTrustDomain);
  api.setAuthToken("fixture");
  try {
    const result = await submitJournaledPrincipalMutation({
      ...fixture,
      execSql: sqlite.execSql,
      stillCurrent: () => true,
      submit: (mutation) =>
        api.commitOrganizationGroupPolicyResult(
          fixture.scope.organizationId,
          mutation.groupId,
          mutation.request,
          { signal: AbortSignal.abort(), reportErrors: false },
        ),
    });
    expect(result).toMatchObject({ ok: false, kind: "cancelled" });
    expect(
      await loadPrincipalMutationJournal(
        sqlite.execSql,
        await principalMutationJournalScopeId(fixture.scope),
      ),
    ).toBeNull();
    let retries = 0;
    expect(
      await recoverJournaledPrincipalMutation({
        ...fixture,
        execSql: sqlite.execSql,
        stillCurrent: () => true,
        submit: async () => {
          retries += 1;
          return { ok: true, data: fixture.response };
        },
      }),
    ).toBeNull();
    expect(retries).toBe(0);
  } finally {
    sqlite.close();
  }
});
