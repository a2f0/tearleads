import { createTestRuntimeTrustedUserIdentityResolver } from "../trustedUserIdentity";
import type {
  ExplorerRuntimePatch,
  TestRuntime,
} from "./explorerProviderFixtures";

export function runtimeWithPatch(
  runtime: TestRuntime,
  patch: ExplorerRuntimePatch,
): TestRuntime {
  const {
    cacheReferencedPrincipalPolicies,
    dbStatus,
    encapsulationKeyPair,
    isAuthenticated,
    online,
    organizationId,
    signingFingerprint,
    signingKeyPair,
    userId,
    ...groupedPatch
  } = patch;
  const apiClient = groupedPatch.apiClient ?? runtime.apiClient;
  const auth = {
    ...runtime.auth,
    ...groupedPatch.auth,
    ...(isAuthenticated === undefined ? {} : { isAuthenticated }),
    ...(organizationId === undefined ? {} : { organizationId }),
    ...(userId === undefined ? {} : { userId }),
  };
  const crypto = {
    ...runtime.crypto,
    ...groupedPatch.crypto,
    ...(encapsulationKeyPair === undefined ? {} : { encapsulationKeyPair }),
    ...(signingFingerprint === undefined ? {} : { signingFingerprint }),
    ...(signingKeyPair === undefined ? {} : { signingKeyPair }),
  };
  const resolveTrustedUserIdentity =
    groupedPatch.resolveTrustedUserIdentity ??
    createTestRuntimeTrustedUserIdentityResolver({
      encapsulationPublicKey: crypto.encapsulationKeyPair?.publicKey ?? null,
      loadRemoteIdentity: (requestedUserId) =>
        apiClient.getEncapsulationKey(requestedUserId),
      localUserId: auth.userId,
      signingKeyFingerprint: crypto.signingFingerprint,
      signingPublicKey: crypto.signingKeyPair?.signingPublicKey ?? null,
    });

  return {
    ...runtime,
    ...groupedPatch,
    apiClient,
    auth,
    crypto,
    infra: {
      ...runtime.infra,
      ...groupedPatch.infra,
      ...(dbStatus === undefined ? {} : { dbStatus }),
    },
    state: {
      ...runtime.state,
      ...groupedPatch.state,
      ...(online === undefined ? {} : { online }),
    },
    resolveTrustedUserIdentity,
    util: {
      ...runtime.util,
      ...groupedPatch.util,
      ...(cacheReferencedPrincipalPolicies === undefined
        ? {}
        : { cacheReferencedPrincipalPolicies }),
    },
  };
}
