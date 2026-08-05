/**
 * Public seam for the on-device local keyring: a wrapped account-root secret in
 * a manifest, HKDF-derived per-purpose keys, and the pluggable
 * {@link WrappingKeyKeystore} / {@link LocalKeyringManifestStore} backends the
 * host platform supplies. Implementation lives in `./localKeyring/`; callers
 * (including `./localKeyringPinCode`) import from here.
 */
export type { BrowserLocalKeyringOptions } from "./localKeyring/browser";
export {
  createBrowserLocalKeyring,
  createBrowserLocalKeyringManifestStore,
  createWebViewLocalKeyring,
  resolveBrowserLocalKeyringManifestStore,
} from "./localKeyring/browser";
export {
  assertEnvelopeContextMatches,
  assertWrappedLocalSecretEnvelope,
  readWrappedLocalSecretEnvelope,
} from "./localKeyring/envelope";
export type { IndexedDbWrappingKeyKeystoreOptions } from "./localKeyring/indexedDbKeystore";
export { createIndexedDbWrappingKeyKeystore } from "./localKeyring/indexedDbKeystore";
export type { IndexedDbLocalKeyringManifestStoreOptions } from "./localKeyring/indexedDbManifestStore";
export { createIndexedDbLocalKeyringManifestStore } from "./localKeyring/indexedDbManifestStore";
export {
  readObject,
  readString,
  readVersion1,
} from "./localKeyring/jsonReaders";
export type { LocalStorageLocalKeyringManifestStoreOptions } from "./localKeyring/localStorageManifestStore";
export { createLocalStorageLocalKeyringManifestStore } from "./localKeyring/localStorageManifestStore";
export {
  parseLocalKeyringManifest,
  serializeLocalKeyringManifest,
} from "./localKeyring/manifest";
export {
  createMemoryLocalKeyringManifestStore,
  createMemoryWrappingKeyKeystore,
} from "./localKeyring/memory";
export { assertNonEmptyString, copyBytes } from "./localKeyring/primitives";
export {
  canonicalLocalSecretContext,
  localKeyringScopeKey,
  normalizeLocalKeyringScope,
} from "./localKeyring/scope";
export { createLocalKeyring } from "./localKeyring/service";
export {
  decodeLocalKeyringSqliteKey,
  encodeLocalKeyringSqliteKey,
} from "./localKeyring/sqliteKey";
export type {
  LocalKeyPurpose,
  LocalKeyring,
  LocalKeyringManifest,
  LocalKeyringManifestFormat,
  LocalKeyringManifestStorage,
  LocalKeyringManifestStore,
  LocalKeyringOptions,
  LocalKeyringScope,
  LocalKeyringSession,
  LocalSecretContext,
  NormalizedLocalKeyringScope,
  UnwrapLocalSecretInput,
  WrapLocalSecretInput,
  WrappedLocalSecretEnvelope,
  WrappedLocalSecretFormat,
  WrappingKeyHandle,
  WrappingKeyKeystore,
  WrappingKeyMaterialStorage,
} from "./localKeyring/types";
export {
  LOCAL_KEYRING_MANIFEST_FORMAT,
  WRAPPED_LOCAL_SECRET_FORMAT,
} from "./localKeyring/types";
