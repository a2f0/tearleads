# Keying V2 Onboarding

## Summary

User registration provisions the full identity and access bootstrap in a single
request. The client generates cryptographic material locally, the server creates
the relational structure atomically, and the client persists the result to local
SQLite.

The key hierarchy is:

- containers have signed access manifests and KEK epochs
- document content keys wrap to current linked container KEK targets
- blob content keys wrap to KEK targets derived from active bindings

After registration, every user has:

- a default organization
- a root container for that organization
- a signed V2 root container manifest and container KEK wrap
- an initialized V2 root metadata document with content-key targets
- a local "me" contact and persisted root container in SQLite

The server never sees plaintext container KEKs or document/blob content keys.

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
2. Create the initial organization policy and member envelope.
3. Create the initial root metadata Loro update locally.
4. Build and sign the V2 root container create request, including the initial
   container KEK epoch and wrap for the registering user.
5. Build and sign the V2 root metadata document create request, wrapping its
   content key to the root container KEK target.
6. Send all material in a single `POST /auth/register`.

### Server Side (atomic transaction)

The register endpoint creates the identity, organization, root container,
signed root access manifest, and root metadata document rows in one
transaction:

1. Insert organization (name: `"Personal"`).
2. Insert container (`organization_id = org.id`, `parent_id = NULL`).
3. Insert user (`default_organization_id = org.id`).
4. Store the initial organization policy.
5. Verify and store the V2 root container manifest and KEK state.
6. Verify and store the V2 root metadata document manifest, content-key
   targets, and initial encrypted update.

If the user's fingerprint already exists, the transaction rolls back and the
endpoint returns 409.

### Client Side (after response)

The response includes `userId`, `organizationId`, `rootContainerId`,
`rootMetadataDocumentId`, `rootMetadataAccessEpoch`,
`rootMetadataAccessStateHash`, and `challenge`.

1. Set `userId`, `organizationId`, and `rootContainerId` in session state.
2. Persist the root container and root metadata document state to local SQLite.
3. Persist a "me" contact in `address_book_projection` with `is_self = 1`.
4. Authenticate using the challenge.

The root metadata content key is recovered through the V2 document content-key
target bundle and root container KEK state.

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
  userId: string;
  organizationId: string;
  rootContainerId: string;
  signingPublicKey: number[];
  encapsulationPublicKey: number[];
  initialOrganizationPolicy: InitialOrganizationPolicyRequest;
  initialRootContainerV2: ContainerV2MutationRequest;
  initialRootMetadataDocumentV2: DocumentV2CreateRequest;
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
  rootMetadataAccessStateHash: string;
  rootMetadataDocumentV2: DocumentV2CreateResponse;
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

Adding a user to an organization means they may need access to signed principal
state and selected container KEK epochs:

1. Org admin publishes a signed principal state update and derived projection.
2. Principal member envelopes wrap the organization/group key to the new
   member.
3. Container grants update signed container access manifests.
4. Additive container access can add container KEK wraps for the new principal
   without rewriting descendant document/blob content-key targets.
5. Document/blob writes continue to target current container KEK epochs.

Subtractive access changes create new container KEK epochs for future writes.
They do not claim retroactive secrecy for ciphertext and keys already
distributed before the shrink.

For the broader hierarchy direction, see:

- `docs/access-plane.md`
- `docs/loro-e2ee-sync-protocol.md`
