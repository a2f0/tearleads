import type { LocalKeyringScope } from "@tearleads/client-sdk";

export const LOCAL_BLOB_STORE_SCOPE_NAMESPACE = "tearleads.blob-store";
const LOCAL_IDENTITY_SCOPE_PREFIX = "tearleads.local-identity:";

export function localIdentityScope(namespace: string): LocalKeyringScope {
  return {
    namespace: `${LOCAL_IDENTITY_SCOPE_PREFIX}${namespace}`,
  };
}

export function appLocalKeyringScopes(
  namespace: string | null,
): readonly LocalKeyringScope[] {
  const blobStoreScope = { namespace: LOCAL_BLOB_STORE_SCOPE_NAMESPACE };
  return namespace
    ? [localIdentityScope(namespace), blobStoreScope]
    : [blobStoreScope];
}
