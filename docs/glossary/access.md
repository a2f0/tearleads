# Glossary: Access And Authorization

Part of the [glossary](../glossary.md).

## Access Epoch

The monotonically advancing epoch of an [access manifest](#access-manifest) or
encrypted [content key](./keys.md#content-key). Document updates are
epoch-bound: clients decrypt an update only with the document key material for
the update's epoch.

Related docs:

- [document-rekey-and-audit-history.md](../document-rekey-and-audit-history.md)
- [keying-design.md](../keying-design.md)

## Access Event

A signed mutation statement for an access-relevant change, such as
`container.grant`, `document.link`, or `attachment.bind`. The event commits to
the object, previous manifest, dependency manifests, event body hash, signer
identity, timestamp, and signature.

Related docs:

- [access-plane.md](../access-plane.md)
- [keying-design.md](../keying-design/access-manifests.md#access-event-shape)
- [protocol-specification.md](../protocol-specification/foundations.md#common-cryptographic-objects)

## Access Manifest

A canonical, client-verifiable snapshot derived from
[signed access events](#access-event). A manifest commits to object identity,
organization, epoch, predecessor, event hash, structural state,
[grants](#grant), referenced principal heads, and
[key-target hash](./keys.md#target-hash).
[Projection rows](./sync.md#projection-row) are caches of manifest state; they
are not authority.

Related docs:

- [access-plane.md](../access-plane.md)
- [keying-design.md](../keying-design/access-manifests.md#signed-access-manifests)

## Access Plane

The protocol plane that owns authorization state and key-target derivation. It
includes signed [principal policies](./principals.md#principal-policy-state),
[access manifests](#access-manifest), [container KEKs](./keys.md#container-kek),
[content-key bundles](./keys.md#content-key-bundle), and
[write headers](./content.md#signed-write-header).

Related docs:

- [access-plane.md](../access-plane.md)
- [api-architecture.md](../api-architecture.md#protocol-planes)

## Authorizing Container Path

A verified chain of container manifest heads from an access root toward a
target container. The path proves that a user has read, write, or admin access
through signed container state rather than through a server-authored ACL row.

Related docs:

- [access-plane.md](../access-plane.md#containers)
- [protocol-specification.md](../protocol-specification/container-access.md#document-link-and-sync-protocol)

## Container

The tree-structured object where access control is applied. A container carries
[direct grants](#grant), parent linkage, a metadata document id, and a current
[container KEK](./keys.md#container-kek) epoch. Documents appear under
containers through [document link-set manifests](#document-link-set-manifest); a
document may be linked to more than one container in the same [organization](./principals.md#organization).

Related docs:

- [access-plane.md](../access-plane.md#containers)
- [container-dek-onboarding.md](../container-dek-onboarding.md#containers)
- [keying-design.md](../keying-design/access-manifests.md#container-access-manifests)

## Document Link-Set Manifest

The [access manifest](#access-manifest) for a document's linked container set.
It names the [containers](#container) that project the document into navigation
and access decisions, and it is advanced by signed `document.link` and
`document.unlink` events.

Related docs:

- [keying-design.md](../keying-design/access-manifests.md#document-link-set-manifests)
- [protocol-specification.md](../protocol-specification/container-access.md#document-link-and-sync-protocol)

## Effective Access

The access level derived by walking the relevant signed manifest graph, such as
the [root-to-target container path](#authorizing-container-path) and referenced
[managed-principal policy heads](./principals.md#principal-policy-state).
Effective access is computed from verifiable state, not trusted from a single
[mutable projection row](./sync.md#projection-row).

Related docs:

- [access-plane.md](../access-plane.md#containers)
- [keying-design.md](../keying-design/access-manifests.md#authorization-rules)

## Fail Closed

The rule that missing, stale, malformed, or inconsistent policy and key
material causes rejection instead of fallback to a weaker authorization path.
Unavailable verification material is an availability failure, not permission to
bypass checks.

Related docs:

- [protocol-specification.md](../protocol-specification/delete-and-failure.md#failure-semantics)
- [security-guarantees.md](../security-guarantees.md)

## Grant

A signed `read`, `write`, or `admin` [container](#container) assignment to a
user or group, inherited along container paths. Group grants require active
signed [group policy](./principals.md#principal-policy-state); [organizations](./principals.md#organization)
receive no grants and use the reserved groups instead.

Related docs:

- [access-plane.md](../access-plane.md#containers)
- [keying-design.md](../keying-design/access-manifests.md#authorization-rules)

## Root Container

The top container for an [organization](./principals.md#organization). It has no
parent container and anchors the container hierarchy used for path-based access
resolution.

Related docs:

- [container-dek-onboarding.md](../container-dek-onboarding.md#containers)
- [limits.md](../limits.md)
