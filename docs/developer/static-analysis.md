# Static-analysis maintenance

Run `bun run check:fast` for the repository's analysis gates. The additional
`bun run test:static-analysis` fixtures exercise Git snapshot selection,
baseline validation, and shell-script discovery; they also run in `check:fast`
and pre-push.

## CI and the push gate

CI's `check:fast` and pre-push run the same check list in
`scripts/checks/fastChecks.sh`. Add checks there so both gates pick them up.
Pre-push also checks the names of the branches a push creates or updates,
Terraform, TypeScript, affected tests, and the pushed commit ranges. Each check
retains its own push timing row. The branch check reads the pushed refs, not
the checked-out branch, so `git push origin HEAD:<name>` and detached pushes
are covered while deletions and tags are skipped. Hooks act only in a clone
where `install-hooks.sh` ran, so CI's `Lint` job checks every pull request's
branch name as well. Detached pre-commit checks skip only branch naming; the
file, source-shape, binary, and staged-content checks still run. Push through a
configured named remote such as `origin`; URL pushes fail before the full gate.

Both gates need the mise-pinned Java, TLA+, and oasdiff tools listed in
`AGENTS.md`, plus a fetched `origin/main` (or an explicit `OPENAPI_BASE_REF`).
The bounded protocol models add minutes to each push; use the timing log to
inspect the cost of individual checks.

`sh scripts/git/install-hooks.sh` installs the tracked hooks declared in
`agent-tool.json` through `agent-tool hooks install --apply`. On an existing
checkout, first compare the installed hooks with `scripts/git/hooks`, then run
`sh scripts/git/install-hooks.sh --adopt` once to migrate the inspected hooks.
The installer backs up replacements, records ownership, preserves unrelated
hooks, and refuses later local edits. `bun run agent-tool hooks check` detects
missing, edited, or stale copies. The installer honors repository/worktree
`core.hooksPath`; linked worktrees share the common Git directory by default.

`ship-pr` refreshes hooks through `reset` after a successful merge and
fast-forward. Pre-push refuses a stale installed copy; update the branch from
its base before reinstalling. Installing from an older branch can restore a
hook that predates the guard. Use
`scripts/git/showPushGateTimings.sh --head <sha>` to inspect each push.

Branch names and binary checks use shared agent-tool commands with the policy
in `agent-tool.json`. Commit trust checks require a present signature and reject
coauthor trailers on commits newly admitted to the push remote; commits already
reachable from any of that remote's branches are excluded. New branches also
exclude local `main`, preserving the baseline when a remote has no tracking refs.
Commit messages retain the full pinned commitlint rules; the committed message
is authoritative for the pre-push trailer check after Git's cleanup.
Binary and source-shape checks still inspect each pushed tree range.

OpenAPI compatibility exceptions expire when the comparison base contains the
new contract. Remove their entries from
`scripts/checks/openApiCompatibilityErrors.ignore` at that point; an unused
exception deliberately fails both gates.

## Source shape

`bun run lint:source-shape` checks tracked working files. `--staged` checks the
index, and `--range <base>..<head>` checks changed files in the right-hand commit.
Three-dot ranges use the merge base for the changed-file list and still read
the right-hand commit. Both partial modes read the baseline from the same Git
snapshot as the source. Unstaged edits cannot hide a committed violation or
grant an unstaged allowance. Renames check both the old and new path.

Changing `scripts/checks/sourceShapeBaseline.json` triggers a full scan of the
selected snapshot, including unchanged source. The baseline rejects unknown
fields, invalid counts, empty or duplicate export allowances, and unused
permissions. Remove obsolete suppression counts and star-export specifiers when
removing
the corresponding source constructs.

File-size allowances remain ceilings: shrinking an over-limit file does not
require updating its exact line and byte counts. Once a file fits the default
budget, remove its allowance. Increases still require reviewer context.

The old, unenforced `categories` metadata has moved out of the baseline. Its
rationale remains: holistic dependency-cruiser configuration and long-form
design/reference documents can warrant larger budgets when splitting would
obscure the relationships they describe. The numeric allowance is the enforced
policy; a category never exempts a file from checking.

## Canonical ordering

`bun run lint:canonical-ordering` scans `packages/crypto/src` and
`packages/client-sdk/src/data` (non-test sources) for `localeCompare` called
without a locale and for `Intl.Collator`. Everything sorted under those roots
feeds a hash, Merkle root, signed encoding, or stored identity, and locale
collation differs between runtimes, so two honest devices would disagree.
Sort with `compareCanonicalStrings` from `@tearleads/crypto` instead; a
display-only sort that genuinely needs collation must pass an explicit locale
and live outside these roots. Roots live in `scripts/checks/canonicalOrdering.ts`.

## Shell scripts

`bun run lint:scripts` and pre-push use the same `git ls-files` inventory. It
includes `.sh` files at any depth and shell shebangs, including extensionless
Git hooks. Filename spaces and newlines are preserved. Invoking from a
subdirectory still checks the repository root. The inventory reads only a file
prefix to identify shebangs and skips missing working files and directories.
Stage new files before running the command.

Explicit exceptions live in `scripts/checks/shellScripts.ts`: currently only
the generated Gradle wrapper, which is maintained upstream. New templates or
generated files need an explicit decision rather than a directory-wide
exclusion.

## Scope decision for issue #1441

Keep the existing production Knip dead-file check, scoped promise lint,
architecture checks, and on-demand CodeQL skill. The closeout fixes inaccurate
Git-content checking, stale allowances, shell coverage, and the dependencies
classified in [the audit record](dependency-audit.md).

Blanket strict Knip adoption, root-tooling/private-export expansion, exact
file-size ratcheting, full subsystem-table generation/validation, and grouped
dependency bots are intentionally not completion requirements. Add focused
architecture regression tests when changing important boundary rules; an
exhaustive fixture matrix is deferred. These are scope decisions, not claims
that the declined work was implemented.
