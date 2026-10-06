import { ApiClient } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalPolicyPageResponse,
} from "@tearleads/validators/response";
import { getClientSQLitePersistenceRuntime } from "../../src/data/sqlite/sqlitePersistenceRuntime";
import { createOrganizationHistoryFixture } from "./organizationPolicyHistory";
import {
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "./principalPolicyFixtures";

export async function signedAuthorityRecoveryHistory() {
  const fixture = await createOrganizationHistoryFixture();
  const extend = async (
    initial: PrincipalPolicyBundleResponse,
    version: number,
  ) => {
    let bundle = initial;
    while (bundle.currentState.version < version) {
      bundle = await signedPrincipalPolicyBundle({
        memberEnvelopes: bundle.currentMemberEnvelopes.envelopes,
        payloadCiphertext: bundle.currentPayload.ciphertext,
        projection: bundle.currentProjection,
        previousStates: [
          ...bundle.previousStates,
          {
            state: bundle.currentState,
            projection: bundle.currentProjection,
            grants: bundle.currentGrants,
          },
        ],
        signing: {
          ...bundle.currentState,
          grants: bundle.currentGrants,
          version: bundle.currentState.version + 1,
          prevStateHash: bundle.currentState.stateHash,
        },
        signingPrivateKey: fixture.signingKeyPair.signingPrivateKey,
      });
    }
    return bundle;
  };
  const admin = await extend(fixture.admin, 66);
  const group = await extend(fixture.created, 66);
  const directory = await extend(
    await fixture.advanceDirectory(
      await fixture.advanceDirectory(fixture.afterCreation, admin),
      group,
    ),
    66,
  );
  return { ...fixture, admin, group, directory, extend };
}

export async function createAuthorityRecoveryFixture(
  history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>,
) {
  const sqlite = await createTestExecSql("principal-authority-recovery");
  const policies = new Map(
    [history.directory, history.admin, history.group].map((bundle) => [
      bundle.currentState.principalId,
      bundle,
    ]),
  );
  const requests: {
    principalId: string;
    afterVersion: number;
    count: number;
  }[] = [];
  const controls: {
    mutate: ((page: PrincipalPolicyPageResponse) => void) | null;
  } = { mutate: null };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const bundle = [...policies.values()].find((candidate) =>
        url.pathname.includes(candidate.currentState.principalId),
      );
      if (!bundle) return new Response("Not found", { status: 404 });
      const hash = url.searchParams.get("stateHash");
      if (hash && hash !== bundle.currentState.stateHash)
        return new Response("Changed pin", { status: 409 });
      const afterVersion = Number(url.searchParams.get("afterVersion") ?? 0);
      const previousStates = bundle.previousStates.slice(
        afterVersion,
        afterVersion + 32,
      );
      const next = afterVersion + previousStates.length;
      requests.push({
        principalId: bundle.currentState.principalId,
        afterVersion,
        count: previousStates.length,
      });
      const page: PrincipalPolicyPageResponse = structuredClone({
        ...bundle,
        previousStates,
        historyPage: {
          afterVersion,
          nextAfterVersion:
            next === bundle.currentState.version - 1 ? null : next,
        },
      });
      controls.mutate?.(page);
      return Response.json(page);
    },
  });
  return {
    policies,
    requests,
    controls,
    db: getClientSQLitePersistenceRuntime(sqlite.execSql).db,
    options: {
      apiClient: new ApiClient(server.url.origin),
      execSql: sqlite.execSql,
      organizationId: history.organizationId,
      reference: principalPolicyHead(history.group),
      protection: {
        context: "authority-recovery-test",
        localKey: new Uint8Array(32).fill(9),
      },
      resolveTrustedUserIdentity: history.resolveTrustedUserIdentity,
      stillCurrent: () => true,
    },
    close() {
      server.stop(true);
      sqlite.close();
    },
  };
}
