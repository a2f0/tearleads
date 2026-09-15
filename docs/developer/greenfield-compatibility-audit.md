# Greenfield compatibility audit

The September 15, 2026 scrub removes remaining historical application entry
points before the environment reset and coordinated release.

## Removed paths

- **Realtime Sync:** document update hints now use the shared websocket schema,
  which requires `containerIds`. The SDK no longer accepts unscoped updates or
  retains a global invalidation for containers hydrated later. Scoped events
  still force content pulls, preserve pending work through transient failures,
  and receive bounded retries. Ordinary cold-start and reconnect discovery stay
  active.
- **Containers:** create and move persistence must acknowledge that the pending
  intent was settled in the same transaction as the container save. The
  historical second settlement write is removed; incomplete commits are refused
  before live state is installed. A failed acknowledgment leaves the intent
  pending for normal replay; if a remote create was already accepted, replay
  reconciles that identity. Production adapters always acknowledge atomic
  settlement. Flags remain optional on generic saves that request no settlement.
- **Website:** screenshot deep links use `/screenshots/<platform>/<screen>`.
  Screen-only routes and their platform-selection fallback are removed. The
  gallery index and captured platform/screen routes remain available. macOS
  staging download discovery now requires `TLStaging-canary`; its offline
  fallback pins the verified release with that name. Its published checksum and
  local DMG both hash to
  `5b1981e3d1d11afa6d4c321efe878f5f143fbaccd1603194df630db2d5a41ba2`.
- **Desktop releases:** root release wrappers select their tier by filename:
  `*StagingRelease.sh` for staging and `*Release.sh` for production. Historical
  positional tier arguments are rejected before any build or upload.

## Persistence review

- Both API SQL dialects contain only `0000_greenfield_baseline`. Drizzle's
  migration journal and the CLI's embedded SQL assets initialize fresh databases
  and make repeated initialization idempotent; they are required deployment
  machinery, with no historical data conversion to remove.
- SDK SQLite startup creates current tables and rejects obsolete required
  columns. It does not add historical columns or backfill stored records.
- Local backup payloads and encrypted envelopes require format version 8.
  Previous versions are refused, with no conversion path. Security-anchor
  merging during a current-format restore prevents rollback and remains required.
- IndexedDB's version-one creation handler initializes the local keyring store.
  It is not an upgrade chain.
- Signed protocol shapes remain flag-day strict. Historical keys and signed
  document history are current cryptographic evidence, not compatibility formats.

Existing regression coverage checks obsolete backup/schema rejection, scoped
event handling, retry and lifecycle races, lazy hydration, screenshot routing,
and release checkout binding. See [API persistence](api-persistence.md) for reset
requirements and [client sync ordering](../client-sync-ordering.md) for current
reconciliation behavior.

## Release scope

The production reset targets the application server, PlanetScale application
database, and `tearleads-prod` blob bucket with its runtime credentials.
Staging also starts fresh by replacing its server (including local PostgreSQL)
and independent blob storage stack.
Terraform backend state, downloadable release buckets, store registrations,
payment-provider configuration, and signing credentials remain dependencies of
the rebuild. Production database and storage stacks must be provisioned before
running `scripts/deployProduction.sh`.

`scripts/deployEverything.sh` deploys both tiers and uploads iOS and Android.
macOS and Linux uploads additionally require their staging and production root
release scripts. Website and web-app deployment are included in each tier's
deployment script.
