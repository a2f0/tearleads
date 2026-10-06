import {
  recoverScopedPrincipalPolicyHistory,
  type syncRemoteDocument,
} from "@tearleads/client-sdk";

type SyncInput = Parameters<typeof syncRemoteDocument>[0];

/** Exercise the public scoped recovery and projection contracts on a fresh DB. */
export function createPagedColdPolicyWarmer(input: {
  apiClient: Parameters<
    typeof recoverScopedPrincipalPolicyHistory
  >[0]["apiClient"];
  execSql: SyncInput["execSql"];
  resolveTrustedUserIdentity: Parameters<
    typeof recoverScopedPrincipalPolicyHistory
  >[0]["resolveTrustedUserIdentity"];
  onResolve: () => void;
}): {
  warmer: NonNullable<SyncInput["warmReferencedPrincipalPolicies"]>;
  dispose: () => void;
} {
  const protection = {
    localKey: crypto.getRandomValues(new Uint8Array(32)),
    context: `cold-history-test:${crypto.randomUUID()}`,
  };
  let tail = Promise.resolve();
  const warmer: NonNullable<SyncInput["warmReferencedPrincipalPolicies"]> =
    Object.assign(
      async () => {
        throw new Error("Cold recovery requested a full policy bundle");
      },
      {
        resolveReference(
          request: Parameters<
            NonNullable<
              NonNullable<
                SyncInput["warmReferencedPrincipalPolicies"]
              >["resolveReference"]
            >
          >[0],
        ) {
          const operation = tail.then(async () => {
            input.onResolve();
            const stillCurrent = () => request.stillCurrent?.() !== false;
            const result = await recoverScopedPrincipalPolicyHistory({
              ...input,
              protection,
              organizationId: request.organizationId,
              reference: request.reference,
              stillCurrent,
            });
            return {
              organizationId: request.organizationId,
              policy: result.policy,
              dependencies: result.dependencies,
              stillCurrent,
            };
          });
          tail = operation.then(
            () => undefined,
            () => undefined,
          );
          return operation;
        },
      },
    );
  return {
    warmer,
    dispose: () => {
      protection.localKey.fill(0);
    },
  };
}
