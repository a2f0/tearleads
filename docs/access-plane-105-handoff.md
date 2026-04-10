# Access Plane #105 Handoff

Last updated: 2026-04-10.

This is the current pickup point for GitHub issue `#105`: principal-based
sharing model and structural mutation APIs.

Yes, the remaining access-plane work is still under `#105`. The issue has
shifted from "make sharing basically work" to "finish the principal-based
rewrap/rotation model and tighten the remaining edge cases."

## Recently Landed PRs

These #105 slices are back on `main`.

- PR `#161`, `feat: rewrap additive document epochs`: additive document epoch
  changes use document-DEK rewrap instead of forcing a full-baseline
  replacement.
- PR `#163`, `fix: canonicalize document recipient bundles`: current-epoch
  document recipient bundles are canonical and divergent same-epoch bundle
  material is rejected.
- PR `#164`, `feat: enforce rotate baseline source frontier`: first
  current-epoch rotate baselines carry `sourceVersionVector`, and the server
  compare-and-set checks that value against all server-known prior-epoch
  document updates before accepting the baseline.
- PR `#165`, `fix: rebase rotate baselines over prior updates`: rotate
  baseline metadata must cover the claimed prior frontier, and app clients
  import decryptable prior-epoch updates before queueing the fresh baseline.
- PR `#166`, `fix: adopt canonical bundles after rotate races`: same-epoch
  document recipient bundle conflicts during sync return the canonical
  current-epoch bundle with outgoing updates left unaccepted, clients
  immediately retry unaccepted pending work, and the shared conflict message is
  defined once in `@tearleads/loro/shared`.

## Current In-Flight Slice

Branch `feat/sync-outcome-classification` is the next `#105` slice.

This slice makes the document sync response classify the rotate/adoption cases
that clients previously inferred:

- returned document updates include visible `accessEpoch`
- `missingUpdateEpochs[]` summarizes whether the response contains
  `prior_epoch` updates, `current_epoch` updates, or both
- `canonicalDocumentRecipientEnvelopesAdopted` identifies same-epoch canonical
  bundle adoption, so pending outgoing work can be retried under the canonical
  bundle explicitly instead of only by comparing accepted update counts
- notes, contacts, and explorer decrypt incoming updates in epoch-specific
  batches, so prior-epoch and current-epoch updates can both be handled around a
  completed rotate when the client has the relevant bundle material

The server still cannot decrypt E2EE Loro update payloads. These rotate checks
and retry paths work through visible frontier metadata plus client-side CRDT
state.

After this slice lands, the best next candidate is attachment replacement and
local draft hardening for clients that discover a completed rotate after working
offline.

## What Is Already Landed

The access plane already has these pieces:

- users, groups, and organizations are principal-shaped access subjects
- group/org grants require current signed policy state and fail closed when it
  is missing
- principal policy bundles can be fetched, verified, cached, and used to unwrap
  group/org-addressed object bundles
- container access inherits through the container tree
- document access derives from linked containers
- blob access derives from active attachment bindings and linked documents
- structural mutation APIs exist for container move and document link/unlink
- the app explorer drives container move and note document link/unlink flows
- linked note projections render under each linked container
- additive blob access growth rewraps committed blob recipient material without
  re-uploading blob payload bytes
- current-epoch document recipient bundles are canonical: identical bundle
  retries are accepted, divergent same-epoch commit material is rejected with
  `409`, and sync returns the canonical bundle without accepting outgoing
  updates
- additive document access growth rewraps the document DEK, materializes a
  current-epoch recipient bundle, and preserves pending Loro updates for retry
- rotate baseline source-frontier CAS rejects first current-epoch baselines that
  do not match the server-known prior-epoch document frontier
- honest clients import decryptable prior-epoch updates before creating rotate
  baselines, and losing same-epoch bundle writers can adopt the canonical
  bundle before retrying pending updates
- sync responses can return the canonical current-epoch document recipient
  bundle after a same-epoch bundle conflict instead of only returning a bare
  conflict response
- sync responses classify prior/current missing updates and canonical bundle
  adoption explicitly, and app clients use per-update `accessEpoch` batches for
  incoming update decryption
- detached attachment bindings are transient metadata and may be pruned when
  blob GC removes the now-unreachable blob

## What Not To Reintroduce

Do not go back to the earlier per-user-expanded fallback model.

Avoid these paths:

- do not reintroduce expanded-user fallback for managed group/org grants
- do not add reverse-compat shims for old blob envelope formats
- do not re-upload blob payload bytes for additive access growth
- do not reintroduce `document_blob_links`
- do not treat detached binding retention as historical attachment retention

## Remaining #105 Work

The next slices should stay focused on rotate/adoption edge cases:

- harden attachment replacement UX and local draft handling for clients that
  discover a completed rotate after working offline
- keep true multi-container document-management UI work separate unless the
  chosen slice needs it; the structural APIs and note move/link/unlink flows
  already exist, but notes still present mostly as single-active-container
  documents in the current app
- decide how much historical attachment/blob retention the product needs

## Docs To Read Before Continuing

- [access-plane-v1.md](./access-plane-v1.md): current access model and rewrap
  versus rotate rules
- [loro-e2ee-sync-protocol.md](./loro-e2ee-sync-protocol.md): document sync,
  attachment commit, and current protocol limitations
- [document-rekey-and-audit-history.md](./document-rekey-and-audit-history.md):
  rotate baseline, offline edit, and audit-history design notes
- [known-issues.md](./known-issues.md): remaining intentionally tracked gaps

## Suggested Prompt For The Next Agent

Use this if continuing from another machine:

```text
We are working through GitHub issue #105 in the tearleads repo. Read
docs/access-plane-105-handoff.md first, then inspect the latest main branch and
continue with the next #105 slice. Assume PR #166 has merged and the sync
outcome classification slice has either landed or is in review.

Recommended next slice after sync outcome classification: harden attachment
replacement UX and local draft handling for clients that discover a completed
rotate after working offline.

Preserve additive rewrap behavior, rotate source-frontier CAS, prior-epoch
update import, canonical bundle adoption, and explicit sync outcome
classification. Do not reintroduce per-user fallback, old blob compat shims,
document_blob_links, or blob payload re-upload for additive access growth.
```
