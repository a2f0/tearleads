import type {
  PrincipalPolicyBundleResponse,
  PrincipalPolicyHistorySourceResponse,
} from "@tearleads/validators/response";
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
