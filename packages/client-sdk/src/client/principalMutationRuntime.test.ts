import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { quietLogger } from "../../test/helpers/clientTestSupport";
import { principalMutationJournalFixture } from "../../test/helpers/principalMutationJournalFixture";
import { createMemoryBlobStore } from "../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../data/documents/documentKinds";
import { loadGroupPolicyMutationContext } from "../workflows/organizations/groupPolicyMutationContext";
import { createOrganizations } from "./organizations";
import { Tearleads } from "./Tearleads";
import { createRuntime } from "./workflowRuntime";

test("runtime resolves an uncertain authored mutation before reading for the next mutation", async () => {
  const fixture = await principalMutationJournalFixture();
  const sqlite = await createTestExecSql("journal-runtime-wiring");
  const sdk = new Tearleads({
    apiBaseUrl: fixture.scope.identityTrustDomain,
    blobStoreFactory: () => createMemoryBlobStore(),
    logger: quietLogger,
  });
  const events: string[] = [];
  let lost = true;
  const api = new ApiClient(fixture.scope.identityTrustDomain);
  api.commitOrganizationGroupPolicyResult = async (
    _organization,
    _group,
    request,
  ) => {
    expect(request).toEqual(fixture.mutation.request);
    events.push("commit");
    return lost
      ? {
          ok: false,
          kind: "outcome-unknown",
          status: null,
          message: "disconnected",
          method: "POST",
          path: "/fixture",
          statusText: "",
          report() {},
        }
      : { ok: true, data: fixture.response };
  };
  api.getCurrentPrincipalPolicy = async (type) => {
    events.push(type);
    return null;
  };
  try {
    sdk.database.configure({ execSql: sqlite.execSql, id: "journal" });
    await sdk.identity.setKeyPairs({
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
      signingKeyPair: fixture.signingKeyPair,
    });
    sdk.session.setContext({
      userId: fixture.scope.userId,
      organizationId: fixture.scope.organizationId,
      authToken: "fixture-first-token",
      isAuthenticated: true,
    });
    const runtime = createRuntime({
      api,
      blobs: sdk.blobs,
      database: sdk.database,
      documentProjectors: defaultDocumentProjectorRegistry,
      events: sdk.events,
      getDomainScope: () => sdk.domainScope,
      identity: sdk.identity,
      identityTrustDomain: fixture.scope.identityTrustDomain,
      log: quietLogger.log,
      logError: quietLogger.logError,
      network: sdk.network,
      reportSecurityIncident: async () => {},
      session: sdk.session,
    });
    const oldApi = runtime.workflowInput().apiClient;
    await expect(
      oldApi.commitOrganizationGroupPolicyResult(
        fixture.scope.organizationId,
        fixture.mutation.groupId,
        fixture.mutation.request,
      ),
    ).rejects.toThrow("may have committed");
    const organizations = createOrganizations(runtime, sdk.containerContents);
    expect(
      await organizations.readPendingPolicyMutation(
        fixture.scope.organizationId,
      ),
    ).toEqual(fixture.mutation);
    await expect(
      organizations.readPendingPolicyMutation("other-organization"),
    ).rejects.toThrow("generation expired");
    sdk.session.setAuthToken("fixture-renewed-token");
    await expect(
      oldApi.commitOrganizationGroupPolicyResult(
        fixture.scope.organizationId,
        fixture.mutation.groupId,
        fixture.mutation.request,
      ),
    ).rejects.toThrow("generation expired");
    lost = false;
    await expect(
      loadGroupPolicyMutationContext({
        apiClient: runtime.workflowInput().apiClient,
        execSql: sqlite.execSql,
        groupId: fixture.mutation.groupId,
        organizationId: fixture.scope.organizationId,
        resolveTrustedUserIdentity: async () => null,
        signerUserId: fixture.scope.userId,
        signingFingerprint: fixture.scope.signingFingerprint,
        signingKeyPair: fixture.signingKeyPair,
      }),
    ).rejects.toThrow("Organization admin authority could not be verified");
    expect(events).toEqual(["commit", "commit", "organization"]);
    const submitAgain = () =>
      runtime
        .workflowInput()
        .apiClient.commitOrganizationGroupPolicyResult(
          fixture.scope.organizationId,
          fixture.mutation.groupId,
          fixture.mutation.request,
        );
    lost = true;
    await expect(submitAgain()).rejects.toThrow("may have committed");
    lost = false;
    await organizations.retryPendingPolicyMutation(
      fixture.scope.organizationId,
    );
    expect(
      await organizations.readPendingPolicyMutation(
        fixture.scope.organizationId,
      ),
    ).toBeNull();
    lost = true;
    await expect(submitAgain()).rejects.toThrow("may have committed");
    await organizations.abandonPendingPolicyMutation({
      organizationId: fixture.scope.organizationId,
      mutation: fixture.mutation,
      acknowledgeUnknownOutcome: true,
    });
    expect(
      await organizations.readPendingPolicyMutation(
        fixture.scope.organizationId,
      ),
    ).toBeNull();
    expect(events).toEqual([
      "commit",
      "commit",
      "organization",
      "commit",
      "commit",
      "commit",
    ]);
    runtime.retirePrincipalHistoryProtection();
  } finally {
    sdk.dispose();
    sqlite.close();
  }
});
