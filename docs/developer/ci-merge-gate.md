# CI and merge requirements

The `protect-main` GitHub ruleset must require `CI gate`, `Lint`,
`Build and test`, `Postgres concurrency`, and
`windows / Windows CEF persistence` from the GitHub Actions app,
with strict base freshness and no bypass actors. The ruleset is repository
configuration; editing a workflow alone does not make a check required.

`CI gate` runs on every pull request and main-branch push. On every PR it
requires lint, workspace builds, TypeScript, package tests, the web build,
Postgres concurrency, and Windows CEF persistence to pass. It also waits for
native purchase bridge compiles, Lean proofs, and Terraform checks when their
paths change.
The platform workflows are reusable and keep their standalone manual dispatch
entry points. `Lint` passes pull-request names to
`agent-tool branch check --pre-push` as stdin ref tuples, so the policy also
applies to pull requests from clones without hooks.

The API, app, client SDK, and bob-and-alice suites run in `Test (...)` jobs of
their own, and `Build and test` runs the remaining package tests. The API suite
runs one backend per job, and every one of these suites splits into Bun shards
(`--shard=1/3` and so on); `ciPolicy.test.ts` checks that every backend's
shards are all present. The gate requires both jobs, so the suites need no
ruleset entries. Turbo hashes each shard's arguments, so shards cache
independently. Turbo serves cached
results from the GitHub Actions cache: a pull request reads entries written on
its own ref or on `main`, while `main` never reads an entry a pull request wrote.
The nightly `Uncached tests` workflow calls the entire CI workflow with
`force: true`, including Postgres, Windows, native bridge compiles, and
[protocol models](../../formal/README.md). Manual workflow dispatches also
bypass the cache.

CI runs the Postgres concurrency probe, Windows CEF persistence probe, and native
purchase bridge compiles as dedicated root Turbo tasks. Each caches a successful
verification without build artifacts, keyed on its workspace source dependencies
and external scripts. Windows and native tasks also hash the hosted
runner image version; Postgres hashes the service image. The native release tests
in `Lint` reuse the same `app-capacitor#test` task as `Build and test`.

The two pure TLC model passes run in the `Protocol models (...)` jobs, one per
pass, with `CI_TURBO_PROTOCOL_CACHE=1`; `Lint` skips them
(`CI_DEFER_PROTOCOL_MODELS=1`). Their inputs include the formal models,
registry, checker scripts, tool pins, and Java runtime identity. The wrapper
validates the installed Java version and jar digest before every lookup,
including cache hits. Implementation projections, conformance tests, and other
static checks still run in `Lint`.
The [pre-push](./static-analysis.md#ci-and-the-push-gate) gate also replays
cached passes, from its own checkout's Turbo cache. Local
[`check:fast`](./verification.md#before-a-push) and the direct model commands
still execute TLC.

Website-only source changes and website version bumps leave application test and
platform verification hashes unchanged, so ordinary website edits stay
independent without extracting application code. Shared UI changes invalidate
the website and app consumers; shared validators can also invalidate API and SDK
checks. Website deployment scripts are tested in `app-capacitor`, so changing
them invalidates its suite. Local screenshot captures feed only the website
build; CI does not recapture them.

A cache miss can still occur while `main` is producing a new result: a PR cannot
reuse another PR's cache or a task that has not finished. The
[GitHub cache access rules](https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows#restrictions-for-accessing-a-cache)
apply to the Turbo cache bridge. A PR that starts its long suites before the
preceding `main` run finishes executes them; a later run reuses the results.
A running job does not indicate a cache miss: a hit still runs the job and
replays the task log. The web application build is
uncached because it embeds the current Git commit.

[`scripts/checks/ciPolicy.ts`](../../scripts/checks/ciPolicy.ts) owns path
selection. The shared `agent-tool ci gate` command evaluates
[`scripts/checks/ciGate.json`](../../scripts/checks/ciGate.json), which declares
required jobs and binds conditional jobs to the classifier’s exact outputs. A
platform job may be skipped only when successful change detection explicitly
marked it irrelevant. A failed, cancelled, missing, or unexpectedly skipped job
fails the gate. Changes to workflows, CI scripts, tool pins, `package.json`, or
`bun.lock` exercise every lane. CI runs on pull requests and `main` pushes only,
so a feature-branch push does not duplicate the pull-request run.

Require the aggregate gate rather than a path-filtered workflow: GitHub leaves
checks from skipped workflows pending, while skipped jobs can count as passing.
The aggregate checks the dependency results explicitly with `always()`.
See [GitHub's required-check guidance](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).

The shared `agent-tool pr merge` helper reads the core checks from
`merge.requiredChecks` in `agent-tool.json`. It independently requires them to
succeed in the CI workflow on the exact head it will merge, and rejects any
other reported failed or pending check. Missing checks and API errors stop the
merge. This also protects standalone helper calls, where waiting only for the
checks a ruleset requires would be insufficient. With
`merge.requireStrictBaseFreshness`, the helper also refuses to merge unless the
base's effective rules include an active strict status rule that the
authenticated actor cannot bypass. Update `agent-tool.json` together with the
ruleset when a required check name changes.

`agent-tool pr checks --wait` waits up to `merge.checksTimeoutSeconds`, set to
3600. Uncached, the app and API `Test (...)` jobs each take about 20 minutes
and gate `CI gate`, so a whole run outlasts agent-tool's 15-minute default; a
wait that times out leaves checks pending and is not a CI failure. Pass
`--timeout <seconds>` only to override the policy for one wait.

When renaming or adding a required check, first verify that a PR reports it
under the new name, then update the ruleset and `agent-tool.json`. Open PRs
must merge the workflow change before they can satisfy the new gate. Preserve
the ruleset's signature, pull-request, deletion, and force-push protections
when updating it.
