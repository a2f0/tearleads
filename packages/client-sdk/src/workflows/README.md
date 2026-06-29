# Client SDK Workflows

Workflow facades are the SDK's public domain-operation boundary. They may
compose API calls, local persistence, key/projection verification, and sync
coordination, but they must stay React-free and product-UI-free.

## Facade Taxonomy

| Facade | Classification | Notes |
| --- | --- | --- |
| `blobs` | Platform runtime | Encrypted blob upload, hydration, decryption, and local byte-store helpers. |
| `containers` | Platform runtime | Container mutation planning and remote container operations. |
| `documents` | Platform runtime | Document creation, persistence, sync, projection keys, and document link-set helpers. |
| `container-contents` | Platform query and runtime | Container tree projections, container metadata documents, document discovery, document links, diagnostics, and sync-state helpers. Product UI routes, panels, menus, and selection state belong in `packages/app`. |
| `organizations` | Platform organization administration | Organization directory, groups, grants, usage, user-detail read models, and principal-policy mutation helpers. Org Manager screens and labels belong in `packages/app`. |
| `principals` | Platform runtime | Principal-policy cache and verification support. |
| `registration` | Platform runtime | Local registration and root-container bootstrap helpers. |
| `sync` | Platform runtime | Shared sync coordinator helpers. |

The `sync` facade exposes read-only coordinator snapshots through
`getDomainSyncCoordinatorSnapshot(...)` and
`subscribeToDomainSyncCoordinator(...)`. Host diagnostics and product UI may use
those snapshots to show lane status, request/run/error counts, and last action
timestamps without reaching into coordinator internals or owning sync policy.

Workflow code consumes the resolved `runtime.state.online` value. Host-level
network detection and any manual online/offline override policy belongs to the
SDK `tearleads.network` runtime state, not individual workflow facades.

The device-first read/reconcile seam lives outside the workflow facades, in
`src/stores/local-projection` (the synchronously-readable `LocalProjectionStore`)
and `src/sync/reconciliation` (the background `ReconciliationService` that owns
remote document discovery over the sync coordinator). Product UIs consume both
through the `tearleads.deviceFirst` SDK facade rather than these modules
directly. See `docs/developer/device-first-reconciliation.md`.

The `blobs` facade also exports encrypted local blob store helpers, including
`createLazyEncryptedBlobStore` for hosts that load encryption keys from an async
keyring provider.

Local keyring variants, including WebView and PIN-code wrapping helpers, are
client-facade exports rather than workflow facades. Keep platform keychain
composition in `client/*` so workflow modules stay focused on domain
operations.

Name SDK facades after the platform state they expose. Product names can stay
in app providers and components that adapt those platform facades into a UI.
For example, the SDK exports `workflows/organizations`, while the app can keep
`OrgManager` provider, route, and screen names in `packages/app`.

`bun run lint:architecture` guards this taxonomy by rejecting product window
vocabulary in SDK TypeScript source and by checking that this table lists every
workflow facade aggregated by the root SDK entry point exactly once.
