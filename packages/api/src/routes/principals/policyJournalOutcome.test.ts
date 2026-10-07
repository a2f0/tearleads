import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { db } from "@tearleads/api-shared/postgres";
import { principalPolicyCommits } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  type PrincipalMutationJournalContext,
  PrincipalMutationOutcomeUnknownError,
  recoverJournaledPrincipalMutation,
  submitJournaledPrincipalMutation,
} from "@tearleads/client-sdk";
import { createTestExecSql } from "@tearleads/test-utils";
import { isCommitOrganizationGroupPolicyResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  buildOrganizationGroupPolicyCommitRequest,
  createPolicyTestGroup,
  createSignedPrincipalState,
  getDefaultOrganizationId,
} from "../../../test/helpers/principalPolicy";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { createRequestLifetimeBindings } from "../../middleware/requestLifetime";
import { routeApp } from "../../routeApp";

test("SDK journal recovers a lost HTTP acknowledgement after a later policy commit", async () => {
  const actor = createTestUser();
  await registerAndAuthenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const groupId = crypto.randomUUID();
  await createPolicyTestGroup(actor.userId, groupId);
  const signing = {
    principalType: "group" as const,
    principalId: groupId,
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
    members: [{ userId: actor.userId }],
  };
  const firstRequest = await buildOrganizationGroupPolicyCommitRequest({
    actor,
    organizationId,
    groupPolicy: await createSignedPrincipalState(signing),
  });
  const sqlite = await createTestExecSql("journal-real-http");
  const committed = Promise.withResolvers<unknown>();
  const release = Promise.withResolvers<void>();
  const cancellation = new AbortController();
  let holdResponse = true;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request, server) {
      const response = await routeApp.fetch(
        request,
        createRequestLifetimeBindings(request, server),
      );
      if (response.status === 200 && holdResponse) {
        holdResponse = false;
        committed.resolve(await response.clone().json());
        await release.promise;
      }
      return response;
    },
  });
  const client = () => {
    const api = new ApiClient(server.url.origin);
    api.setAuthToken(actor.token);
    return api;
  };
  const firstClient = client();
  const context: PrincipalMutationJournalContext = {
    execSql: sqlite.execSql,
    scope: {
      identityTrustDomain: server.url.origin,
      organizationId,
      userId: actor.userId,
      signingFingerprint: actor.fingerprint,
    },
    signingKeyPair: actor.signing,
    stillCurrent: () => true,
    submit: (mutation) =>
      firstClient.commitOrganizationGroupPolicyResult(
        organizationId,
        mutation.groupId,
        mutation.request,
        { signal: cancellation.signal, reportErrors: false },
      ),
  };
  try {
    const interrupted = submitJournaledPrincipalMutation({
      ...context,
      mutation: { groupId, request: firstRequest },
    }).then(
      () => null,
      (error: unknown) => error,
    );
    const first = await Promise.race([
      committed.promise,
      interrupted.then(() => {
        throw new Error("Request ended before committing");
      }),
    ]);
    if (!isCommitOrganizationGroupPolicyResponse(first))
      throw new Error("Missing committed response");
    cancellation.abort();
    expect(await interrupted).toBeInstanceOf(
      PrincipalMutationOutcomeUnknownError,
    );
    release.resolve();
    expect(
      await sqlite.execSql("SELECT scope_id FROM principal_mutation_journal"),
    ).toHaveLength(1);

    const secondRequest = await buildOrganizationGroupPolicyCommitRequest({
      actor,
      organizationId,
      groupPolicy: await createSignedPrincipalState({
        ...signing,
        version: 2,
        keyEpoch: 2,
        prevStateHash: first.groupPolicy.currentState.stateHash,
      }),
    });
    expect(
      (
        await client().commitOrganizationGroupPolicyResult(
          organizationId,
          groupId,
          secondRequest,
          { signal: AbortSignal.timeout(15_000), reportErrors: false },
        )
      ).ok,
    ).toBe(true);

    const freshClient = client();
    const recovered = await recoverJournaledPrincipalMutation({
      ...context,
      scope: { ...context.scope },
      signingKeyPair: structuredClone(actor.signing),
      submit: (mutation) => {
        expect(mutation.request).toEqual(firstRequest);
        return freshClient.commitOrganizationGroupPolicyResult(
          organizationId,
          mutation.groupId,
          mutation.request,
          { signal: AbortSignal.timeout(15_000), reportErrors: false },
        );
      },
    });
    expect(recovered?.response).toEqual(first);
    expect(
      await sqlite.execSql("SELECT scope_id FROM principal_mutation_journal"),
    ).toHaveLength(0);
    expect(
      (await getCurrentPrincipalState("group", groupId, db))?.version,
    ).toBe(2);
    expect(
      (await getCurrentPrincipalState("organization", organizationId, db))
        ?.version,
    ).toBe(first.organizationPolicy.currentState.version + 1);
    expect(
      await db
        .select()
        .from(principalPolicyCommits)
        .where(eq(principalPolicyCommits.groupId, groupId)),
    ).toHaveLength(2);
  } finally {
    cancellation.abort();
    release.resolve();
    await server.stop(true);
    sqlite.close();
  }
}, 20_000);
