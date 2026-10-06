import { KeyingVerificationError } from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../data/keyingProjectionVerification/types";
import type { PrincipalHistoryProtectionLease } from "../data/principals/principalHistoryProtection";

export interface PrincipalHistoryKeyScope {
  readonly identityTrustDomain: string;
  readonly signingFingerprint: string;
}

/** Return a fresh owned 32-byte key. The SDK clears it after each operation. */
export type PrincipalHistoryKeyProvider = (
  scope: PrincipalHistoryKeyScope,
) => Promise<Uint8Array>;

interface RuntimeProtectionScope extends PrincipalHistoryKeyScope {
  readonly database: object;
  readonly generation: number;
}

function sameScope(
  a: RuntimeProtectionScope | null,
  b: RuntimeProtectionScope,
): boolean {
  return (
    a?.database === b.database &&
    a.generation === b.generation &&
    a.identityTrustDomain === b.identityTrustDomain &&
    a.signingFingerprint === b.signingFingerprint
  );
}

export function createPrincipalHistoryProtectionCustody(input: {
  readonly readScope: () => RuntimeProtectionScope | null;
  readonly keyProvider?: PrincipalHistoryKeyProvider | undefined;
}) {
  let retirement = 0;
  let ephemeral: { scope: RuntimeProtectionScope; key: Uint8Array } | null =
    null;
  const clearEphemeral = () => {
    ephemeral?.key.fill(0);
    ephemeral = null;
  };
  return {
    retire() {
      retirement += 1;
      clearEphemeral();
    },
    bind(): PrincipalHistoryProtectionLease | undefined {
      const scope = input.readScope();
      if (!scope) {
        clearEphemeral();
        return undefined;
      }
      if (ephemeral && !sameScope(ephemeral.scope, scope)) clearEphemeral();
      const boundRetirement = retirement;
      const stillCurrent = () =>
        retirement === boundRetirement && sameScope(input.readScope(), scope);
      const context = JSON.stringify([
        "tearleads.sdk.principal-history.runtime.v1",
        scope.identityTrustDomain,
        scope.signingFingerprint,
      ]);
      return async (operation) => {
        assertProjectionVerificationCurrent(stillCurrent);
        let key: Uint8Array | undefined;
        try {
          if (input.keyProvider) {
            key = await input.keyProvider({
              identityTrustDomain: scope.identityTrustDomain,
              signingFingerprint: scope.signingFingerprint,
            });
          } else {
            ephemeral ??= {
              scope,
              key: crypto.getRandomValues(new Uint8Array(32)),
            };
            key = new Uint8Array(ephemeral.key);
          }
          if (!(key instanceof Uint8Array) || key.byteLength !== 32)
            throw new KeyingVerificationError(
              "invalid_shape",
              "Principal history key provider must return 32 private bytes",
            );
          assertProjectionVerificationCurrent(stillCurrent);
          const result = await operation({
            protection: { localKey: key, context },
            stillCurrent,
          });
          assertProjectionVerificationCurrent(stillCurrent);
          return result;
        } finally {
          if (key instanceof Uint8Array) key.fill(0);
        }
      };
    },
  };
}
