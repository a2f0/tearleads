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
- a root container for that organization, with a signed manifest and a
  container KEK wrapped to the `Admins` group
- an initialized root metadata document with content-key targets
- an organization metadata container, plus roster-profile and
  organization-profile documents and any app-provisioned system containers
- the resulting container, document, and policy state persisted to local SQLite

The server never sees plaintext container KEKs or document/blob content keys.

## Containers

Containers are plain relational data, not Loro documents. They form a tree of
folders where each container has exactly one parent, except the organization's
root container and its independent metadata root (a system-slot container),
which have `parent_id = NULL`.

Documents can appear in multiple containers but only within a single
organization. The organization owns the data and governs the access plane.

Root containers are identified by convention rather than a foreign key on the
organization table. A partial unique index enforces at most one root per
organization:

```sql
CREATE UNIQUE INDEX containers_org_root_idx
 ON containers (organization_id)
 WHERE parent_id IS NULL AND system_slot IS NULL;
```

This avoids a circular foreign key between organizations and containers.

## Registration Flow

### Client Side (before request)

1. Use the identity's ML-DSA-87 signing and ML-KEM-1024 encapsulation key
 pairs.
2. Create the initial reserved `Admins` and `Members` group policies. Each
 projects the registering user as its sole admin member, with one member
 envelope wrapping the group key to that user.
3. Create the initial organization policy and member envelope. Its authority
 descriptor binds both reserved group IDs and their initial heads. The
 organization policy is cryptographic principal state, not the org-manager
 product role source.
4. Create the initial root metadata Loro update locally.
5. Build and sign the root container create request, including the initial
 container KEK epoch wrapped to the `Admins` group.
6. Build and sign the root metadata document create request, wrapping its
 content key to the root container KEK target.
7. Build the organization metadata container, the roster-profile and
 organization-profile containers and encrypted documents, and any
 app-provisioned system containers.
8. Send all material in a single `POST /auth/register`.

### Server Side (atomic transaction)

The register endpoint creates the identity, organization, root container,
signed root access manifest, and root metadata document rows in one
transaction:

1. Insert the organization with `admin_group_id`, `member_group_id`, and
 `root_container_id`, and its initial billing row.
2. Insert the root container (`organization_id = org.id`, `parent_id = NULL`).
3. Insert the user (`default_organization_id = org.id`).
4. Insert the reserved `Admins` and `Members` group rows.
5. Store the initial `Admins`, `Members`, and organization policies and the
 initial roster.
6. Verify and store the root container manifest and KEK state, which grants
 `Admins` admin access to the root (built-in, derived from
 `root_container_id`).
7. Verify and store the root metadata document manifest, content-key
 targets, and initial encrypted update.
8. Verify and store the roster-profile, organization metadata, and system
 containers, their metadata documents, and the encrypted initial profile
 updates.

If the user's fingerprint already exists, the transaction rolls back and the
endpoint returns 409.

### Client Side (after response)

The response carries the created ids, the root metadata document's access
epoch and state hash, the organization metadata, profile, and system container
results, the committed update ids, and `challenge`.

1. Pin the registering identity once the response confirms its `userId`.
2. Persist the root, metadata, profile, and system containers, their
 initialized document states, and the initial principal policy bundles to
 local SQLite.
3. Set `userId`, `organizationId`, and `rootContainerId` in session state.
4. Authenticate using the challenge.

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
- `kemCipherText`: ML-KEM-1024 ciphertext (1568 bytes).
- `wrappedKey`: AES-256-GCM encrypted DEK (48 bytes for a 32-byte DEK).

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

The shapes below summarize the validators in
[`packages/validators/src/request/organizationProvisioning.ts`](../packages/validators/src/request/organizationProvisioning.ts)
and
[`packages/validators/src/response/organizationProvisioning.ts`](../packages/validators/src/response/organizationProvisioning.ts),
which registration shares with creating an additional organization.

### `POST /auth/register` request

```ts
interface RegistrationRequest {
 userId: string;
 organizationId: string;
 rootContainerId: string;
 signingPublicKey: number[]; // ML-DSA-87 public key bytes
 encapsulationPublicKey: number[]; // ML-KEM-1024 public key bytes
 initialAdminGroup: CreateOrganizationGroupRequest;
 initialMemberGroup: CreateOrganizationGroupRequest;
 initialOrganizationPolicy: OrganizationPrincipalPolicyRequest;
 initialRootContainer: ContainerMutationRequest;
 initialRootMetadataDocument: ProvisionedDocumentRequest;
 initialOrganizationMetadataContainer: ProvisionedSystemContainerRequest;
 initialOrganizationProfileDocument?: ProvisionedDocumentRequest;
 initialRosterProfileContainer?: ProvisionedSystemContainerRequest;
 initialRosterProfileDocument?: ProvisionedDocumentRequest;
 initialSystemContainers?: ProvisionedSystemContainerRequest[];
}
```

The API never receives a group display name. `initialAdminGroup` and
`initialMemberGroup` must be distinct groups whose metadata carries the
built-in `admins` and `members` roles. Each group's first policy, like the
organization's, must be signed by the registering user and project that user
as its sole admin member. `Admins` is not nested into `Members`.

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
 organizationMetadataContainerId: string;
 organizationMetadataContainer: ContainerCreateWithMetadataDocumentResponse;
 organizationProfileDocumentId?: string;
 organizationProfileDocument?: DocumentCreateResponse;
 rosterProfileContainerId?: string;
 rosterProfileContainer?: ContainerCreateWithMetadataDocumentResponse;
 rosterProfileDocumentId?: string;
 rosterProfileDocument?: DocumentCreateResponse;
 systemContainers: ContainerCreateWithMetadataDocumentResponse[];
 committedCoreMetadataUpdateIds: string[];
 committedProfileUpdateIds: string[];
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
 ON containers (organization_id)
 WHERE parent_id IS NULL AND system_slot IS NULL;
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

The excerpt omits operational columns such as `is_root` and `suspended_at`.
`users_fingerprint_unique` is the auth lookup path for challenge verification
(`verifyChallenge` in [`packages/api/src/services/auth/verifyChallenge.ts`](../packages/api/src/services/auth/verifyChallenge.ts)):
PostgreSQL backs the unique constraint with a btree index, so each challenge
verification can load the canonical signing key by fingerprint without
scanning `users`.

### Server: `organizations`

```sql
CREATE TABLE IF NOT EXISTS organizations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 admin_group_id UUID NOT NULL,
 member_group_id UUID NOT NULL,
 profile_document_id UUID,
 created_at TIMESTAMP NOT NULL DEFAULT now()
);
```

The organization has no server-visible name column; its name lives in the
encrypted organization profile document.

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
 display_name TEXT,
 icon TEXT,
 effective_access_level TEXT NOT NULL DEFAULT 'read',
 local_created_at TEXT NOT NULL,
 local_updated_at TEXT NOT NULL,
 server_created_at TEXT,
 server_updated_at TEXT
);
```

`display_name` and `icon` are the decrypted metadata fields lists read; a null
`display_name` presents as `/` for a root and `Untitled` otherwise. Container
metadata document state is stored in the shared `documents` table under the
container-metadata app kind.

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
distributed before the shrink. Each new epoch includes a write-once
authenticated bridge to its immediate predecessor and a keyring holding every
predecessor KEK sealed under the new key. A user with current access therefore
decrypts the retained document history from the current recipient wrap in one
keyring open; adding that user does not require old user/principal envelopes
or a rebaseline.

Related:

- [access-plane.md](./access-plane.md)
- [loro-e2ee-sync-protocol.md](./loro-e2ee-sync-protocol.md)
