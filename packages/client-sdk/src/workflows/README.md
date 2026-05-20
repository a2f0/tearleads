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
| `explorer` | Platform read model and runtime | Container/document navigation projections and sync helpers. Explorer UI routes, panels, menus, and selection state belong in `packages/app`. |
| `organizations` | Platform organization administration | Organization directory, groups, grants, usage, user-detail read models, and principal-policy mutation helpers. Org Manager screens and labels belong in `packages/app`. |
| `principals` | Platform runtime | Principal-policy cache and verification support. |
| `registration` | Platform runtime | Local registration and root-container bootstrap helpers. |
| `sync` | Platform runtime | Shared sync coordinator helpers. |

Name SDK facades after the platform state they expose. Product names can stay
in app providers and components that adapt those platform facades into a UI.
