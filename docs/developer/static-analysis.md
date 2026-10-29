# Static-analysis maintenance

Run `bun run check:fast` for the repository's analysis gates. The additional
`bun run test:static-analysis` fixtures exercise Git snapshot selection,
baseline validation, and shell-script discovery; they also run in `check:fast`
and pre-push.

## CI and the push gate

CI's `check:fast` and pre-push run the same check list in
[`scripts/checks/fastChecks.sh`](../../scripts/checks/fastChecks.sh). Add checks
there so both gates pick them up. Pre-push also checks the names of the branches
a push creates or updates, Terraform, TypeScript, affected tests, and the pushed
commit ranges. Each check retains its own push timing row. The branch check
reads the pushed refs, not the checked-out branch, so `git push origin
HEAD:<name>` and detached pushes are covered while deletions and tags are
skipped. Hooks act only in a clone where `install-hooks.sh` ran, so CI's `Lint`
job checks every pull request's branch name as well. Detached pre-commit checks
skip only branch naming; the file, source-shape, binary, and staged-content
checks still run. Push through a configured named remote such as `origin`; URL
pushes fail before the full gate.

Both gates need the mise-pinned Java, TLA+, and oasdiff tools listed in
`AGENTS.md`, plus a fetched `origin/main` (or an explicit `OPENAPI_BASE_REF`).
The bounded protocol models add minutes to each push; use the timing log to
inspect the cost of individual checks.

`sh scripts/git/install-hooks.sh` installs the tracked hooks declared in
`agent-tool.json` through `agent-tool hooks install --apply`. On an existing
checkout, first compare the installed hooks with
[`scripts/git/hooks`](../../scripts/git/hooks/), then run `sh
scripts/git/install-hooks.sh --adopt` once to migrate the inspected hooks. The
installer backs up replacements, records ownership, preserves unrelated hooks,
and refuses later local edits. `bun run agent-tool hooks check` detects missing,
edited, or stale copies. The installer honors repository/worktree
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
exclude local `main`, so the check still has a baseline when the remote has no
tracking refs.
Commit messages retain the full pinned commitlint rules; the committed message
is authoritative for the pre-push trailer check after Git's cleanup.
Binary and source-shape checks still inspect each pushed tree range.

OpenAPI compatibility exceptions expire when the comparison base contains the
new contract. Remove their entries from
`scripts/checks/openApiCompatibilityErrors.ignore` (present only while an
exception is active) at that point; an unused exception deliberately fails both
gates.

## Harness permissions

`bun run agents:sync` installs the managed skills and then runs `agent-tool
permissions install --apply`, which writes Claude Code rules to
[`.claude/settings.json`](../../.claude/settings.json) and Codex rules to
[`.codex/rules/agent-tool.rules`](../../.codex/rules/agent-tool.rules) and
records what it owns in `.agent-tool-permissions.json`. Both allow routine
agent-tool commands. Merges, cleanup, dependency additions, publishing, and
permission changes get no Claude Code rule, so they follow each user's chosen
mode, while Codex prompts before them; the agent-tool [permissions
guide](https://github.com/a2f0/agent-tool/blob/43e8334cc4001442fb1faf6c14099dac8c1739a2/docs/permissions.md)
lists every class. The files are generated: do not edit or reformat them, and
rerun `agents:sync` after changing the agent-tool pin or `agent-tool.json`. `bun
run agents:check` runs `permissions check` after `skills check`, so
`check:fast`, CI's `Lint` job, and pre-push fail when the rules are missing,
edited, or stale.

`permissions.executables` in `agent-tool.json` classifies the installed CLIs
this repository's guidance runs directly. Agents run them as
`bun run agent-tool bun x <name> [--cwd <package>] -- [args...]`, which runs the
checkout's own `node_modules/.bin/<name>` with the pinned Bun. Use it in place
of a `bunx <name>` spelling in a guide: direct `bunx` and `bun x` are never
allowed, and Codex prompts before them, since they can download a package.

| Executable | Class | Installed in | Guidance |
| --- | --- | --- | --- |
| `tsc` | `local`: allowed | root | `AGENTS.md` and [client SDK seams](client-sdk-seams.md) type checks |
| `commitlint` | `local`: allowed | root | `AGENTS.md` PR title check |
| `cap` | `local`: allowed | [`packages/app-capacitor`](../../packages/app-capacitor/) | [Maestro](../../packages/app-capacitor/maestro/README.md) native syncs |
| `wrangler` | `release`: not allowed; Codex prompts | [`packages/api`](../../packages/api/), [`packages/app-web`](../../packages/app-web/), [`packages/website`](../../packages/website/) | [Worker deletion](greenfield-reset.md) and [log tails](api-request-cost.md); it can also deploy |

Classify a whole executable by its riskiest subcommand, and add a CLI here and
in `agent-tool.json` before guidance tells agents to run it. Package scripts are
not classified, so `bun run` and `agent:run` keep the harness default.

## Documentation links

`bun run lint:doc-links` (in `check:fast` and pre-push) reads every tracked
Markdown file except the managed skill copies and fails on:

- a relative link or image whose target is not a tracked file or directory,
  including targets Git ignores, which other checkouts lack;
- a fragment naming no heading or explicit anchor in its Markdown target
  (GitHub's slug rules), or a `#L<n>` line past the end of its target;
- a link to `https://github.com/a2f0/tearleads/{blob,tree}/main/...` whose
  path or fragment fails the same checks, since those links break on the next
  rename just as relative ones do;
- in [`docs/`](../) and [`formal/`](../../formal/), a code span naming an
  existing repository path that is not a link. Write
  [`packages/crypto/src/challenge.ts`](../../packages/crypto/src/challenge.ts),
  not a bare code span, so readers on GitHub and on the website can open the
  file. Spans with globs, braces, or placeholders are not checked.

`bun run lint:doc-links -- --fix` links those code spans; rewrap any line it
pushes past 80 columns before `lint:markdown`. `-- --external` also probes each
external URL once and fails only on answers that prove a link dead (404, 410,
or an unknown host); authorization walls, rate limits, and server errors are
printed as unverified. External probing needs the network, so it is not part of
any gate; run it when editing links and before a documentation release. Name
documents as arguments to check only those. The scanner reads a link's
destination from the line holding its `](`, so keep each destination on that
line. The `validate-docs` skill walks
through a full documentation review.

The website publishes the documents listed in
[`packages/website/src/technicalDocs.ts`](../../packages/website/src/technicalDocs.ts)
under `/docs/`. Its build rewrites their relative links to the published page or
to the file on GitHub, so a link that passes this check also works on the site.

## Source shape

`bun run lint:source-shape` checks tracked working files. `--staged` checks the
index, and `--range <base>..<head>` checks changed files in the right-hand commit.
Three-dot ranges use the merge base for the changed-file list and still read
the right-hand commit. Both partial modes read the baseline from the same Git
snapshot as the source. Unstaged edits cannot hide a committed violation or
grant an unstaged allowance. Renames check both the old and new path.

Changing
[`scripts/checks/sourceShapeBaseline.json`](../../scripts/checks/sourceShapeBaseline.json)
triggers a full scan of the selected snapshot, including unchanged source. The
baseline rejects unknown fields, invalid counts, empty or duplicate export
allowances, and unused permissions. Remove suppression counts and star-export
specifiers together with the source constructs they allow.

File-size allowances are ceilings: shrinking an over-limit file does not
require updating its exact line and byte counts. Once a file fits the default
budget, remove its allowance. Increases require reviewer context. Holistic
dependency-cruiser configuration and long-form design or reference documents
can warrant larger budgets when splitting would obscure the relationships they
describe; the numeric allowance is still the enforced limit.

## Canonical ordering

`bun run lint:canonical-ordering` scans
[`packages/crypto/src`](../../packages/crypto/src/) and
[`packages/client-sdk/src/data`](../../packages/client-sdk/src/data/) (non-test
sources) for `localeCompare` called without a locale and for `Intl.Collator`.
Everything sorted under those roots feeds a hash, Merkle root, signed encoding,
or stored identity, and locale collation differs between runtimes, so two honest
devices would disagree. Sort with `compareCanonicalStrings` from
`@tearleads/crypto` instead; a display-only sort that genuinely needs collation
must pass an explicit locale and live outside these roots. Roots live in
[`scripts/checks/canonicalOrdering.ts`](../../scripts/checks/canonicalOrdering.ts).

## Shell scripts

`bun run lint:scripts` and pre-push use the same `git ls-files` inventory. It
includes `.sh` files at any depth and shell shebangs, including extensionless
Git hooks. Filename spaces and newlines are preserved. Invoking from a
subdirectory still checks the repository root. The inventory reads only a file
prefix to identify shebangs and skips missing working files and directories.
Stage new files before running the command.

Explicit exceptions live in
[`scripts/checks/shellScripts.ts`](../../scripts/checks/shellScripts.ts); the
only one is the upstream-maintained Gradle wrapper,
[`packages/app-capacitor/android/gradlew`](../../packages/app-capacitor/android/gradlew).
New templates or generated files need an explicit decision rather than a
directory-wide exclusion.

## Scope

The gates include the production Knip dead-file check, the scoped promise
lint, and the architecture checks; CodeQL runs on demand through the
`run-code-ql-scan` skill, not in CI. Strict Knip mode, private-export checks for
root tooling, exact file-size ratcheting, full subsystem-table generation, and
grouped dependency bots are deliberately out of scope. Add focused architecture
regression tests when changing important boundary rules, rather than an
exhaustive fixture matrix. Dependency advisories are triaged in the
[dependency audit policy](dependency-audit.md).
