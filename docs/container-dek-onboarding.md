# Container DEK Onboarding

## Summary

User registration provisions the full identity and access bootstrap in a single
request. The client generates cryptographic material locally, the server creates
the relational structure atomically, and the client persists the result to local
SQLite.

This document describes the bootstrap step for the root container only. It does
not mean every encrypted payload in the system should use the container DEK
directly. The key hierarchy is:

- containers have their own access state and wrapped key bundles
- documents derive access from linked containers and use document DEKs
- blobs derive access from linked documents and use blob DEKs

After registration, every user has:

- a default organization
- a root container for that organization
- a DEK for the root container, wrapped for the user's own encapsulation key
- an access grant, epoch, and recipient envelope for the container
- an initialized root metadata document with its own document-DEK bundle
- a local "me" contact and persisted root container in SQLite

The server never sees the plaintext DEK.

## Containers

Containers are plain relational data, not Loro documents. They form a tree of
folders where each container has exactly one parent, except the root container
for an organization which has `parent_id = NULL`.

Documents can appear in multiple containers but only within a single
organization. The organization owns the data and governs the access plane.

Root containers are identified by convention rather than a foreign key on the
organization table. A partial unique index enforces at most one root per
organization:

```sql
CREATE UNIQUE INDEX containers_org_root_idx
  ON containers (organization_id) WHERE parent_id IS NULL;
```

This avoids a circular foreign key between organizations and containers.

## Registration Flow

### Client Side (before request)

1. Generate signing and encapsulation key pairs (already existed).
2. Generate a 32-byte DEK: `crypto.getRandomValues(new Uint8Array(32))`.
3. Wrap the DEK for self using `wrapDekForRecipients(dek, [encapsulationPublicKey])`.
4. Create the initial root metadata Loro update locally.
5. Generate a root-metadata document DEK and wrap it for self.
6. Encrypt the initial root metadata update with that document DEK.
7. Send all material in a single `POST /auth/register`.

### Server Side (atomic transaction)

The register endpoint creates the identity, organization, root container, root
container access, and root metadata document rows in one transaction:

1. Insert organization (name: `"Personal"`).
2. Insert container (`organization_id = org.id`, `parent_id = NULL`).
3. Insert user (`default_organization_id = org.id`).
4. Insert organization member (`role: "owner"`).
5. Insert object access grant (`objectType: "container"`, `accessLevel: "admin"`).
6. Insert object access epoch (`epoch: 1`).
7. Insert object recipient envelope (`epoch: 1`, with `kem_cipher_text` and
   `wrapped_key` from the client).
8. Insert root metadata document/link/bundle/update rows.

If the user's fingerprint already exists, the transaction rolls back and the
endpoint returns 409.

### Client Side (after response)

The response includes `userId`, `organizationId`, `rootContainerId`,
`rootMetadataDocumentId`, `rootMetadataAccessEpoch`,
`rootMetadataRecipientEncapsulationPublicKeys`, and `challenge`.

1. Set `userId`, `organizationId`, and `rootContainerId` in session state.
2. Persist the root container and root metadata document state to local SQLite.
3. Persist a "me" contact in `address_book_projection` with `is_self = 1`.
4. Authenticate using the challenge.

The plaintext DEK remains in memory for immediate use. It is not persisted to
SQLite. Future access to the DEK requires unwrapping from the recipient envelope
via `unwrapDek`.

## Crypto Functions

### `wrapDekForRecipients`

Wraps an existing DEK for one or more recipients without encrypting a payload.

```ts
async function wrapDekForRecipients(
  dek: Uint8Array,
  recipientPublicKeys: Uint8Array[],
): Promise<RecipientEntry[]>
```

Each `RecipientEntry` contains:

- `keyFingerprint`: SHA-256 hex of the recipient's public key.
- `kemCipherText`: ML-KEM-1024 ciphertext (~1568 bytes).
- `wrappedKey`: AES-256-GCM encrypted DEK (~48 bytes).

The wrapping IV is derived from `kemCipherText.slice(0, 12)`, matching the
convention used by `encryptForRecipients`.

`encryptForRecipients` delegates to `wrapDekForRecipients` internally for
the key wrapping step.

### `unwrapDek`

Recovers a DEK from a set of recipient entries using a secret key.

```ts
async function unwrapDek(
  recipients: RecipientEntry[],
  secretKey: Uint8Array,
): Promise<Uint8Array>
```

Finds the matching entry by key fingerprint, decapsulates the shared secret via
ML-KEM-1024, and decrypts the wrapped key via AES-256-GCM.

## Request And Response Shapes

### `POST /auth/register` request

```ts
interface PublicKeyRequest {
  rootContainerId: string;
  signingPublicKey: number[];
  encapsulationPublicKey: number[];
  wrappedDekEnvelope: {
    keyFingerprint: string;
    kemCipherText: number[];
    wrappedKey: number[];
  };
  initialRootMetadataRecipientEnvelopes?: SerializedRecipientEnvelope[];
  initialRootMetadataUpdates: SyncDocumentOutgoingUpdate[];
}
```

### `POST /auth/register` response

```ts
interface PublicKeyResponse {
  message: string;
  userId: string;
  organizationId: string;
  rootContainerId: string;
  rootMetadataDocumentId: string;
  rootMetadataAccessEpoch: number;
  rootMetadataRecipientEncapsulationPublicKeys: string[];
  challenge: string;
}
```

## Schema Excerpts

### Server: `containers`

```sql
CREATE TABLE IF NOT EXISTS containers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  parent_id UUID,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
```

### Server: `users.default_organization_id`

```sql
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint TEXT NOT NULL UNIQUE,
  signing_public_key TEXT NOT NULL,
  encapsulation_public_key TEXT NOT NULL,
  encapsulation_key_fingerprint TEXT NOT NULL,
  default_organization_id UUID NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
```

### Server: `object_recipient_envelopes`

```sql
CREATE TABLE IF NOT EXISTS object_recipient_envelopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  recipient_principal_type TEXT NOT NULL,
  recipient_principal_id TEXT NOT NULL,
  recipient_key_fingerprint TEXT NOT NULL,
  kem_cipher_text TEXT NOT NULL,
  wrapped_key TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
```

These columns store base64-encoded wrapped key material. They are required for
every object recipient envelope row; identity-only recipient-envelope rows are
not part of the current storage model.

### Local SQLite: `containers`

```sql
CREATE TABLE containers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  parent_id TEXT,
  metadata_document_id TEXT,
  updated_at TEXT NOT NULL
);
```

### Local SQLite: `address_book_projection`

```sql
CREATE TABLE address_book_projection (
  address_book_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  encapsulation_public_key TEXT NOT NULL,
  is_self INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (address_book_id, user_id)
);

CREATE UNIQUE INDEX address_book_projection_self_idx
  ON address_book_projection (address_book_id) WHERE is_self = 1;
```

The partial unique index enforces at most one self-contact per address book at
the database level.

## Adding Users To An Organization

Adding a user to an organization means they need access to the container tree
and its documents. The flow would be:

1. Org admin publishes a signed principal state update and derived projection.
2. Container DEKs are re-wrapped for the new member's encapsulation public key.
3. New recipient envelopes are stored. The access fingerprint changes and the
   epoch advances.
4. Document DEKs inside those containers are also re-wrapped for the new
   recipient set.

Whether this is eager (re-wrap everything at grant time) or lazy (re-wrap on
next write or access) remains a separate design decision. The registration flow
establishes the DEK and container primitives so that adding members later is
"more recipient envelopes for the same container DEK," not a schema redesign.

For the broader hierarchy direction, see:

- `docs/access-plane.md`
- `docs/access-fingerprint.md`
- `docs/loro-e2ee-sync-protocol.md`
