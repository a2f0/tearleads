import { ApiClient } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalPolicySnapshotPageResponse,
} from "@tearleads/validators/response";
import { getClientSQLitePersistenceRuntime } from "../../src/data/sqlite/sqlitePersistenceRuntime";
import type { TrustedUserIdentityResolver } from "../../src/data/trustedUserIdentity";
import type { PublicPrincipalHistoryOptions } from "../../src/workflows/principals/publicPrincipalHistoryTypes";
import { principalPolicyHead } from "./principalPolicyFixtures";

export async function createPublicHistoryFixture(
  history: {
    bundle: PrincipalPolicyBundleResponse;
    resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  },
  retained: readonly PrincipalPolicyBundleResponse[] = [],
) {
  const sqlite = await createTestExecSql("public-principal-history");
  const policies = new Map(
    [history.bundle, ...retained].map((bundle) => [
      bundle.currentState.stateHash,
      bundle,
    ]),
  );
  const requests: number[] = [];
  const controls: {
    failAfter: number | null;
    failureStatus?: number;
    mutate: ((page: PrincipalPolicySnapshotPageResponse) => void) | null;
  } = { failAfter: null, mutate: null };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const query = new URL(request.url).searchParams;
      const bundle = policies.get(query.get("grant") ?? "");
      if (!bundle) return new Response("Not found", { status: 404 });
      const afterVersion = Number(query.get("afterVersion") ?? 0);
      requests.push(afterVersion);
      if (controls.failAfter === afterVersion)
        return new Response("Unavailable", {
          status: controls.failureStatus ?? 503,
        });
      const previousStates = bundle.previousStates.slice(
        afterVersion,
        afterVersion + 32,
      );
      const through = afterVersion + previousStates.length;
      const page: PrincipalPolicySnapshotPageResponse = structuredClone({
        currentState: bundle.currentState,
        currentProjection: bundle.currentProjection,
        currentGrants: bundle.currentGrants,
        previousStates,
        historyPage: {
          afterVersion,
          nextAfterVersion:
            through === bundle.currentState.version - 1 ? null : through,
        },
      });
      controls.mutate?.(page);
      return Response.json(page);
    },
  });
  const client = () => new ApiClient(server.url.origin);
  const source = (bundle = history.bundle) => ({
    head: principalPolicyHead(bundle),
    grant: bundle.currentState.stateHash,
  });
  const options: PublicPrincipalHistoryOptions = {
    apiClient: client(),
    source: source(),
    organizationId: "public-history-test-org",
    execSql: sqlite.execSql,
    protection: {
      localKey: new Uint8Array(32).fill(7),
      context: "local-public-history-test-context",
    },
    resolveTrustedUserIdentity: history.resolveTrustedUserIdentity,
    stillCurrent: () => true,
  };
  return {
    options,
    client,
    source,
    requests,
    controls,
    db: getClientSQLitePersistenceRuntime(sqlite.execSql).db,
    close() {
      server.stop(true);
      sqlite.close();
    },
  };
}
