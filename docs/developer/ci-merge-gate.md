# CI and merge requirements

The `protect-main` GitHub ruleset must require `CI gate`, `Lint`,
`Build and test`, `Postgres concurrency`, and
`windows / Windows CEF persistence` from the GitHub Actions app,
with strict base freshness and no bypass actors. The ruleset is repository
configuration; editing a workflow alone does not make a check required.

`CI gate` runs on every pull request and main-branch push. It requires lint,
workspace builds, TypeScript, package tests, the web build, and Postgres
concurrency and Windows CEF persistence to pass on every PR. It also waits for
native purchase bridge compiles and Terraform checks whenever their paths change.
The platform workflows are reusable and retain their standalone manual dispatch
entry points.

The API, app, and client SDK suites each run in a `Test (...)` job of their own,
and `Build and test` runs the remaining package tests. The gate requires both
jobs, so the suites need no ruleset entries of their own. Turbo serves cached
results from the GitHub Actions cache: a pull request reads entries written on
its own ref or on `main`, while `main` never reads an entry a pull request wrote.
The nightly `Uncached tests` workflow reruns every suite without the cache.

`scripts/checks/ciPolicy.ts` owns the path selection and gate verdict. A platform
job may be skipped only when successful change detection explicitly marked it
irrelevant. A failed, cancelled, missing, or unexpectedly skipped job fails the
gate. Workflow and dependency lockfile changes exercise every lane. Ordinary
feature-branch pushes no longer duplicate the pull-request CI run.

Require the aggregate gate rather than a path-filtered workflow: GitHub leaves
checks from skipped workflows pending, while skipped jobs can count as passing.
The aggregate checks the dependency results explicitly with `always()`.
See [GitHub's required-check guidance](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).

The shared `agent-tool pr merge` helper reads the core checks from
`merge.requiredChecks` in `agent-tool.json`. It independently requires them to
succeed in the CI workflow on the exact head it will merge, and rejects any
other reported failed or pending check. Missing checks and API errors stop the
merge. This also protects standalone helper calls; waiting only for whichever
checks a ruleset happens to require is insufficient. With
`merge.requireStrictBaseFreshness`, the helper also refuses to merge unless the
base's effective rules include an active strict status rule that the
authenticated actor cannot bypass. Update `agent-tool.json` together with the
ruleset when a required check name changes.

When introducing this gate, first verify a PR's Windows and aggregate results,
then update the ruleset to require the new check names. Existing PRs must adopt
the workflow change before they can satisfy the new gate. Preserve existing
signature, pull-request, deletion, and force-push protections when updating it.
