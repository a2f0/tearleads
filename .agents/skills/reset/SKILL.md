---
name: reset
description: Return a clean checkout to its updated default branch after confirmed shipping or an explicit checkout cleanup request.
---

# Reset

This is checkout cleanup, not a destructive Git reset. Read repository guidance
for setup and hooks. Determine the default branch through the repository's
remote metadata rather than assuming main.

Check worktree and index first. Preserve user edits; if they prevent switching,
report the condition instead of discarding or automatically stashing them. For
post-merge cleanup, confirm the PR is MERGED before removing a feature branch.

Fetch the default branch, switch to it, and update by fast-forward only. A
diverged default branch requires inspection rather than forced replacement.
Delete a merged feature branch only within the requested cleanup scope and
after verifying its exact commit is the shipped commit; squash merging does not
make Git ancestry-based branch deletion proof of shipping. Honor keep-branch.

Run only the hook installer or dependency setup documented by this repository
when the updated checkout requires it. Do not assume a package manager or copy
setup commands from another project. Report final branch, commit, and any
unfinished cleanup.
