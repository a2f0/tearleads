import type { ApiClient } from "@tearleads/api-client";
import { createMockApiClient } from "@tearleads/test-utils";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { PRINCIPAL_DISPLAY_HISTORY_PAGE_SIZE } from "@tearleads/validators/response";
import type { PrincipalHistoryProtectionLease } from "../../src/data/principals/principalHistoryProtection";
import type { ExecSql } from "../../src/data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../src/data/trustedUserIdentity";
import { createRuntimePrincipalPolicyWarmer } from "../../src/workflows/principals/runtimePolicyWarmer";

export function repairPolicyPages(
  bundles: readonly PrincipalPolicyBundleResponse[],
): ApiClient["getPrincipalPolicyPages"] {
  return async function* (type, id, options = {}) {
    const bundle = bundles.find(
      (candidate) =>
        candidate.currentState.principalType === type &&
        candidate.currentState.principalId === id,
    );
    if (
      !bundle ||
      (options.stateHash && bundle.currentState.stateHash !== options.stateHash)
    )
      throw new Error("Missing repair fixture head");
    let afterVersion =
      options.resume?.afterVersion ?? options.afterVersion ?? 0;
    while (true) {
      const previousStates = bundle.previousStates.slice(
        afterVersion,
        afterVersion + PRINCIPAL_DISPLAY_HISTORY_PAGE_SIZE,
      );
      const next = afterVersion + previousStates.length;
      const nextAfterVersion =
        next === bundle.currentState.version - 1 ? null : next;
      yield {
        ok: true,
        data: structuredClone({
          ...bundle,
          previousStates,
          historyPage: { afterVersion, nextAfterVersion },
        }),
      };
      if (nextAfterVersion === null) return;
      afterVersion = nextAfterVersion;
    }
  };
}

export function repairProtectionLease(
  stillCurrent = () => true,
): PrincipalHistoryProtectionLease {
  return async (operation) => {
    const localKey = new Uint8Array(32).fill(7);
    try {
      return await operation({
        protection: { context: "repair-test", localKey },
        stillCurrent,
      });
    } finally {
      localKey.fill(0);
    }
  };
}

export function createRepairWarmer(input: {
  execSql: ExecSql;
  bundles: readonly PrincipalPolicyBundleResponse[];
  resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  stillCurrent?: () => boolean;
}) {
  const requests: { principalId: string; count: number }[] = [];
  const pages = repairPolicyPages(input.bundles);
  const apiClient = createMockApiClient({
    getCurrentPrincipalPolicy: async () => {
      throw new Error("Full policy reads are forbidden");
    },
    getPrincipalPolicyPages: async function* (...args) {
      if (this !== apiClient) throw new Error("Lost API receiver");
      for await (const page of pages.apply(this, args)) {
        if (page.ok)
          requests.push({
            principalId: args[1],
            count: page.data.previousStates.length,
          });
        yield page;
      }
    },
  });
  const warmer = createRuntimePrincipalPolicyWarmer({
    apiClient,
    infra: { execSql: input.execSql },
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    withPrincipalHistoryProtection: repairProtectionLease(input.stillCurrent),
    util: { reportSecurityIncident: async () => {} },
  });
  return { warmer, apiClient, requests };
}
