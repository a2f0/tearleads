---
name: ship-pr
description: Complete an authorized commit, independent review, repair, PR, CI, and squash-merge workflow for a GitHub repository.
---

# Ship PR

Use the installed `agent-tool`. Read repository guidance and policy first;
validation, versioning, package management, and hook bodies remain project
concerns. Use shared branch, hook, check, cleanup, and release commands where
configured; keep application-specific commands in repository guidance. Shipping authorizes this workflow within the user's stated scope.
Preserve unrelated edits and honor requested stopping points such as open-PR
only, report-only review, or keeping the feature branch.

Use `agent-tool run --label <check> -- <command> [args...]` for noisy setup,
validation, builds, and hook-running Git commands. It preserves exit status and
complete private logs, prints one success receipt, and shows a bounded failure
tail. Inspect more with `agent-tool logs <log> --max-bytes 8192 --tail-lines 80`
or a targeted search; never dump an entire suite log or pipe checks into `tail`.
The receipt proves process completion, not absence of warnings: inspect required
warning, coverage, timing, or artifact evidence before accepting a check. Keep
machine-readable receipts and review findings visible by running `versions
prepare`, `review`, and other commands whose output drives a decision directly.
Prefer documented compact test reporters when they preserve required evidence;
do not reduce test scope, skip checks, silence warnings, or mask failures.

1. Finish the requested change on a feature branch. Use
   `agent-tool branch create <branch> --base <base-branch> --remote <remote>`
   from a clean checkout; it fetches and pins the base, checks naming policy and
   collisions, and creates without a local upstream. Use `branch check` with
   explicit destination names in CI or hooks.
   Validate it with appropriate project checks and commit only the intended
   files.
2. Use `agent-tool repo context --fetch` to resolve the PR's base repository
   and branch, or the default branch when no PR exists, and fetch its exact base.
   Record the returned base/head identities. Integrate the fetched base
   using the repository's normal workflow, resolving conflicts without losing
   user work. If project policy versions packages, prepare versions against the
   pinned base after every integration or repair and before each review, using
   the project's commands or `agent-tool versions prepare <base-oid>`, which
   commits bumped manifests and the refreshed lockfile.
   `agent-tool versions resolve-conflicts` resolves conflicts confined to
   version fields. Review the resulting committed HEAD with an independent
   reviewer using the bundled cross-agent-review skill. Repair blocking findings
   and review every changed HEAD again. Review failure blocks shipping.
3. Run `agent-tool branch push <reviewed-head> --remote <remote>` through
   normal hooks; it verifies local and remote identity afterward. If a hook
   changed content or HEAD, review that result.
   Open the PR using the open-pr skill, or update the existing PR as needed.
4. Allow configured review bots time to respond, then use
   `agent-tool pr threads list` to fetch review threads and all comments. Follow repository policy for feedback: fix valid findings,
   reply with `pr threads reply <comment-id>` (body file or stdin), and use
   `pr threads resolve <thread-id>` only for fully addressed findings.
   Validate, commit, push, and independently review every feedback or CI repair.
   Wait with `agent-tool pr checks --wait --head <reviewed-head>`, then run
   `agent-tool pr preflight <reviewed-head> <base-branch> <reviewed-base>` to
   recheck CI, live base, PR identity, local state, and explicit version policy.
   A changed base requires integration, validation, and another review. When
   versions are managed, `agent-tool versions check <base-oid>` must pass for the
   live base. Use the squash-merge skill to merge the exact reviewed HEAD.
5. After confirmed MERGED, use the reset skill to return to the updated default
   branch and prune the shipped local feature branch as part of cleanup, honoring
   stronger repository cleanup rules. If the user requested keep-branch, preserve
   both feature refs. Check the cleanup receipt and verify the local feature ref
   is absent unless preserved; report incomplete cleanup explicitly. Apply
   documented dependency/hook setup.
6. When the project publishes npm packages, use `agent-tool release verify
   <package> <version> <merge-oid> --workflow <publish-workflow>` to verify the
   exact workflow and tarball, allowing registry propagation time. When the
   project deploys the merged branch, verify that deployment and documented
   live checks. Report deployment failures
   separately from a successful merge; follow project policy for repairs.

Never infer a clean review from process success alone or carry a review across
content changes. Do not weaken configured CI policy to get a merge through.
If a step fails, preserve useful intermediate work and report the concrete
remaining issue. Report PR link, merged commit, review verdict, validation, final
checkout state, and whether the shipped local branch was pruned or preserved.
