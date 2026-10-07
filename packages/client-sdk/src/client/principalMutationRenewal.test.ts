import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { SESSION_ERROR_CODES } from "@tearleads/validators/response";
import { quietLogger } from "../../test/helpers/clientTestSupport";
import { principalMutationJournalFixture } from "../../test/helpers/principalMutationJournalFixture";
import { createMemoryBlobStore } from "../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../data/documents/documentKinds";
import { loadPrincipalMutationJournal } from "../data/persistence/principalMutationJournalPersistence";
import { principalMutationJournalScopeId } from "../data/principals/principalMutationJournal";
import { Tearleads } from "./Tearleads";
import { createRuntime } from "./workflowRuntime";

test.each([
  "token",
  "organization",
  "sign-out",
  "database",
  "identity",
] as const)(
  "authentication refusal after %s change preserves the correct journal lifetime",
  async (change) => {
    const fixture = await principalMutationJournalFixture();
    const sqlite = await createTestExecSql("journal-session-renewal");
    let submissions = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        expect(await request.json()).toEqual(fixture.mutation.request);
        submissions += 1;
        return submissions === 1
          ? Response.json(
              {
                code: SESSION_ERROR_CODES.refreshRequired,
                error: "Expired session",
              },
              { status: 401 },
            )
          : Response.json(fixture.response);
      },
    });
    const origin = server.url.origin;
    const sdk = new Tearleads({
      apiBaseUrl: origin,
      blobStoreFactory: () => createMemoryBlobStore(),
      logger: quietLogger,
    });
    const api = new ApiClient(origin);
    let renewals = 0;
    try {
      sdk.database.configure({
        execSql: sqlite.execSql,
        id: "journal-renewal",
      });
      await sdk.identity.setKeyPairs({
        encapsulationKeyPair: generateKemSeedAndKeyPair(),
        signingKeyPair: fixture.signingKeyPair,
      });
      sdk.session.setContext({
        userId: fixture.scope.userId,
        organizationId: fixture.scope.organizationId,
        authToken: "fixture-expired-token",
        isAuthenticated: true,
      });
      api.setAuthToken("fixture-expired-token");
      api.setOnSessionExpired(async () => {
        renewals += 1;
        if (change === "organization") {
          sdk.session.setContext({ organizationId: "other-organization" });
          sdk.session.setContext({
            organizationId: fixture.scope.organizationId,
          });
        } else if (change === "sign-out") {
          sdk.session.setContext({ isAuthenticated: false });
          sdk.session.setContext({ isAuthenticated: true });
        } else if (change === "database") {
          sdk.database.configure({
            execSql: sqlite.execSql,
            id: "replacement",
          });
        } else if (change === "identity") {
          await sdk.identity.setKeyPairs({
            encapsulationKeyPair: generateKemSeedAndKeyPair(),
            signingKeyPair: structuredClone(fixture.signingKeyPair),
          });
        }
        api.setAuthToken("fixture-renewed-token");
        sdk.session.setAuthToken("fixture-renewed-token");
        return true;
      });
      const runtime = createRuntime({
        api,
        blobs: sdk.blobs,
        database: sdk.database,
        documentProjectors: defaultDocumentProjectorRegistry,
        events: sdk.events,
        getDomainScope: () => sdk.domainScope,
        identity: sdk.identity,
        identityTrustDomain: origin,
        log: quietLogger.log,
        logError: quietLogger.logError,
        network: sdk.network,
        reportSecurityIncident: async () => {},
        session: sdk.session,
      });
      const first = await runtime
        .workflowInput()
        .apiClient.commitOrganizationGroupPolicyResult(
          fixture.scope.organizationId,
          fixture.mutation.groupId,
          fixture.mutation.request,
          { reportErrors: false },
        )
        .catch((error: unknown) => error);
      expect(renewals).toBe(1);
      const row = await loadPrincipalMutationJournal(
        sqlite.execSql,
        await principalMutationJournalScopeId({
          ...fixture.scope,
          identityTrustDomain: origin,
        }),
      );
      if (change !== "token") {
        expect(first).toBeInstanceOf(Error);
        expect(first instanceof Error && first.message).toContain(
          "generation expired",
        );
        expect(row).not.toBeNull();
        expect(submissions).toBe(1);
        runtime.retirePrincipalHistoryProtection();
        return;
      }
      expect(row).toBeNull();
      // This is the same preflight the next create/delete/share/membership uses.
      const next = runtime.workflowInput().apiClient;
      await next.recoverPendingPrincipalMutation(fixture.scope.organizationId);
      expect(submissions).toBe(1);
      expect(first).toMatchObject({ ok: false, kind: "http", status: 401 });
      expect(
        await next.readPendingPrincipalMutation(fixture.scope.organizationId),
      ).toBeNull();
      runtime.retirePrincipalHistoryProtection();
    } finally {
      sdk.dispose();
      await server.stop(true);
      sqlite.close();
    }
  },
);
