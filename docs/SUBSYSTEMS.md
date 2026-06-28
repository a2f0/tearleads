# Subsystems

A **subsystem** is a stable proper noun for a slice of the system that a
developer reasons about as one unit — for example "Containers" or "Realtime
Sync". It is the name we use in conversation, PR descriptions, and code review
to say _where a feature lives_ and _who owns it_.

A subsystem is **descriptive, not a new boundary**. It is an ownership and
navigation index laid over paths that already exist. Import direction stays
enforced by the lanes, layers, and planes in `dependency-cruiser.config.ts`; the
file-size and barrel rules stay in `scripts/lintSourceShape.ts`. A subsystem may
deliberately span several layers — `Containers` covers its routes, its service
facade, and its transaction-orchestration workflows — which is exactly the
scatter the registry makes greppable. See AGENTS.md "## Subsystems" for how this
term relates to plane / layer / lane / facade.

## How it is kept honest

- `scripts/subsystems.ts` is the machine-readable manifest: each subsystem lists
  the path prefixes and exact files it owns.
- The `subsystem-registry-covers-every-source-file` architecture check requires
  every production source file in a registered package to map to **exactly one**
  subsystem, so a newly added file that finds no home fails `bun run
  lint:architecture` instead of silently becoming an orphan.
- The `subsystem-registry-matches-docs` check keeps the table below in lockstep
  with the manifest.

Rolled out package by package. Registered today: `packages/api`.

## Registry

<!-- subsystems:start -->

| Subsystem | Owns | Public seam | Source paths (under `packages/api/src/`) |
| --- | --- | --- | --- |
| **Containers** | Container CRUD, grant/revoke/rekey/move, accessible-container listing with sync paging, and writer-projection access resolution. | `routes/containers` via `createContainerRouter`; `services/containers` facade | `routes/containers/`, `services/containers/`, `workflows/containers/` |
| **Documents** | Document update storage, spans/prune/compaction, commit LSN, audit entries/checkpoints/hash history, sync baseline redirect, and edit attribution. | `routes/documents`; `services/documents` facade | `routes/documents/`, `services/documents/`, `workflows/documents/`, `documents/` |
| **Blobs & Attachments** | Blob staging (single + multipart), retrieval streaming, upload capabilities, attachment binding, and the injectable blob object store (memory or S3). | `routes/blobs`; `services/blobs` facade; `BlobObjectStore` adapter | `routes/blobs/`, `services/blobs/`, `workflows/blobs/`, `adapters/blobObjectStore.ts`, `adapters/s3BlobObjectStore.ts`, `adapters/s3BlobObjectStreams.ts`, `utils/blobStageRecords.ts` |
| **Organizations** | Org directory, profile, roster, groups, container grants, and data-usage read models and mutations. | `routes/organizations`; `services/organizations` facade | `routes/organizations/`, `services/organizations/`, `workflows/organizations/` |
| **Principals** | Principal policy projection and current-policy reads, principal state, and member-envelope writes for managed groups/organizations. | `routes/principals`; `services/principals` facade | `routes/principals/`, `services/principals/`, `workflows/principals/` |
| **Auth & Registration** | Challenge-response login, user registration, logout, session listing, and the websocket-ticket minting endpoint. | `routes/auth`; `services/auth` facade | `routes/auth/`, `services/auth/`, `workflows/auth/` |
| **Accounts** | Account lifecycle and paid-account tier gating used to authorize billed routes. | `services/accounts` facade; `requirePaidAccount` middleware | `services/accounts/`, `workflows/accounts/`, `accounts/`, `middleware/account.ts` |
| **Access Plane & Keying** | The encrypted access plane: signed access manifests, KEK state, content-key bundles, principal state, and the access-event/manifest projection codec. | `access/read/*.ts` and `access/write/*.ts` facades (composed only by workflows) | `access/`, `keyingProjectionRecords.ts`, `workflows/keyingReadAccess.ts` |
| **Realtime Sync** | Process-local fan-out of Redis pub/sub events to interested sockets: the WS lifecycle, interest index, Redis interest mirror, and upgrade tickets. | `createRealtimeGateway`, assembled and started by `index.ts` | `realtimeGateway.ts`, `wsRouting.ts`, `wsInterestStore.ts`, `wsTicket.ts`, `wsIdentity.ts` |
| **Session Lifecycle** | Bearer-token session storage, activity/IP tracking, request-IP binding, and session revocation (clear WS interest + publish `session_revoked`). | `middleware/session.ts` (`requireAuth`) and `sessionRevocation.ts` | `middleware/session.ts`, `sessionRevocation.ts`, `validators/session.ts`, `requestContext.ts` |
| **Service Runtime & Composition Root** | The HTTP composition root: Hono app assembly, the `ApiServiceRuntime` dependency object, the test override seam, and the server entry point. | `routeApp.ts` / `routeAppDeps.ts`; `ApiServiceRuntime` from `services/runtime.ts` | `routeApp.ts`, `routeAppDeps.ts`, `index.ts`, `appTestRuntime.ts`, `services/runtime.ts`, `routes/health.ts` |
| **Infrastructure Adapters** | Effectful infrastructure boundaries other than blob storage: Redis key/value and pub/sub, plus the in-memory Redis used for tests and dev. | `adapters/redis.ts`, `adapters/redisPubSub.ts` (closed over by factories) | `adapters/redis.ts`, `adapters/redisPubSub.ts`, `adapters/inMemoryRedis.ts` |
| **Shared Utilities** | Package-neutral helpers reused across subsystems: array helpers, canonical JSON, SHA-256, SQL dialect, and UUID generation. | `utils/*` direct import | `utils/array.ts`, `utils/canonicalJson.ts`, `utils/sha256.ts`, `utils/sqlDialect.ts`, `utils/uuid.ts` |

<!-- subsystems:end -->

## Adding or changing a subsystem

1. Edit `scripts/subsystems.ts` so the owning subsystem's `paths` claim the new
   file (or add a new subsystem entry).
2. Mirror the change in the table above.
3. Run `bun run lint:architecture`. The coverage check tells you about any file
   that maps to zero or more than one subsystem; the docs check tells you about
   any table/manifest drift.
