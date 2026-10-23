---
name: squash-merge
description: Squash-merge a reviewed GitHub pull request while binding the mutation to the reviewed commit and checking CI.
---

# Squash Merge

Use the installed `agent-tool` and repository merge policy. Merge only within
the user's authorized scope. Have the exact reviewed HEAD, base commit, and base
branch available, and read the verdict and unresolved findings. BLOCKER or MAJOR
findings require repair and a new review before merging.
Follow the repository's review-bot policy and require all actionable blocking
review feedback to be addressed before merging.

Wait with `agent-tool pr checks --wait --head <reviewed-head>`, which waits for
checks to appear and for every workflow/job/event entry to finish. Run
`agent-tool pr preflight <reviewed-head> <base-branch> <reviewed-base>` immediately
before merging. It checks local and PR identity, live base, ancestry, explicit
version policy, merge readiness, configured strict rulesets, and passing checks.
If an identity changed, refresh, integrate, validate, and review again. Read
unresolved feedback with `pr threads list` and follow project review policy.

Use a title that satisfies `agent-tool.json` and pass both reviewed HEAD and
base branch:

```sh
agent-tool pr merge 'feat: describe the change' <reviewed-head-oid> <base-branch>
```

The helper enforces HEAD atomically through GitHub's `expectedHeadOid`, checks
CI, rejects queued or automatic merges, and creates a subject-only squash with
the PR reference. GitHub has no atomic expected-base argument in this mutation;
repository branch protection must enforce any required base freshness. With
`merge.requireStrictBaseFreshness`, the helper refuses to merge unless an
active strict status ruleset that the actor cannot bypass protects the base. Do
not retarget the PR concurrently with merging.

Confirm GitHub reports MERGED before any cleanup. A failed or uncertain mutation
is not evidence of a merge. Preserve the branch on failure. After a confirmed
merge, perform checkout cleanup only when requested or as part of an authorized
shipping workflow. Report the PR and merge result.
