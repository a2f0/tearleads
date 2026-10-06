import type { ClientOptions, LocalKeyring } from "@tearleads/client-sdk";
import type { LocalKeyringFactory } from "../local-keyring/localKeyringLockSupport";
import { LOCAL_SQLITE_SCOPE_NAMESPACE } from "../local-keyring/localKeyringScopes";

/** Share the protected device root; derive a separate purpose for each identity/API. */
export function createPrincipalHistoryKeyProvider(
  createLocalKeyring: LocalKeyringFactory,
  timeoutMs = 15_000,
): NonNullable<ClientOptions["principalHistoryKeyProvider"]> {
  let queue: Promise<void> = Promise.resolve();
  let keyring: LocalKeyring | null = null;
  return (scope) => {
    const operation = queue.then(async () => {
      const activeKeyring = keyring ?? createLocalKeyring();
      keyring = activeKeyring;
      let expired = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const derive = async () => {
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
        if (expired && keyring === activeKeyring) {
          keyring = null;
          try {
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
