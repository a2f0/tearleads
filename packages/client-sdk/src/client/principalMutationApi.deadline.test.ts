import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import { principalMutationJournalFixture } from "../../test/helpers/principalMutationJournalFixture";
import { PrincipalMutationOutcomeUnknownError } from "../workflows/organizations/principalMutationJournalSession";
import { createPrincipalMutationApiCustody } from "./principalMutationApi";

test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
  "invalid mutation deadline %s is rejected before journal custody is created",
  (principalMutationTimeoutMs) => {
    expect(() =>
      createPrincipalMutationApiCustody({
        api: new ApiClient("https://deadline.example.test"),
        readScope: () => null,
        principalMutationTimeoutMs,
      }),
    ).toThrow(RangeError);
  },
);

test("a stalled interactive commit releases its journal lane with the exact request still recoverable", async () => {
  const fixture = await principalMutationJournalFixture();
  const sqlite = await createTestExecSql("interactive-policy-deadline");
  const response = Promise.withResolvers<Response>();
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      expect(await request.json()).toEqual(fixture.mutation.request);
      requests += 1;
      return response.promise;
    },
  });
  const api = new ApiClient(server.url.origin);
  const scope = {
    ...fixture.scope,
    identityTrustDomain: server.url.origin,
    database: {},
    generation: 1,
    execSql: sqlite.execSql,
    signingKeyPair: fixture.signingKeyPair,
  };
  const bound = createPrincipalMutationApiCustody({
    api,
    readScope: () => scope,
    principalMutationTimeoutMs: 500,
  }).bind();
  // Without a dispatch deadline the request reaches this late success, so the
  // rejection assertion fails and cleanup still finishes normally.
  const watchdog = setTimeout(
    () => response.resolve(Response.json(fixture.response)),
    1_500,
  );
  const pending = bound.commitOrganizationGroupPolicyResult(
    fixture.scope.organizationId,
    fixture.mutation.groupId,
    fixture.mutation.request,
    { reportErrors: false },
  );
  try {
    await expect(pending).rejects.toBeInstanceOf(
      PrincipalMutationOutcomeUnknownError,
    );
    expect(requests).toBe(1);
    const saved = await bound.readPendingPrincipalMutation(
      fixture.scope.organizationId,
    );
    expect(saved).toEqual(fixture.mutation);
    if (!saved) throw new Error("Expected saved request");
    expect(
      await bound.abandonPendingPrincipalMutation(
        fixture.scope.organizationId,
        saved,
        true,
      ),
    ).toBe(true);
    expect(
      await bound.readPendingPrincipalMutation(fixture.scope.organizationId),
    ).toBeNull();
  } finally {
    clearTimeout(watchdog);
    response.resolve(Response.json(fixture.response));
    await pending.catch(() => {});
    server.stop(true);
    sqlite.close();
  }
}, 5_000);
