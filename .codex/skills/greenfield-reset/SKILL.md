---
name: greenfield-reset
description: Scrub obsolete compatibility paths, ship the changes, then destroy and rebuild Tearleads application infrastructure and release every supported app for the requested environments. Use for an intentional fresh-data environment reset; ordinary Git checkout resets use the reset skill.
---

# Greenfield Reset

Reset the requested Tearleads environments from one reviewed, merged revision,
using the repository's deployment and release scripts. Support `staging`,
`prod`/`production`, or `all`/`both`. Creating or reviewing this skill does not
request a reset.

## Scope and authorization

- Resolve environments from the current request and conversation. Never infer
  production deletion from a bare, ambiguous “reset.” If scope is missing,
  prepare the inventory and plans, then ask one concrete scope question before
  any destructive operation.
- An explicit request to destroy and rebuild an identified environment already
  authorizes its application database, blob storage, server, and replacement
  runtime credentials. Do not ask for that permission again. A completed past
  reset does not authorize a new reset task.
- A full invocation includes the compatibility scrub, `ship-pr` for necessary
  source changes, infrastructure rebuild, all supported release targets, and
  website refresh. Honor explicit narrower scope, including plan-only requests.
- Preserve Terraform backend state, downloadable release buckets, signing
  credentials, store registrations, and payment-provider configuration. Treat
  deletion of external provider records as separate scope; inventory them and
  report any unresolved associations.
- Read [the infrastructure runbook](../../../docs/developer/greenfield-reset.md)
  before preparing teardown, including its external-state section.
  Read [the release runbook](../../../docs/developer/greenfield-reset-releases.md)
  before preflighting or starting releases. Re-read the current scripts and
  linked subsystem docs where behavior matters; live identities and tool
  versions must come from the current checkout and providers.

## Workflow

1. **Inventory and preflight.** Record the resolved scope and retained resources.
   Establish private run records and capture current resource identities,
   database/blob state, release manifests, and store build numbers. Check
   provisioning, deployment, signing, Docker, and store access before downtime.
   Inspect deletion plans against the named resources. Resolve concrete
   blockers before destroying a healthy environment.
2. **Scrub and ship.** Audit old readers/writers, schema conversions, backup
   imports, and release aliases against their callers and tests. Preserve fresh
   schema initialization, strict refusal of obsolete formats, ordinary sync
   recovery, and signed history. Make only justified changes. If there are
   changes, run the matching checks and invoke the sibling
   [ship-pr](../ship-pr/SKILL.md) end to end. Do not begin teardown while that PR
   remains unmerged or a required check is failing. If the audit is clean, record
   that result without making an empty PR. Freeze the clean merged commit used
   for every deployment and release; regenerate plans if shipping changed their
   configuration.
3. **Destroy and rebuild.** Process one environment through restored service
   before taking the next down. Default to staging first when both are selected;
   respect an explicitly requested order. Remove old writers before dropping
   data, use inspected plans, remove temporary destruction overrides, provision
   database/storage dependencies, then run the tier's root deployment script.
   Verify new resource identities, fresh schema, and service health before
   continuing. Follow the infrastructure runbook's production protection and
   resume rules.
4. **Release every selected target.** Follow the release matrix and concurrency
   rules in the release runbook. Preserve the frozen source revision throughout.
   Record real exit statuses, installer hashes, and resolved store build numbers.
   Wait for notarization and store processing; a quiet log alone is not failure.
5. **Refresh and verify.** Redeploy each website after both desktop uploads.
   Verify public installer bytes against this run's builds, current website
   links, store acceptance, API/web/demo health, and the scoped functional smoke
   checks. Review leftover resources and restored production protections.

## Resume and reporting

Keep per-phase records under a new private `.secrets/greenfield-<run-id>/`
directory: source SHA, tier, command, phase, exit status, nonsecret resource IDs,
and verification results. Plans and raw outputs can contain credentials; never
publish them or copy a prior run's credentials into the skill.

On failure, stop dependent work, inspect live state, and resume the incomplete
phase. Reuse success records only for the same run, revision, and resource or
artifact identity, with provider readback. Never repeat deletion against an
already rebuilt environment or re-upload a build just because a logging helper
failed. Continue independent authorized work while an external step is pending.
Report an actual credential, permission, or provider failure with the exact
remaining step; do not mark the reset complete while required work is pending.

Finish with the PR/revision, reset environments, deployed services, desktop
verification, mobile build numbers and actual channels, retained external state,
and any incomplete work. A TestFlight or Play internal upload must be described
as such. Leave the source checkout clean when shipping and releasing have
completed.
