---
name: reset
description: Return a clean checkout to its updated default branch after confirmed shipping or an explicit checkout cleanup request.
---

# Reset

This is checkout cleanup, not a destructive Git reset. Read repository guidance
for setup and hooks. Determine the default branch through the repository's
remote metadata rather than assuming main.

For post-merge cleanup, preview with
`agent-tool repo cleanup <PR-number> <shipped-head>`, then run it with `--apply`
within the authorized cleanup scope. It requires a confirmed MERGED PR, preserves
local edits, checks exact local/remote feature commits, verifies the merge is on
the default branch, and fast-forwards that branch. By default it prunes the
shipped local feature branch and deletes the matching remote branch if present.
Local pruning also applies after a squash merge or when GitHub already deleted
the remote branch; a missing remote is not evidence that local cleanup is done.
Pass `--keep-branch` when the user asked to preserve both feature refs.
Read the receipt's completed steps if a later operation fails; do not claim full
cleanup from a partial result. Verify the final branch and clean worktree, and
check that `git branch --list <feature-branch>` is empty unless keeping the branch.
If the feature branch is checked out in another worktree, shared cleanup reports
a partial failure after updating the default branch and leaves both feature refs
in place; preserve that worktree and report the remaining cleanup.

Remote branch deletion uses GitHub REST after checking the live ref to avoid
pre-push hooks. The API has no atomic expected-OID delete guard; the check and
deletion retain a small concurrent-update window. Fork PRs require manual remote
handling and are refused by the shared cleanup command.
Use a repository's stronger cleanup procedure when required, including atomic
remote deletion or additional local verification; do not weaken it to use the
shared command. The same local pruning and keep-branch outcomes still apply.

For an explicit checkout cleanup without a merged PR, preserve all feature refs:
check worktree/index, resolve the default branch with `repo context`, fetch it,
switch, and update by fast-forward only. Never discard or automatically stash
edits, force a diverged default branch, or infer shipping from Git ancestry after
a squash merge.

Run `agent-tool teardown` and stop what the finished work left running
(`teardown --apply` for recorded processes); report anything that remains.
Run the repository's documented dependency/hook setup if required. When copied
hooks are configured, use `agent-tool hooks check` and `hooks install --apply`;
inspect unmanaged hooks before an explicit `--adopt`, which backs them up.
Do not assume a package manager. Report final branch, commit, whether the shipped
local branch was pruned or preserved, and unfinished cleanup or setup.
