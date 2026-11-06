# Client SDK: Local Keyring

Part of the [client SDK guide](../client-sdk.md).

## Local Keyring

The SDK exports [local keyring](../../glossary/keys.md#local-keyring) helpers for
host-controlled
[at-rest secrets](../../security-guarantees/properties.md#local-at-rest-key-wrapping):

```ts
import {
  createBrowserLocalKeyring,
  createLocalKeyring,
  createWebViewLocalKeyring,
} from "@tearleads/client-sdk";

const keyring = createLocalKeyring({
  keystore: platformWrappingKeyKeystore,
  manifestStore: persistedManifestStore,
});

const session = await keyring.getOrCreateSession({
  namespace: "tearleads",
  accountId: userId,
  signingFingerprint,
});
```

Browser hosts can use the built-in durable wiring:

```ts
const keyring = createBrowserLocalKeyring();
```

`createBrowserLocalKeyring()` stores both the JSON manifest and the wrapping-key
handle in IndexedDB (the manifest falls back to localStorage where IndexedDB is
unavailable); the wrapping key is a non-extractable AES-GCM `CryptoKey`.
The wrapped account-root secret and browser `CryptoKey` survive same-origin app
restarts; `keyring.deleteSession(scope)` removes both. Hosts that need custom
storage can compose `createIndexedDbWrappingKeyKeystore(...)` with an explicit
manifest store.

WKWebView-based shells that cannot structured-clone `CryptoKey` objects into
IndexedDB can use `createWebViewLocalKeyring()`. It uses the same manifest and
wrapping-key ids as `createBrowserLocalKeyring()`, but writes new wrapping keys
as raw AES-256 bytes to avoid the WebKit keychain clone path. Its records do not
interchange with the browser `CryptoKey` mode, so hosts must choose a storage
mode before creating local identity data. Raw-byte storage is weaker at rest:
keep the default `createBrowserLocalKeyring()` when `CryptoKey` cloning works.

`createPinCodeBrowserLocalKeyring({ pinCode })` enables opt-in PIN
locking.

`WrappingKeyKeystore` is the platform boundary. Browser, Electron, iOS, and
Android hosts should implement it with their keychain or secure storage
primitive. The SDK stores only a manifest containing a wrapped account-root
secret; [HKDF](../../cipher-suites.md#key-derivation) over the unwrapped account
root derives:

- `session.sqliteKey` for SQLCipher/SQLite initialization
- `session.blobStoreKey` for encrypted local blob storage
- `session.identityPersistenceKey` for persisted identity-key material
- additional 32-byte keys through `session.deriveKey(purpose)`

The manifest is explicit JSON with format
`tearleads.local-keyring.manifest`. Hosts persist it through
`LocalKeyringManifestStore`, and can serialize or parse it with
`serializeLocalKeyringManifest(...)` and `parseLocalKeyringManifest(...)`.
The wrapped root envelope uses format `tearleads.wrapped-local-secret` and
binds the wrapping context to the normalized scope plus key purpose.

Scopes are part of derivation and wrapping associated data:
`namespace` is required, while `accountId` and `signingFingerprint` are optional
isolation fields. `localKeyringScopeKey(scope)` provides the canonical storage
key when a manifest store needs a stable index.

`createMemoryWrappingKeyKeystore()` and
`createMemoryLocalKeyringManifestStore()` are process-local helpers for tests
and development, not a durable or platform-secure keychain.
The browser IndexedDB helper is durable but origin-bound: same-origin code can
ask the stored `CryptoKey` to unwrap the local secret even though it cannot
export the key bytes. Hosts needing unlock can use
`createPinCodeWrappingKeyKeystore`, passphrases, OS keychains, or secure
enclaves.

Call `session.dispose()` when done with a local keyring session; it zeroes
the session's in-memory root and derived byte keys.
Built-in keyrings implement optional `close()` for resource release; caller-held
sessions stay valid until `session.dispose()`.

Session snapshots retain `rootAcknowledgments` separately from `containerId`,
which is the selected local view. Login, registration, and organization creation
record the server root for the signing fingerprint, user, and organization. A host
restoring an encrypted session must persist and restore these acknowledgements;
passing a view container to `setContext` never establishes root authority.

Session state is explicit. `session.registerIdentity()` persists the current
identity and canonical IDs. With keys, a container, and the database ready,
registration can recover an unconfirmed response through login:

```ts
const registration = await tearleads.session.registerIdentity();
if (registration && !("status" in registration)) {
  await tearleads.session.login(registration.challenge);
} else {
  await tearleads.session.login();
}
```

Registration validates local public keys before contacting the API, then
[pins](../../glossary/principals.md#identity-pin) only the confirmed user.
`SessionRegistrationRefusal` identifies an `identity-already-bound` result with
the previously bound `userId`; no registration request is sent. Try login first.
If the environment was intentionally reset, clear local app data before
registering again. A `null` result still covers an unavailable prerequisite or
unconfirmed response. Restore missing prerequisites before retrying; login
requires the signing key.

A platform operator can suspend an account. Its login, including the automatic
renewal of an expired session, then rejects with an error named
`AccountSuspendedError` and clears the session, so the expired session's
requests stop renewing. Retrying cannot succeed until the suspension is lifted;
name the reason instead of reporting a generic failure.

`prepareNativeSubscriptionRestoreOrganization()` durably replays one fresh
restore org. Activate it, then call
`completeNativeSubscriptionRestoreOrganization(organizationId)`.
