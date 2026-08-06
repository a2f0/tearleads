/**
 * Public seam for the on-device local keyring: a wrapped account-root secret in
 * a manifest, HKDF-derived per-purpose keys, and the pluggable
 * {@link WrappingKeyKeystore} / {@link LocalKeyringManifestStore} backends the
 * host platform supplies. Implementation lives in `./localKeyring/`; callers
 * (including `./localKeyringPinCode`) import from here.
 */
export type { BrowserLocalKeyringOptions } from "./browser";
export {
  createBrowserLocalKeyring,
  createBrowserLocalKeyringManifestStore,
  createWebViewLocalKeyring,
  resolveBrowserLocalKeyringManifestStore,
} from "./browser";
export {
  assertEnvelopeContextMatches,
  assertWrappedLocalSecretEnvelope,
  readWrappedLocalSecretEnvelope,
} from "./envelope";
export type { IndexedDbWrappingKeyKeystoreOptions } from "./indexedDbKeystore";
export { createIndexedDbWrappingKeyKeystore } from "./indexedDbKeystore";
export type { IndexedDbLocalKeyringManifestStoreOptions } from "./indexedDbManifestStore";
export { createIndexedDbLocalKeyringManifestStore } from "./indexedDbManifestStore";
export {
  readObject,
  readString,
  readVersion1,
} from "./jsonReaders";
export type { LocalStorageLocalKeyringManifestStoreOptions } from "./localStorageManifestStore";
export { createLocalStorageLocalKeyringManifestStore } from "./localStorageManifestStore";
export {
  parseLocalKeyringManifest,
  serializeLocalKeyringManifest,
} from "./manifest";
export {
  createMemoryLocalKeyringManifestStore,
  createMemoryWrappingKeyKeystore,
} from "./memory";
export { assertNonEmptyString, copyBytes } from "./primitives";
export {
  canonicalLocalSecretContext,
  localKeyringScopeKey,
  normalizeLocalKeyringScope,
} from "./scope";
export { createLocalKeyring } from "./service";
export {
  decodeLocalKeyringSqliteKey,
  encodeLocalKeyringSqliteKey,
} from "./sqliteKey";
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
} from "./types";
export {
  LOCAL_KEYRING_MANIFEST_FORMAT,
  WRAPPED_LOCAL_SECRET_FORMAT,
} from "./types";
