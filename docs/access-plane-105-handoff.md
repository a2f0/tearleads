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
- PR `#168`, `fix: harden offline attachment rotate drafts`: note clients
  probe document sync before committing pending local attachment drafts for an
  existing remote document, so completed rotates are adopted before attachment
  commit.
- PR `#169`, `feat: replace rotated note attachments`: note clients replace
  already-committed attachments after subtractive rotates when local bytes are
  available, or block raw rotate-baseline sync and ask the user to replace the
  file when bytes are not available.
- PR `#170`, `feat: codify live attachment retention`: commit-change prunes
  detached binding rows, blob access epochs, blob recipient envelopes, and blob
  bytes once no active binding references the blob, while retaining blobs that
  still have at least one active binding.

## Current Pickup Point

The local pickup point after PR `#170` is mostly product scope cleanup.
Historical attachment/blob retention behavior is now explicit for V1:

- V1 keeps live attachment blobs only while active bindings reference them
- detached binding rows are transient replacement metadata, not historical
  attachment or audit retention
- durable attachment/audit retention remains a separate product and schema
  decision if the product needs historical attachment bytes, tombstones, or
  manifests

The server still cannot decrypt E2EE Loro update payloads. These rotate checks
and retry paths work through visible frontier metadata plus client-side CRDT
state.

The main remaining #105 candidate is durable historical attachment/audit
retention if the product needs it. Longer-term envelope table cleanup is also
still valid, but should stay separate from the access-plane behavior slices.

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
- the app explorer renders linked note projections under each linked container,
  exposes note link/unlink management in the note detail view, and can switch
  which linked container is treated as the active local note projection
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
- detached attachment bindings are transient metadata, not historical retention;
  commit-change prunes them with the blob once no active binding references the
  blob

## What Not To Reintroduce

Do not go back to the earlier per-user-expanded fallback model.

Avoid these paths:

- do not reintroduce expanded-user fallback for managed group/org grants
- do not add reverse-compat shims for old blob envelope formats
- do not re-upload blob payload bytes for additive access growth
- do not reintroduce `document_blob_links`
- do not treat detached binding retention as historical attachment retention

## Remaining #105 Work

The next slices should stay focused on retention and remaining product/schema
edge cases:

- decide whether durable historical attachment/blob retention is needed beyond
  V1 live-only blob reachability GC
- keep generic, non-note multi-container document-management UI work separate;
  the current app has note-specific move/link/unlink, linked projections, and
  active projection switching, but no broader generic document manager
- keep longer-term envelope schema cleanup separate from behavior work unless a
  concrete invariant requires it

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
continue with the next #105 slice. Assume PR #170 has merged and V1 live-only
attachment retention is documented and tested.

Recommended next slice: decide whether durable attachment/audit retention is a
product requirement beyond V1 live-only blob reachability GC. If it is not,
document that decision explicitly and keep longer-term audit/history or envelope
schema work separate.

Preserve additive rewrap behavior, rotate source-frontier CAS, prior-epoch
update import, canonical bundle adoption, and explicit sync outcome
classification. Do not reintroduce per-user fallback, old blob compat shims,
document_blob_links, or blob payload re-upload for additive access growth.
```
