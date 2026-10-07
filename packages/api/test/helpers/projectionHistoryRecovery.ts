import {
  recoverProjectionPolicyHistory,
  type syncRemoteDocument,
} from "@tearleads/client-sdk";

type Warmer = NonNullable<
  Parameters<typeof syncRemoteDocument>[0]["warmReferencedPrincipalPolicies"]
>;

/** Standalone SDK fixtures own private local history protection, like a host. */
export function withProjectionHistoryRecovery(input: {
  readonly apiClient: Parameters<
    typeof recoverProjectionPolicyHistory
  >[0]["apiClient"];
  readonly execSql: Parameters<
    typeof recoverProjectionPolicyHistory
  >[0]["execSql"];
  readonly resolveTrustedUserIdentity: Parameters<
    typeof recoverProjectionPolicyHistory
  >[0]["resolveTrustedUserIdentity"];
  readonly warmer: Warmer;
}): Warmer {
  const protection = {
    localKey: crypto.getRandomValues(new Uint8Array(32)),
    context: `api-projection-test:${crypto.randomUUID()}`,
  };
  return Object.assign(input.warmer, {
    async resolveProjectionHistory(
      request: Parameters<NonNullable<Warmer["resolveProjectionHistory"]>>[0],
    ) {
      const stillCurrent = () => request.stillCurrent?.() !== false;
      const policies = await recoverProjectionPolicyHistory({
        ...request,
        apiClient: input.apiClient,
        execSql: input.execSql,
        resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
        protection,
        stillCurrent,
      });
      return { policies, stillCurrent };
    },
  });
}
