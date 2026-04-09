# Access Plane #105 Handoff

Last updated: 2026-04-09.

This is the current pickup point for GitHub issue `#105`: principal-based
sharing model and structural mutation APIs.

Yes, the remaining access-plane work is still under `#105`. The issue has
shifted from "make sharing basically work" to "finish the principal-based
rewrap/rotation model and tighten the remaining edge cases."

## Current PR

If this document is being read before PR `#161` has merged, review and merge
that PR first:

- branch: `feat/document-additive-rewrap`
- PR: `#161`
- title: `feat: rewrap additive document epochs`

That PR makes additive document epoch changes use document-DEK rewrap instead
of forcing a full-baseline replacement:

- `rewrap` keeps the same document DEK
- the client materializes a current-epoch recipient bundle
- local pending Loro updates are preserved and retried under the new epoch
- note attachment rewrap-only commits no longer send an unrelated Loro baseline
- `rotate` keeps using the fresh-baseline path

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
  retries are accepted, divergent same-epoch bundle material is rejected with
  `409`, and sync/commit paths no longer silently replace the winning bundle
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

The larger rotate-baseline design remains:

- add a source-frontier / compare-and-set rule for rotate baselines
- ensure the winning rotate baseline commits to all server-known prior-epoch
  edits at the time it is accepted
- define how still-authorized offline clients rebase local-only edits after a
  rotate
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
continue with the next #105 slice: design and implement source-frontier /
compare-and-set handling for rotate baselines so the winning baseline commits
to all server-known prior-epoch edits. Keep additive document rewrap behavior
intact. Do not reintroduce per-user fallback, old blob compat shims, or blob
payload re-upload for additive access growth.
```
