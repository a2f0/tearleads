import type { LocalKeyringScope } from "@symcrypt/client-sdk";

export const LOCAL_BLOB_STORE_SCOPE_NAMESPACE = "symcrypt.blob-store";
export const LOCAL_SQLITE_SCOPE_NAMESPACE = "symcrypt.sqlite";
const LOCAL_IDENTITY_SCOPE_PREFIX = "symcrypt.local-identity:";

export function localIdentityScope(namespace: string): LocalKeyringScope {
  return {
    namespace: `${LOCAL_IDENTITY_SCOPE_PREFIX}${namespace}`,
  };
}

export function appLocalKeyringScopes(
  namespace: string | null,
): readonly LocalKeyringScope[] {
  const blobStoreScope = { namespace: LOCAL_BLOB_STORE_SCOPE_NAMESPACE };
  const sqliteScope = { namespace: LOCAL_SQLITE_SCOPE_NAMESPACE };
  return namespace
    ? [localIdentityScope(namespace), blobStoreScope, sqliteScope]
    : [blobStoreScope, sqliteScope];
}
