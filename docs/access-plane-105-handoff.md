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
- PR `#167`, `feat: classify document sync outcomes`: sync responses expose
  returned update epochs, prior/current missing-update summaries, and canonical
  bundle adoption so clients do not infer rotate/adoption outcomes indirectly.

## Current In-Flight Slice

The local pickup slice after PR `#168` hardens already-committed note
attachments when a client discovers a subtractive document rotate:

- committed attachments with local plaintext bytes are queued for same-slot blob
  replacement instead of header-only rewrap
- clients try to hydrate missing committed attachment bytes before deciding that
  user action is needed
- if bytes are still unavailable, the note UI marks the attachment as needing
  replacement and exposes a per-attachment `Replace File` action
- raw document sync is paused while any committed attachment still needs
  replacement, so rotate baselines that reference attachment slots are not
  uploaded ahead of the server-visible binding replacement
- replacement commits carry the rotate baseline source frontier through the
  existing atomic `commit-change` path

The server still cannot decrypt E2EE Loro update payloads. These rotate checks
and retry paths work through visible frontier metadata plus client-side CRDT
state.

After this slice lands, the best next candidate is the historical
attachment/blob retention policy.

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
- note clients probe document sync without outgoing updates before committing
  pending local attachment drafts for an existing remote document, so completed
  rotates are adopted before the attachment `commit-change`
- note clients replace already-committed attachments after subtractive rotates
  when local bytes are available, and otherwise surface a per-attachment
  replacement action before uploading a current-epoch rotate baseline that
  references the slot
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

The next slices should stay focused on retention and remaining product edge
cases:

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
continue with the next #105 slice. Assume PR #167 has merged and the sync
outcome classification slice has landed.

Recommended next slice after committed attachment replacement hardening: decide
and implement the historical attachment/blob retention policy.

Preserve additive rewrap behavior, rotate source-frontier CAS, prior-epoch
update import, canonical bundle adoption, and explicit sync outcome
classification. Do not reintroduce per-user fallback, old blob compat shims,
document_blob_links, or blob payload re-upload for additive access growth.
```
