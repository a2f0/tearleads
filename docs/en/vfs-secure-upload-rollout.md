# VFS Secure Upload Rollout

## Scope

Use this runbook to roll out `vfsSecureUpload` safely and verify end-to-end
encrypted upload behavior on the real server stack.

This document focuses on:

- staged feature-flag promotion
- operational guardrails and rollback criteria
- QA sign-off checklist before enabling by default

## Preconditions

- `vfsServerRegistration` and `vfsSecureUpload` are both available in
  `packages/client/src/lib/featureFlags.ts`.
- API routes for VFS register/share/rekey and encrypted blob stage/attach are
  deployed.
- VFS guardrail telemetry and runbook references are available:
  - `docs/en/vfs-sync-runbook.md`
  - `docs/en/vfs-blob-persistence.md`

## Rollout Stages

### Stage 0: Dark launch (default off)

- Keep `vfsSecureUpload=false` for all users.
- Exercise secure upload path in local/dev and staging environments only.
- Verify no regressions in legacy path (`vfsServerRegistration` behavior).

Exit gate:

- No deterministic failures in secure upload integration tests.
- No unresolved fail-closed errors in staging smoke runs.

### Stage 1: Internal canary

- Enable `vfsSecureUpload=true` for internal users only.
- Keep a small cohort and short observation windows.
- Require deterministic failure messages for any secure upload failure:
  - `Secure upload is enabled but VFS secure orchestrator is not ready`
  - `Secure upload failed`

Exit gate:

- Secure upload success rate is stable for canary cohort.
- No silent fallback to legacy upload path while secure flag is on.

### Stage 2: Limited external cohort

- Expand to a small percentage of production users.
- Monitor attach/flush errors and reconcile visibility failures.
- Keep rollback ready by toggling `vfsSecureUpload=false`.

Exit gate:

- No sustained error spike in secure upload stages.
- No increase in sync divergence incidents attributable to secure uploads.

### Stage 3: Default-on decision

- Promote `vfsSecureUpload` when Stage 2 remains stable.
- Keep rollback toggle available until post-rollout checks pass for a full
  observation period.

Exit gate:

- Production QA evidence confirms stable encrypted uploads.
- Release owner signs off on default-on behavior.

## Monitoring and Guardrails

Track these classes of signals during canary and rollout:

- client-side fail-closed secure upload errors
- VFS sync guardrail signatures (`stage:code`) from
  `docs/en/vfs-sync-runbook.md`
- staged-blob attach failures and visibility checkpoint conflicts
- storage-layer 500s from blob persistence routes (`NoSuchKey`,
  `ServiceUnavailable`, `SlowDown`, `InternalError`)

Operational rules:

- Treat guardrail violations as hard-stop signals; do not bypass.
- Avoid silent downgrade to plaintext/legacy behavior when secure flag is on.
- Prefer idempotent retries with identical payloads for transient storage
  failures.

## Rollback Triggers

Rollback `vfsSecureUpload` to `false` if any of the following are observed:

- sustained secure upload failure rate above agreed SLO
- repeated deterministic guardrail failures on attach/reconcile paths
- evidence of protocol mismatch between client encrypted envelopes and API
  handling
- unresolved data integrity risk in stage/manifest/attach sequence

Rollback procedure:

1. Disable `vfsSecureUpload`.
2. Confirm new uploads return to legacy registration behavior.
3. Keep diagnostics and incident timeline; do not discard failing payloads.
4. Land fix + tests before re-enabling canary.

## QA Checklist (Real Server Stack)

Run these checks in staging and again before production promotion:

1. Fresh item secure upload with no preexisting item key succeeds and persists.
2. Encrypted stage -> manifest commit -> attach -> flush sequence completes.
3. Rekey route accepts new epoch wraps and updates share records.
4. Share creation persists wrapped key metadata per recipient and epoch.
5. Encrypted CRDT write behavior is deterministic (supported or explicitly
   rejected by contract).
6. Restart/hydrate recovers pending secure queue and converges after sync.
7. Failure cases are actionable and deterministic (no ambiguous fallback).

### Required automated gate

Run the secure-upload readiness matrix from repo root:

```bash
pnpm qaVfsSecureUpload
```

This command runs a focused cross-package matrix covering:

- API rekey + encrypted envelope parser contract
- API-client secure pipeline + rekey client contract
- Client fail-closed upload behavior + large-file local storage paths
- VFS sync guardrail behavior for encrypted-envelope mismatch handling

Do not promote `vfsSecureUpload` without a green run from this gate on the
candidate commit.

Evidence to capture:

- test run references (suite names and commit SHA)
- staging API logs for one successful and one forced-failure secure upload
- final promotion decision and owner sign-off
- output of `pnpm qaVfsSecureUpload` from staging candidate SHA

## Sign-off Template

Record this block in the release tracking artifact before promotion:

- Candidate commit SHA:
- Readiness gate command: `pnpm qaVfsSecureUpload`
- Readiness gate result: PASS/FAIL
- Staging successful secure upload evidence link:
- Staging forced-failure secure upload evidence link:
- Rollback owner:
- Promotion decision owner + timestamp:
