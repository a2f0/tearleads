import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import { principalMutationJournalFixture } from "../../../test/helpers/data/principalMutationJournalFixture";
import { withHeldMemberEnvelopeChanges } from "../../data/principals/memberEnvelopeReferences";
import { createPrincipalMutationApiCustody } from "./principalMutationApi";

const BUNDLE_READ =
  /select[\s\S]*from\s+"?principal_policy_bundles"?\s+where/iu;

/** The fixture's organization leg as a successor: dispatch reads the cache. */
async function successorLeg() {
  const fixture = await principalMutationJournalFixture();
  const leg = fixture.mutation.request.organizationPolicy;
  return {
    fixture,
    leg: { ...leg, state: { ...leg.state, prevStateHash: "0".repeat(64) } },
  };
}

test("a session switch during the held-predecessor read sends nothing", async () => {
  const { fixture, leg } = await successorLeg();
  const sqlite = await createTestExecSql("principal-envelope-scope");
  const organizationId = fixture.scope.organizationId;
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let held = false;
  const execSql = (async (...args: Parameters<typeof sqlite.execSql>) => {
    const [sql] = args;
    if (!held && typeof sql === "string" && BUNDLE_READ.test(sql)) {
      held = true;
      reached.resolve();
      await release.promise;
    }
    return sqlite.execSql(...args);
  }) as typeof sqlite.execSql;
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      requests += 1;
      return Response.json(fixture.response.organizationPolicy);
    },
  });
  let scope = {
    ...fixture.scope,
    identityTrustDomain: server.url.origin,
    database: {},
    generation: 1,
    execSql,
    signingKeyPair: fixture.signingKeyPair,
  };
  try {
    const sent = createPrincipalMutationApiCustody({
      api: new ApiClient(server.url.origin),
      readScope: () => scope,
    })
      .bind()
      .putPrincipalPolicyResult("organization", organizationId, leg, {
        reportErrors: false,
      });
    await reached.promise;
    scope = { ...scope, generation: 2 };
    release.resolve();
    await expect(sent).rejects.toThrow();
    expect(requests).toBe(0);
  } finally {
    await server.stop(true);
    sqlite.close();
  }
});

test("an unreadable held-predecessor cache sends the saved request in full", async () => {
  const { leg } = await successorLeg();
  const sqlite = await createTestExecSql("principal-envelope-cache");
  const execSql = (async (...args: Parameters<typeof sqlite.execSql>) => {
    const [sql] = args;
    if (typeof sql === "string" && BUNDLE_READ.test(sql))
      throw new Error("unreadable cache");
    return sqlite.execSql(...args);
  }) as typeof sqlite.execSql;
  const mutation = {
    kind: "organization" as const,
    groupId: null,
    request: leg,
  };
  try {
    expect(await withHeldMemberEnvelopeChanges(execSql, mutation)).toEqual(
      mutation,
    );
  } finally {
    sqlite.close();
  }
});
