# Client SDK Workflows

Workflow facades are the SDK's public domain-operation boundary. They may
compose API calls, local persistence, key/projection verification, and sync
coordination, but they must stay React-free and product-UI-free.

## Facade Taxonomy

| Facade | Classification | Notes |
| --- | --- | --- |
| `blobs` | Platform runtime | Encrypted blob upload, hydration, decryption, and local byte-store helpers. |
| `contacts` | Platform read model and runtime | Address-book documents, contact sync, and recipient key lookup. Contacts UI state belongs in `packages/app`. |
| `containers` | Platform runtime | Container mutation planning and remote container operations. |
| `documents` | Platform runtime | Document creation, persistence, sync, projection keys, and document link-set helpers. |
| `container-contents` | Platform read model and runtime | Container tree projections, container metadata documents, document discovery, document links, and sync helpers. Product UI routes, panels, menus, and selection state belong in `packages/app`. |
| `organizations` | Platform organization administration | Organization directory, groups, grants, usage, user-detail read models, and principal-policy mutation helpers. Org Manager screens and labels belong in `packages/app`. |
| `principals` | Platform runtime | Principal-policy cache and verification support. |
| `registration` | Platform runtime | Local registration and root-container bootstrap helpers. |
| `sync` | Platform runtime | Shared sync coordinator helpers. |

Name SDK facades after the platform state they expose. Product names can stay
in app providers and components that adapt those platform facades into a UI.
For example, the SDK exports `workflows/organizations`, while the app can keep
`OrgManager` provider, route, and screen names in `packages/app`.

`bun run lint:architecture` guards this taxonomy by rejecting product window
vocabulary in SDK TypeScript source and by keeping package exports at documented
workflow/store facade boundaries. It also checks that this table lists every
exported workflow facade exactly once.
