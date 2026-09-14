# Static-analysis maintenance

Run `bun run check:fast` for the repository's analysis gates. The additional
`bun run test:static-analysis` fixtures exercise Git snapshot selection,
baseline validation, and shell-script discovery; they also run in `check:fast`
and pre-push.

## Source shape

`bun run lint:source-shape` checks tracked working files. `--staged` checks the
index, and `--range <base>..<head>` checks changed files in the right-hand commit.
Three-dot ranges use the merge base for the changed-file list and still read
the right-hand commit. Both partial modes read the baseline from the same Git
snapshot as the source. Unstaged edits cannot hide a committed violation or
grant an unstaged allowance. Renames check both the old and new path.

Changing `scripts/sourceShapeBaseline.json` triggers a full scan of the selected
snapshot, including unchanged source. The baseline rejects unknown fields,
invalid counts, empty or duplicate export allowances, and unused permissions.
Remove obsolete suppression counts and star-export specifiers when removing
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

Explicit exceptions live in `scripts/checks/shellScripts.ts`: the generated
Gradle wrapper and the two Ansible Jinja shell templates. The wrapper is
maintained upstream; the templates require rendering before shell analysis.
New templates or generated files need an explicit decision rather than a
directory-wide exclusion.

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
