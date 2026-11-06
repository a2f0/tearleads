# Keying Design

This document describes the access and key-delivery model: signed
[access manifests](./glossary/access.md#access-manifest), the
[container KEK](./glossary/keys.md#container-kek) hierarchy that delivers document
and blob keys, local-first container creation, and how the protocol treats
unauthorized [grants](./glossary/access.md#grant), rollback, split views, and
first-contact identity keys (see
[security-guarantees.md](./security-guarantees.md)).

HTTP routes use the signed mutation surface summarized in
[api-architecture.md](./api-architecture.md#http-protocol-surface). For shared
protocol terminology, see [glossary.md](./glossary.md).

The signed [access-event](./glossary/access.md#access-event), access-manifest,
container KEK, document content-key, blob content-key,
[principal-policy](./glossary/principals.md#principal-policy-state),
[write-header](./glossary/content.md#signed-write-header), and local
[checkpoint](./glossary/sync.md#checkpoint) primitives define the executable keying
boundary. Transparency deployment,
[first-contact identity trust](./developer/trusted-user-identity.md), verifier
use at every client encryption decision, and historical replay are separate
deployment boundaries.

## Contents

- [Overview](./keying-design/overview.md)
  - [Design Properties](./keying-design/overview.md#design-properties)
  - [Boundaries](./keying-design/overview.md#boundaries)
  - [Core Design](./keying-design/overview.md#core-design)
  - [Threat Model](./keying-design/overview.md#threat-model)
  - [Identity And Principal Policy](./keying-design/overview.md#identity-and-principal-policy)
- [Access manifests](./keying-design/access-manifests.md)
  - [Signed Access Manifests](./keying-design/access-manifests.md#signed-access-manifests)
  - [Authorization Rules](./keying-design/access-manifests.md#authorization-rules)
- [Container KEKs](./keying-design/container-keks.md)
  - [Container KEK Hierarchy](./keying-design/container-keks.md#container-kek-hierarchy)
  - [Additive Versus Subtractive Changes](./keying-design/container-keks.md#additive-versus-subtractive-changes)
- [Content keys](./keying-design/content-keys.md)
  - [Document Content Keys](./keying-design/content-keys.md#document-content-keys)
  - [Blob Content Keys](./keying-design/content-keys.md#blob-content-keys)
  - [Local-First Create Intents](./keying-design/content-keys.md#local-first-create-intents)
- [Verification](./keying-design/verification.md)
  - [Transparency And Checkpointing](./keying-design/verification.md#transparency-and-checkpointing)
  - [Client Verification API](./keying-design/verification.md#client-verification-api)
  - [Programmable Proof Obligations](./keying-design/verification.md#programmable-proof-obligations)
  - [API Attack Outcomes](./keying-design/verification.md#api-attack-outcomes)
- [Storage and scaling](./keying-design/storage-and-scaling.md)
  - [Storage State](./keying-design/storage-and-scaling.md#storage-state)
  - [Scaling Model](./keying-design/storage-and-scaling.md#scaling-model)
  - [Protocol Surface](./keying-design/storage-and-scaling.md#protocol-surface)
  - [Required Invariants](./keying-design/storage-and-scaling.md#required-invariants)
