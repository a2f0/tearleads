import type { ClientOptions } from "@tearleads/client-sdk";
import type { LocalKeyringFactory } from "../local-keyring/localKeyringLockSupport";
import { LOCAL_SQLITE_SCOPE_NAMESPACE } from "../local-keyring/localKeyringScopes";

/** Share the protected device root; derive a separate purpose for each identity/API. */
export function createPrincipalHistoryKeyProvider(
  createLocalKeyring: LocalKeyringFactory,
  timeoutMs = 15_000,
): NonNullable<ClientOptions["principalHistoryKeyProvider"]> {
  let queue: Promise<void> = Promise.resolve();
  return (scope) => {
    const operation = queue.then(async () => {
      // The host factory enforces current lock state and backend invalidation.
      const activeKeyring = createLocalKeyring();
      let expired = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const derive = async () => {
        // Runtime leases require a ready database; SQLite bootstrap has already
        // created this root. Recovery must never create a different database key.
        const session = await activeKeyring.loadSession({
          namespace: LOCAL_SQLITE_SCOPE_NAMESPACE,
        });
        if (!session)
          throw new Error(
            "Principal history recovery requires the existing SQLite keyring session",
          );
        try {
          if (expired)
            throw new Error("Principal history key resolution expired");
          const key = await session.deriveKey(
            JSON.stringify([
              "tearleads.principal-history.key.v1",
              scope.identityTrustDomain,
              scope.signingFingerprint,
            ]),
          );
          if (expired) {
            key.fill(0);
            throw new Error("Principal history key resolution expired");
          }
          return key;
        } finally {
          session.dispose();
        }
      };
      try {
        return await Promise.race([
          derive(),
          new Promise<never>((_resolve, reject) => {
            timeoutId = setTimeout(() => {
              expired = true;
              reject(
                new Error(
                  `Principal history key resolution timed out after ${timeoutMs}ms`,
                ),
              );
            }, timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timeoutId);
        if (expired) {
          try {
            // A hung shared backend must be recreated for all consumers, just
            // as in SQLite bootstrap. Successful derivations never retire it.
            createLocalKeyring.invalidateCachedKeyring?.();
          } catch {
            // Preserve the timeout while allowing another factory attempt.
          }
        }
      }
    });
    queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };
}
