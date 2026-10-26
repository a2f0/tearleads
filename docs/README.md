# Documentation

Design references describe the protocol and its guarantees; developer guides
under [`developer/`](developer/) cover implementation contracts, operations,
and repository workflow. The [glossary](glossary.md) defines shared terms.

## Orientation

- [Glossary](glossary.md): shared protocol terms.
- [Subsystems](subsystems.md): named slices of the codebase and their seams.
- [Security guarantees](security-guarantees.md): the invariants the protocol
  enforces and their stated limits.
- [Limits](limits.md): every enforced bound and what happens beyond it.

## Architecture

- [API architecture](api-architecture.md): protocol planes, HTTP surface, and
  code layers.
- [Access plane](access-plane.md): signed access events, manifests, and
  effective access.
- [Client SDK](developer/client-sdk.md): the SDK's public API and runtime.
- [SQLite setup for SDK hosts](developer/sqlite-setup.md).
- [Choosing a document creation API](developer/document-creation.md).
- [Client SDK seams](developer/client-sdk-seams.md): how SDK components meet.
- [API persistence](developer/api-persistence.md): storage backends and
  signed-shape invariants.
- [UI design system](ui-design-system.md): app chrome conventions.

## Keying and identity

- [Keying design](keying-design.md): access manifests and the container KEK
  hierarchy.
- [Cipher suites](cipher-suites.md): cryptographic primitives and where they
  apply.
- [Keying onboarding](container-dek-onboarding.md): registration's identity and
  access bootstrap.
- [Durable user identity trust](developer/trusted-user-identity.md).
- [Organization memberships](organization-memberships.md).
- [Historical policy evidence](projection-policy-evidence.md) in writer
  projections.

## Principal policy history

- [History acceptance](principal-history-acceptance.md): unbounded history with
  bounded requests.
- [Incremental verification](principal-history-pages.md) and
  [history transport](principal-history-transport.md).
- [Durable recovery](developer/principal-history-recovery.md),
  [cache retention](developer/principal-history-cache.md),
  [key envelope candidates](developer/principal-key-envelope-candidates.md),
  and [directory bindings](developer/principal-directory-bindings.md).
- [Current-policy consumers](developer/current-principal-consumers.md),
  [mutations](developer/principal-current-mutations.md),
  [sharing](developer/principal-current-sharing.md), and
  [commit outcomes](developer/principal-policy-outcomes.md).

## Documents and sync

- [Protocol specification](protocol-specification.md): messages, proofs, and
  validation rules.
- [Loro E2EE sync protocol](loro-e2ee-sync-protocol.md).
- [Document link and sync protocol](document-link-and-sync-protocol.md).
- [Document rekey and write history](document-rekey-and-audit-history.md),
  [raw history recovery](raw-document-history-recovery.md), and
  [purge verification](document-purge-verification.md).
- [Attachment retention](attachment-retention.md).
- [Client sync ordering](client-sync-ordering.md),
  [sync edge cases](sync-edge-cases.md), and
  [interruption safety](sync-interruption-safety.md).
- [Organization read-model sync](organization-read-model-sync.md) and
  [realtime hint privacy](developer/realtime-hints.md).
- [Device-first reads and writes](developer/device-first.md),
  [document links](developer/document-links.md), and
  [custom document persistence](developer/custom-document-persistence.md).
- [Request budgets](request-budgets.md) and
  [API request cost](developer/api-request-cost.md).
- [Hosting browser SDK clients](developer/sdk-hosting.md).

## Billing

- [RevenueCat billing](developer/revenuecat-billing.md) and
  [native stores](developer/revenuecat-native-stores.md).
- [Stripe checkout client](developer/stripe-checkout-client.md).
- [Payment provider MCP and CLI operations](developer/payment-provider-mcp.md).
- [Billing history](developer/billing-history.md),
  [lapse purge and recovery](developer/billing-lapse-recovery.md), and
  [purge recovery](developer/billing-purge-recovery.md).

## Operations

- [Infrastructure and deployment](developer/infrastructure.md).
- [Environment reset](developer/greenfield-reset.md) and
  [reset releases](developer/greenfield-reset-releases.md).
- [Root operator API](root-operator-api.md).
- [Private error diagnostics](developer/sentry.md) and
  [API error diagnostics](developer/api-sentry.md).
- [Hosted click analytics](developer/click-tracking.md).

## Repository workflow

- [Verification](developer/verification.md),
  [static analysis](developer/static-analysis.md), and
  [CI and merge requirements](developer/ci-merge-gate.md).
- [Dependency maintenance](dependency-upgrades.md) and
  [dependency audit policy](developer/dependency-audit.md).
- [Test optimization findings](developer/test-optimization.md).
- [Multi-party keying scenarios](../packages/bob-and-alice/README.md): real
  SDK clients against the real API, checked against a reference access model.
- [Local Scope evaluations](developer/scope.md) and the
  [discoverability pilot findings](developer/scope-baseline.md).
- [Formal models](../formal/README.md) and the
  [script index](../scripts/README.md).
