# Cipher Suites

This document summarizes the cryptographic primitives used by Tearleads and
where each is applied. It is a reference map, not a design spec — see
[keying-design.md](./keying-design.md) and
[security-guarantees.md](./security-guarantees.md) for how these fit together,
and [glossary.md](./glossary.md) for terminology.

Public-key operations in the application E2EE / keying protocol are post-quantum
only (NIST FIPS 203 / 204): no X25519, Ed25519, RSA, ECDH, or NaCl. This scope is
the client and API keying path — it does not cover deployment tooling, which uses
conventional SSH host keys (Ed25519, and RSA/ECDSA in the Terraform stacks).

## Primitives

| Primitive | Standard / level | Role |
| --- | --- | --- |
| ML-KEM-1024 (Kyber) | FIPS 203, NIST L5 | Key encapsulation (wrap keys to recipients) |
| ML-DSA-87 (Dilithium) | FIPS 204, NIST L5 | Signatures |
| AES-256-GCM | WebCrypto AEAD | Application payload encryption and key wrapping |
| HKDF-SHA-256 | RFC 5869 | Per-record and per-purpose key derivation |
| PBKDF2-SHA-256 | Password KDF | PIN, passphrase, and backup key derivation |
| SHA-256 | Hash | Fingerprints, canonical hashes, integrity |
| SHA-1 | Legacy hash | Deterministic v5-style ids only (non-security) |
| HMAC-SHA-256 | MAC | Deterministic slot ids, Stripe webhook verification |
| BIP39 (24-word) | 256-bit mnemonic | Identity seed phrase |
| ChaCha20 | SQLite3MultipleCiphers | At-rest database file encryption (active codec) |

## Where each is used

### ML-KEM-1024 (key encapsulation)

| Use | Location |
| --- | --- |
| KEM envelope primitive: encapsulate, then AES-GCM-wrap a DEK to a recipient key | `packages/crypto/src/encapsulation/{wrapDek,unwrapDek,decryptAsRecipient}.ts` |
| Wrap container KEK to a user or managed principal | `packages/client-sdk/src/data/containers/shared/projection.ts` |
| Wrap principal (group/org) secret keys to members | `packages/client-sdk/src/workflows/organizations/{principalPolicy*,groupPolicy*}.ts` |
| Identity key-package probe envelope | `packages/client-sdk/src/client/identityKeyPackage.ts` |
| Identity keypair generation | `packages/crypto/src/encapsulation/generateKeyPair.ts` |

Container-KEK-to-principal wrap suite: `tearleads.container-kek-wrap.ml-kem-1024-aes-256-gcm`.
Document and blob content keys are not ML-KEM-wrapped directly to recipients —
they wrap to container KEKs with AES-GCM (see below), and only the KEK is
ML-KEM-wrapped out to users and principals.

### ML-DSA-87 (signatures)

| Use | Location |
| --- | --- |
| Sign principal (group/org) policy state | `packages/crypto/src/principalState.ts` |
| Sign document/blob write headers | `packages/crypto/src/keying/writeHeader.ts` |
| Sign access events (grant, revoke, link, bind, ...) | `packages/crypto/src/keying/accessEvent.ts` |
| Sign transparency tree heads | `packages/crypto/src/keying/transparency.ts` |
| Sign auth challenges | `packages/crypto/src/challenge.ts` |
| Sign / verify primitives | `packages/crypto/src/signing/{sign,verify}.ts` |

### AES-256-GCM (symmetric)

| Use | Suite / location |
| --- | --- |
| Document & blob content records (per-record HKDF key) | `aes-256-gcm-hkdf-sha256-record-key` — `packages/client-sdk/src/data/documents/shared/crypto.ts`, `.../blob/shared/chunkedBlobCrypto.ts` |
| Wrap content key to container KEK | `tearleads.{document,blob}.content-key-wrap.aes-256-gcm-container-kek` — `.../shared/projectionContentKeys.ts`, `.../blob/shared/projection.ts` |
| Wrap container KEK to parent KEK | `tearleads.container-kek-wrap.aes-256-gcm-parent-kek` — `.../containers/shared/projection.ts` |
| Wrap predecessor container KEK to successor KEK | `tearleads.container-kek-wrap.aes-256-gcm-predecessor-kek` — `packages/crypto/src/keying/containerKekPredecessor.ts`; suite and version are persisted per bridge row so a future suite rotation is representable |
| Seal container KEK history keyring under current KEK | `tearleads.container-kek-keyring.aes-256-gcm-current-kek` — `packages/crypto/src/keying/containerKekKeyring.ts`; fixed-width plaintext (8-byte header + 64 bytes per predecessor epoch) makes the sealed length an equality in the epoch number |
| DEK wrapping under a KEM shared secret | `packages/crypto/src/encapsulation/wrapDek.ts` |
| Local keyring root-key wrapping (`account-root` envelope) | `packages/client-sdk/src/client/localKeyring/aesGcmWrapping.ts` |
| Local identity package at rest | `packages/app/src/providers/identity/localIdentityPackageCrypto.ts` |
| Local OPFS blob store at rest (authenticated 5 MiB chunks) | `packages/client-sdk/src/data/blobs/encryptedBlobStore.ts`, `.../encryptedBlobByteSource.ts` |

Core helpers: `packages/crypto/src/symmetric.ts` (32-byte key, 12-byte IV,
16-byte tag).

Note: the principal policy payload carries a `cipherSuite: "aes-256-gcm"` label
(`packages/crypto/src/principalStateTypes.ts`), but the current
`payloadCiphertextForProjection` in
`packages/client-sdk/src/workflows/organizations/principalPolicyRequest.ts`
base64-encodes the projection JSON rather than encrypting it — the projection is
server-visible today, so treat that suite label as reserved, not yet applied.

### Key derivation

| KDF | Use | Location |
| --- | --- | --- |
| HKDF-SHA-256 | Identity signing/KEM seeds from BIP39 entropy | `packages/crypto/src/identitySeedPhrase.ts` |
| HKDF-SHA-256 | Per-purpose local keys (sqlite, blob-store, identity-persistence) from the random root | `packages/client-sdk/src/client/localKeyring/rootKey.ts` |
| HKDF-SHA-256 | Per-content-record AES-GCM keys | `.../documents/shared/crypto.ts`, `.../blob/shared/blobRecordCrypto.ts` |
| PBKDF2-SHA-256 | PIN-code wrapping key (310k iters) | `packages/client-sdk/src/client/localKeyringPinCodeSupport.ts` |
| PBKDF2-SHA-256 | Local blob-store key from passphrase (310k iters) | `packages/client-sdk/src/data/blobs/encryptedBlobStore.ts` |
| PBKDF2-SHA-256 | Password-protected local DB backup key (250k iters) | `packages/app/src/providers/db/localBackupFormat.ts` |

PIN-code wrap suite: `pin-code-pbkdf2-sha256-aes-256-gcm`.

### Hashing / MAC

| Primitive | Use | Location |
| --- | --- | --- |
| SHA-256 | Public-key fingerprints, canonical keying hashes | `packages/crypto/src/{fingerprint,keying/canonical}.ts` |
| SHA-256 | Streamed blob ciphertext integrity | `packages/crypto/src/incrementalSha256.ts`, `packages/api/src/utils/sha256.ts` |
| SHA-256 + `timingSafeEqual` | RevenueCat webhook shared-secret compare (constant-time, not HMAC) | `packages/api/src/routes/billing/revenuecatWebhook.ts` |
| SHA-1 | Deterministic v5-style document / child-container ids (non-security) | `packages/client-sdk/src/data/stableUuid.ts` |
| HMAC-SHA-256 | Deterministic container system-slot ids | `packages/client-sdk/src/workflows/container-contents/systemSlot.ts` |
| HMAC-SHA-256 | Stripe webhook signature verification | `packages/api/src/billing/stripeWebhook.ts` |

### At-rest database

| Primitive | Use | Location |
| --- | --- | --- |
| ChaCha20 (active) | SQLite file encryption; the app always boots with `cipher: "chacha20"` | `packages/app/src/providers/db/bootSQLiteRuntime.ts` |
| SQLCipher / AES-CBC / Ascon-128 (supported, unused) | Alternate codecs the lower-level worker API accepts but the app does not select | `packages/sqlite-worker/src/{types,loadSqlite3}.ts` |

The SQLite cipher key is an HKDF-derived key from the local keyring (`sqliteKey`).

### OPFS local storage

OPFS (the Origin Private File System) is a browser storage backend, not a
cipher suite. Tearleads encrypts the data it writes there; OPFS itself does not
provide an additional application-managed encryption layer.

| OPFS data | Protection | Location |
| --- | --- | --- |
| SQLite database | SQLite3MultipleCiphers with the active ChaCha20 codec; its key is the HKDF-derived `sqlite` local-keyring key | `packages/app/src/providers/db/bootSQLiteRuntime.ts`, `packages/client-sdk/src/client/localKeyring/session.ts` |
| Blob files | Encrypted-blob-store v2: AES-256-GCM in authenticated 5 MiB chunks, with the namespace, storage key, chunk index, and serialized envelope bound as additional authenticated data | `packages/client-sdk/src/data/blobs/{encryptedBlobStore,encryptedBlobEnvelope,encryptedBlobByteSource}.ts` |

Each encrypted blob has a fresh 96-bit base IV. Chunk IVs are derived from that
base IV and the chunk index, and each ciphertext chunk includes the 16-byte
GCM authentication tag. The persisted envelope records the format, version,
chunk shape, base IV, and (when a string passphrase is used) a
PBKDF2-SHA-256 salt and iteration count. Raw 32-byte/AES-GCM keys, including
the production local-keyring-derived blob key, do not use this PBKDF2 envelope.

On supported platforms, SQLite uses the OPFS SyncAccessHandle Pool VFS and
blob files are placed under an identity-namespaced `tearleads` OPFS directory.
The app requests durable browser storage before the first persistent database
write; this is best effort, so a browser can still deny it. Without OPFS the
automatic storage policy selects in-memory SQLite; an explicitly requested
persistent SQLite backend hard-fails instead. Encrypted OPFS blob-store
factories likewise fail closed rather than silently writing unencrypted files
elsewhere.

## Libraries

| Library | Provides |
| --- | --- |
| `@noble/post-quantum` | ML-KEM-1024, ML-DSA-87 |
| `@noble/hashes` | SHA-256, HKDF |
| `@scure/bip39` | 24-word mnemonic seed phrases |
| WebCrypto (`crypto.subtle`) | AES-GCM, HKDF, PBKDF2, HMAC, SHA-256, SHA-1 (client runtime) |
| `node:crypto` | SHA-256, HMAC, `timingSafeEqual` (server / billing only) |
| SQLite3MultipleCiphers | At-rest database encryption codec |
