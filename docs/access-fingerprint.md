# Access Fingerprint

An access fingerprint is a composite access view for a protected object.

In V1 there are three relevant object classes:

- container
- document
- blob

Each one has its own current `accessEpoch` and `accessFingerprint`, but
documents and blobs derive their principals from upstream links rather than
from standalone ACLs.

V1 derivation chain:

- container principal = inherited container grants
- document principal = union of linked container principals
- blob principal = union of linked document principals

It starts from the container's ACL entries, follows those ACL subject links to
users, groups, and organizations, and then expands group and organization
membership into the effective set of users who currently reach the container.

To support nested groups, the source graph includes both `group -> user`
membership and `group -> group` membership, and group expansion is transitive.

This is meant as an authorization-side composite, not a single user's crypto
key fingerprint.

> Key idea
>
> Each protected object has one active wrapped-DEK bundle for its current
> access fingerprint. When the fingerprint changes, that bundle is stale.

Operationally, the fingerprint is derived from the fully expanded access
closure plus recipient validity inputs such as account status and current
recipient key identity.

Important limitation:

The fingerprint is not itself proof that the access closure was authorized.

If the underlying ACL or group membership inputs come only from mutable API
state, a malicious or compromised API can produce a self-consistent but
unauthorized fingerprint. In zero-trust mode, the closure inputs must therefore
be signed and versioned outside the API's unilateral control.

## 1. Resolve Effective Access

This section answers: who currently reaches the container?

```mermaid
flowchart LR
  C[Container]

  A1[ACL subject = user]
  A2[ACL subject = group]
  A3[ACL subject = organization]

  U[User]
  G[Group]
  O[Organization]
  RG[Reachable groups<br/>direct + nested]
  RO[Referenced organizations]
  RU[Effective active users]

  GM[Group -> user membership]
  GGM[Group -> group membership]
  OM[Organization -> user membership]
  AS[Account status]

  C -->|has ACLs| A1
  C -->|has ACLs| A2
  C -->|has ACLs| A3

  A1 -->|direct subject| U
  A2 -->|direct subject| G
  A3 -->|direct subject| O

  G -->|seed group| RG
  RG -->|follow nested edges| GGM
  GGM -->|discover child groups| RG

  U -->|direct candidate users| RU
  O -->|directly referenced| RO
  RG -->|expand to user members| GM
  O -->|expands through| OM

  GM -->|member users| RU
  OM -->|member users| RU
  AS -->|filter inactive users| RU
```

> Note
>
> Nested groups are resolved transitively. The result is the effective active
> user set plus the contributing groups and organizations.

For containers in V1, access also inherits from ancestor containers. So the
effective ACL input for one container is the union of grants on the path from
the organization root to that container.

For documents in V1:

- load the linked containers
- resolve each linked container principal
- union those recipient sets

For blobs in V1:

- load the linked documents
- resolve each linked document principal
- union those recipient sets

## 2. Derive The Fingerprint

This section answers: does the object's current wrapped-key bundle still match
the current access closure?

```mermaid
flowchart LR
  RU[Effective active users]
  RG[Reachable groups]
  RO[Referenced organizations]
  UK[Recipient key state<br/>public key / key fingerprint]
  CAN[Canonicalize access closure<br/>stable sort + normalize]
  FP[Access Fingerprint]
  ST[Container state<br/>current access_epoch<br/>current access_fingerprint<br/>active DEK id]
  CMP{Fingerprint changed?}
  KEEP[Keep current bundle]

  RU --> CAN
  RG --> CAN
  RO --> CAN
  RU -->|lookup current keys| UK
  UK --> CAN

  CAN --> FP
  FP --> CMP
  ST --> CMP

  CMP -- no --> KEEP
```

> Callout
>
> The access fingerprint is the single cache key for the object's active
> wrapped-DEK bundle.

In zero-trust mode, the canonicalization input should include verified policy
state identifiers, not just the expanded recipient list. For example:

- object ACL entries or ACL hash
- referenced group ids plus signed versions or state hashes
- referenced organization ids plus signed versions or state hashes
- effective active users
- recipient key fingerprints

That way the fingerprint changes not only when recipients change, but also when
the signed policy state used to justify those recipients changes.

For V1, recommended canonical inputs are:

- container
  - ancestor container ids
  - grants on the ancestor path
  - effective recipient key fingerprints
- document
  - linked container ids
  - linked container fingerprints
  - effective recipient key fingerprints
- blob
  - linked document ids
  - linked document fingerprints
  - effective recipient key fingerprints

## 3. Materialize Or Invalidate The Wrapped-DEK Bundle

This section answers: when the fingerprint changes, can future writes keep the
same DEK or must they move to a new one?

```mermaid
flowchart LR
  CMP{Fingerprint changed?}
  ROTQ{Change shrinks or invalidates<br/>the recipient set?}
  KEEP[Reuse current wrapped-DEK bundle]
  REWRAP[Re-wrap current DEK<br/>for the new fingerprint]
  ROTATE[Rotate to a new DEK<br/>for future writes]
  BUNDLE[Active recipient-envelope bundle<br/>one active bundle per object fingerprint]
  ST[Object state<br/>current access_epoch<br/>current access_fingerprint<br/>active DEK id]

  CMP -- no --> KEEP
  CMP -- yes --> ROTQ

  ROTQ -- no --> REWRAP
  ROTQ -- yes --> ROTATE

  KEEP --> BUNDLE
  REWRAP --> BUNDLE
  ROTATE --> BUNDLE

  BUNDLE --> ST
```

## 4. Invalidation Rules

- Additive access changes can usually keep the current DEK and only re-wrap it for the new fingerprint.
- Removal, deactivation, or compromise should rotate to a new DEK for future writes.
- Any fingerprint change should bump the object's access epoch so stale writes can be rejected.

In V1, structure changes are also access changes:

- container re-parent
- document linked into or removed from a container
- blob attached to or detached from a document

These operations are not "just navigation." They can change the effective
recipient set and should therefore participate in the same fingerprint, epoch,
and rewrap-or-rotate logic.

In this model, the access fingerprint answers:

- which users have effective access right now
- which groups and organizations contributed to that access
- which upstream containers or documents contributed to that access
- which nested groups were reached transitively from an ACL-linked group
- whether the object's current wrapped-DEK bundle is still valid
- whether the next bundle can reuse the current DEK or must rotate to a new one

In zero-trust mode it should additionally answer:

- which signed group or organization states justified that access
- whether the API is presenting policy state that matches trusted signatures
