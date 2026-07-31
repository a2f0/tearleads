# Keying Onboarding

## Summary

User registration provisions the full identity and access bootstrap in a single
request. The client generates cryptographic material locally, the server creates
the relational structure atomically, and the client persists the result to local
SQLite.

For shared protocol terminology, see [glossary.md](./glossary.md).

The key hierarchy is:

- containers have signed access manifests and KEK epochs
- document content keys wrap to current linked container KEK targets
- blob content keys wrap to KEK targets derived from active bindings

After registration, every user has:

- a default organization
- reserved `Admins` and `Members` groups for that organization
- a root container for that organization
- a signed root container manifest and container KEK wrap
- an initialized root metadata document with content-key targets
- reserved roster and organization-profile containers, encrypted initial profile
  documents, and persisted local container metadata in SQLite

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
2. Create the initial reserved `Admins` group policy.
3. Create the initial reserved `Members` group policy, nesting `Admins` as a
 direct group member.
4. Create the initial organization policy and member envelope. The
 organization policy is cryptographic principal state, not the org-manager
 product role source.
5. Create the initial root metadata Loro update locally.
6. Create the initial roster and organization-profile container metadata and
 encrypted profile document material.
7. Build and sign the root container create request, including the initial
 container KEK epoch and wrap for the registering user.
8. Build and sign the root metadata document create request, wrapping its
 content key to the root container KEK target.
9. Send all material in a single `POST /auth/register`.

### Server Side (atomic transaction)

The register endpoint creates the identity, organization, root container,
signed root access manifest, and root metadata document rows in one
transaction:

1. Insert organization (name: `"Personal"`) with `admin_group_id` and
 `member_group_id`.
2. Insert container (`organization_id = org.id`, `parent_id = NULL`).
3. Insert user (`default_organization_id = org.id`).
4. Insert the reserved `Admins` and `Members` group rows.
5. Store the initial `Admins`, `Members`, and organization policies.
6. Verify and store the root container manifest and KEK state.
7. Verify and store the root metadata document manifest, content-key
 targets, and initial encrypted update.
8. Verify and store the roster and organization-profile containers, their
 metadata documents, and the encrypted initial profile updates.

If the user's fingerprint already exists, the transaction rolls back and the
endpoint returns 409.

### Client Side (after response)

The response includes `userId`, `organizationId`, `rootContainerId`,
`rootMetadataDocumentId`, `rootMetadataAccessEpoch`,
`rootMetadataAccessStateHash`, optional roster-profile bootstrap responses, and
`challenge`.

1. Set `userId`, `organizationId`, and `rootContainerId` in session state.
2. Persist the root and profile containers, their initialized document states,
 and the initial principal policy bundles to local SQLite.
3. Authenticate using the challenge.

The root metadata content key is recovered through the document content-key
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
interface RegistrationRequest {
 userId: string;
 organizationId: string;
 rootContainerId: string;
 signingPublicKey: number[];
 encapsulationPublicKey: number[];
 initialAdminGroup: CreateOrganizationGroupRequest;
 initialMemberGroup: CreateOrganizationGroupRequest;
 initialOrganizationPolicy: InitialOrganizationPolicyRequest;
 initialRootContainer: ContainerMutationRequest;
 initialRootMetadataDocument: DocumentCreateRequest;
 initialRosterProfileContainer?: ContainerCreateWithMetadataDocumentRequest;
 initialRosterProfileDocument?: DocumentCreateRequest;
}
```

`initialAdminGroup.name` must be `"Admins"` and its first policy projects the
registering user as the sole admin. `initialMemberGroup.name` must be
`"Members"` and its first policy projects the registering user as admin plus
the `Admins` group as a member. This makes every admin reachable as an
organization member while preserving a distinct org-admin authority group.

### `POST /auth/register` response

```ts
interface RegistrationResponse {
 userId: string;
 organizationId: string;
 rootContainerId: string;
 rootMetadataDocumentId: string;
 rootMetadataAccessEpoch: number;
 rootMetadataAccessStateHash: string;
 rootMetadataDocument: DocumentCreateResponse;
 rosterProfileContainer?: ContainerCreateWithMetadataDocumentResponse;
 rosterProfileContainerId?: string;
 rosterProfileDocument?: DocumentCreateResponse;
 rosterProfileDocumentId?: string;
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
 system_slot TEXT,
 depth INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMP NOT NULL DEFAULT now(),
 updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX containers_org_root_idx
 ON containers (organization_id) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX containers_org_system_slot_idx
 ON containers (organization_id, system_slot) WHERE system_slot IS NOT NULL;
```

### Server: `users.default_organization_id`

```sql
CREATE TABLE IF NOT EXISTS users (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 fingerprint TEXT NOT NULL,
 signing_public_key TEXT NOT NULL,
 encapsulation_public_key TEXT NOT NULL,
 encapsulation_key_fingerprint TEXT NOT NULL,
 default_organization_id UUID NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT now(),
 CONSTRAINT users_fingerprint_unique UNIQUE (fingerprint)
);
```

`users_fingerprint_unique` is the auth lookup path for
`verifyChallenge(fingerprint, signature)`: PostgreSQL backs the unique
constraint with a btree index, so each challenge verification can load the
canonical signing key by fingerprint without scanning `users`.

### Server: `organizations`

```sql
CREATE TABLE IF NOT EXISTS organizations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 admin_group_id UUID NOT NULL,
 member_group_id UUID NOT NULL,
 name TEXT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT now()
);
```

`admin_group_id` points to the reserved `Admins` group. Reachability through
that group is organization-admin authority. `member_group_id` points to the
reserved opaque `Members` group. Reachability through that group is
organization membership. Org-manager stores directory lifecycle in
`organization_roster_entries`; active roster rows are synchronized from
`Members` reachability, while disabled rows can remain visible after access
removal.

### Local SQLite: `containers`

```sql
CREATE TABLE containers (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL,
 parent_id TEXT,
 metadata_document_id TEXT,
 system_slot TEXT,
 local_created_at TEXT NOT NULL,
 local_updated_at TEXT NOT NULL,
 server_created_at TEXT,
 server_updated_at TEXT
);
```

Container display fields live in the sibling `container_projection` table.
Container metadata document state is stored in the shared `documents` table
under the container-metadata app kind.

### Product Contact Projection

```sql
CREATE TABLE contact_projection (
 local_id TEXT PRIMARY KEY,
 document_id TEXT,
 container_id TEXT,
 first_name TEXT NOT NULL DEFAULT '',
 last_name TEXT NOT NULL DEFAULT '',
 nickname TEXT NOT NULL DEFAULT '',
 user_id TEXT,
 encapsulation_public_key TEXT,
 is_self INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX contact_projection_self_idx
 ON contact_projection (is_self) WHERE is_self = 1;
CREATE UNIQUE INDEX contact_projection_user_idx
 ON contact_projection (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX contact_projection_container_idx
 ON contact_projection (container_id);
```

Contacts are product document types. The product contact projection is a local
read model derived from decrypted contact documents, not an SDK platform table.

## Adding Users To An Organization

Adding a user to an organization means updating the reserved `Members` group
policy. If the user should administer the organization, update the reserved
`Admins` group policy as well. Those group policies are signed principal
states, so access remains a projection of tamper-resistant group membership.
The roster row is product lifecycle state only.

1. Org admin publishes a signed `Members` or `Admins` group policy update and
 derived projection.
2. Principal member envelopes wrap the group key to the new member.
3. The API synchronizes active roster rows from `Members` reachability.
4. Container grants update signed container access manifests when the user or
 group also needs object access.
5. Additive container access can add container KEK wraps for the new principal
 without rewriting descendant document/blob content-key targets.
6. Document/blob writes continue to target current container KEK epochs.

Disabling a user removes access through signed group/grant mutations and leaves
the roster entry with `status = disabled`. Encrypted org-specific profile fields
such as first name, last name, email, and title belong in a Loro document named
by `profile_document_id`, not in server-visible roster columns.

Subtractive access changes create new container KEK epochs for future writes.
They do not claim retroactive secrecy for ciphertext and keys already
distributed before the shrink. Each new epoch includes an authenticated bridge
to its immediate predecessor. A user with current access can therefore decrypt
the retained document history by starting from the current recipient wrap;
adding that user does not require old user/principal envelopes or a rebaseline.

For the broader hierarchy direction, see:

- `docs/access-plane.md`
- `docs/loro-e2ee-sync-protocol.md`
