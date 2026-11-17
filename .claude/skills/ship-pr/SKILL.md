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
prepare`, `review`, `repo base-health`, and other commands whose output drives a
decision directly. Prefer documented compact test reporters when they preserve
required evidence; do not reduce test scope, skip checks, silence warnings, or
mask failures. Start servers, watchers, and other long-running processes with
`agent-tool proc start --label <name> -- <command>`, never a backgrounded shell
command, so they can be found and stopped.

1. Start from the base branch's health: `agent-tool repo base-health` (with
   `--branch <base-branch>` for another base). `green`, `pending`, and `no-ci`
   need nothing more; report `no-ci` as missing CI on pushes. When it is
   `red`, read the failing jobs' logs (`gh run view <run-id> --log-failed`
   through `agent-tool run`) and relate them to the merges in
   `breakingRange`. Broken logic from combined merges: fix it and add the test
   that would have caught the combination. A flaky or timing-dependent test:
   remove the race, ordering dependence, or shared state. Infrastructure or an
   outside service: record it; rerun only when the log shows the cause was
   external. Never retry until green, skip, or loosen an assertion. When
   `openRepairs` lists a PR, do not duplicate it. Otherwise ship the repair
   through this workflow as its own PR, naming the failing run in its body,
   ahead of the requested change; when the change touches the same code, make
   the repair a separate commit in that PR and say so in its description. A
   red base does not block an unrelated change; stop only when the change
   cannot be validated without the repair. A PR failure with the same job and
   error as on the base is repaired on the base. Reverting the breaking merge
   is allowed when the fix is not small and the break blocks a deploy or
   publish; the revert names the merge and the follow-up that restores it.
2. Finish the requested change on a feature branch. Use
   `agent-tool branch create <branch> --base <base-branch> --remote <remote>`
   from a clean checkout; it fetches and pins the base, checks naming policy and
   collisions, and creates without a local upstream. Use `branch check` with
   explicit destination names in CI or hooks. Before pushing, validate with the
   repository's push gate and the tests that target the changed code, not the
   full suite: CI runs everything and is the authority. Commit only the
   intended files.
3. Use `agent-tool repo context --fetch` to resolve the PR's base repository
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
   and review every changed HEAD again. Review failure blocks shipping. One
   change keeps a review: after a clean review, a new HEAD that only integrated
   the base and prepared versions (as when another PR took the same version
   first). When `agent-tool review carry <reviewed-head> <new-head>` exits 0
   with `ok: true`, the earlier clean review stands, and the new HEAD is the
   reviewed head from then on; report the review as carried, giving the
   reviewed head and the command's JSON output. Every other changed HEAD,
   including one the command rejects, gets an independent review, and CI
   still runs on the new HEAD.
4. Run `agent-tool branch push <reviewed-head> --remote <remote>` through
   normal hooks; it verifies local and remote identity afterward. If a hook
   changed content or HEAD, review that result.
   Open the PR using the open-pr skill, or update the existing PR as needed.
5. Allow configured review bots time to respond, then use
   `agent-tool pr threads list` to fetch review threads and all comments. Follow repository policy for feedback: fix valid findings,
   reply with `pr threads reply <comment-id>` (body file or stdin), and use
   `pr threads resolve <thread-id>` only for fully addressed findings.
   Validate, commit, push, and independently review every feedback or CI repair.
   Wait with `agent-tool pr checks --wait --head <reviewed-head>`, whose limit
   defaults to `agent-tool.json` `merge.checksTimeoutSeconds`. When a job
   fails, read its log with `agent-tool pr logs --head <reviewed-head>`, fix it
   in a new commit, review it, push, and wait on the new head. A base that
   moved (`behind: true`) needs no integration unless GitHub reports a
   conflict, `versions check` fails against the live base, or the repository
   sets `merge.requireStrictBaseFreshness`; under that policy the wait stops
   early, so cancel the stale head's CI with
   `agent-tool pr cancel-runs --head <reviewed-head>`, then integrate,
   validate, review (or carry the review, as in step 3), push, and wait again.
   Then run
   `agent-tool pr preflight <reviewed-head> <base-branch> <reviewed-base>` to
   recheck CI, conflicts, the live base, PR identity, local state, and explicit
   version policy. When versions are managed,
   `agent-tool versions check <live-base-oid>` must pass. Use the squash-merge
   skill to merge the exact reviewed HEAD.
6. After confirmed MERGED, follow the reset skill: run
   `agent-tool repo cleanup <PR-number> <reviewed-head> --apply` to return to the
   updated default branch and prune the shipped feature branch, honoring
   stronger repository cleanup rules. Never prune with raw `git branch -D` or
   `git push --delete`: the cleanup command checks the merge and both refs
   first, and harness command guards prompt for raw force deletes. If the user requested keep-branch, preserve
   both feature refs. Check the cleanup receipt and verify the local feature ref
   is absent unless preserved; report incomplete cleanup explicitly. Apply
   documented dependency/hook setup.
7. When the project publishes npm packages, use `agent-tool release verify
   <package> <version> <merge-oid> --workflow <publish-workflow>` to verify the
   exact workflow and tarball, allowing registry propagation time. When the
   project deploys the merged branch, verify that deployment and documented
   live checks. Report deployment failures
   separately from a successful merge; follow project policy for repairs. A
   release that fails because another merge published the same version needs
   a follow-up version bump through this workflow.
8. Run `agent-tool repo base-health` again until it is no longer `pending` and
   the merge commit, or a newer tip, has runs (`tip.hasRuns`). When no run
   starts within about ten minutes, as with path filters or PR-only CI, or the
   status is `no-ci`, report that and stop waiting. A failure there belongs to
   this session: fix it forward through this workflow before reporting the
   work done.

Before the final report, run `agent-tool teardown` in each repository this work
touched. Stop what the work started (`teardown --apply`, `proc stop`), stop any
untracked process it started, and remove worktrees it added. Report what
remains and why; the work is not done while teardown fails for anything it
started.

Never infer a clean review from process success alone, or carry a review to a
HEAD that `review carry` does not accept. Do not weaken configured CI policy to
get a merge through. If a step fails, preserve useful intermediate work and report the concrete
remaining issue. Report PR link, merged commit, review verdict, validation, final
checkout state, the base's health at the start and end and anything repaired or
hardened, the teardown result, and whether the shipped local branch was pruned
or preserved.
