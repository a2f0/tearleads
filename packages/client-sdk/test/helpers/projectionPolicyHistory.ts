import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalPolicyHistorySourceResponse,
  ProjectionPolicyEvidenceResponse,
} from "@tearleads/validators/response";
import type {
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../../src/data/keyingProjectionVerification/types";
import type { ExecSql } from "../../src/data/sqlite/sqlSchema";
import { recoverProjectionPolicyHistory } from "../../src/workflows/principals/recoverProjectionPolicyHistory";
import { principalPolicyHead } from "./principalPolicyFixtures";

export function projectionPolicySource(
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicyHistorySourceResponse {
  return {
    head: principalPolicyHead(bundle),
    grant: bundle.currentState.stateHash,
  };
}

export function projectionDirectoryPayload(
  bundle: PrincipalPolicyBundleResponse,
) {
  return {
    reference: principalPolicyHead(bundle),
    payload: bundle.currentPayload,
  };
}

export function projectionHistoryPages(
  bundles: readonly PrincipalPolicyBundleResponse[],
) {
  return {
    async *getProjectionPolicyHistoryPages(
      source: PrincipalPolicyHistorySourceResponse,
      options?: { readonly afterVersion?: number },
    ) {
      const bundle = bundles.find(
        (bundle) => bundle.currentState.stateHash === source.grant,
      );
      if (!bundle) throw new Error("Missing fixture history grant");
      let afterVersion = options?.afterVersion ?? 0;
      do {
        const previousStates = bundle.previousStates.slice(
          afterVersion,
          afterVersion + 32,
        );
        const through = afterVersion + previousStates.length;
        const nextAfterVersion =
          through === bundle.currentState.version - 1 ? null : through;
        yield {
          ok: true as const,
          data: {
            currentState: bundle.currentState,
            currentProjection: bundle.currentProjection,
            currentGrants: bundle.currentGrants,
            previousStates,
            historyPage: { afterVersion, nextAfterVersion },
          },
        };
        if (nextAfterVersion === null) return;
        afterVersion = nextAfterVersion;
      } while (afterVersion < bundle.currentState.version);
    },
  };
}

export function projectionPolicyWarmer(input: {
  readonly bundles: readonly PrincipalPolicyBundleResponse[];
  readonly execSql: ExecSql;
  readonly resolveUserKey: ProjectionUserKeyResolver;
}): ReferencedPrincipalPolicyWarmer {
  return Object.assign(async () => {}, {
    async resolveProjectionHistory(request: {
      readonly evidence: ProjectionPolicyEvidenceResponse;
      readonly organizationId: string;
      readonly references: readonly ReferencedPrincipalHead[];
      readonly stillCurrent?: (() => boolean) | undefined;
    }) {
      const stillCurrent = () => request.stillCurrent?.() !== false;
      const policies = await recoverProjectionPolicyHistory({
        ...request,
        apiClient: projectionHistoryPages(input.bundles),
        execSql: input.execSql,
        resolveTrustedUserIdentity: input.resolveUserKey,
        protection: {
          localKey: new Uint8Array(32).fill(19),
          context: "projection-history-test",
        },
        stillCurrent,
      });
      return { policies, stillCurrent };
    },
  });
}
