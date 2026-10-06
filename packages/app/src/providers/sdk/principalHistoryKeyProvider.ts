import type { ClientOptions, LocalKeyring } from "@tearleads/client-sdk";
import { LOCAL_SQLITE_SCOPE_NAMESPACE } from "../local-keyring/localKeyringScopes";

/** Share the protected device root; derive a separate purpose for each identity/API. */
export function createPrincipalHistoryKeyProvider(
  createLocalKeyring: () => LocalKeyring,
): NonNullable<ClientOptions["principalHistoryKeyProvider"]> {
  let queue: Promise<void> = Promise.resolve();
  let keyring: LocalKeyring | null = null;
  return (scope) => {
    const operation = queue.then(async () => {
      keyring ??= createLocalKeyring();
      const session = await keyring.getOrCreateSession({
        namespace: LOCAL_SQLITE_SCOPE_NAMESPACE,
      });
      try {
        return await session.deriveKey(
          JSON.stringify([
            "tearleads.principal-history.key.v1",
            scope.identityTrustDomain,
            scope.signingFingerprint,
          ]),
        );
      } finally {
        session.dispose();
      }
    });
    queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };
}
