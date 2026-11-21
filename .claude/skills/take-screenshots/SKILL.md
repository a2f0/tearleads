---
name: take-screenshots
description: Capture a repository's app screenshots once into the shared matrix-artifacts store, so every clone builds and deploys the newest captures, and check a capture's provenance before a deploy. Use when asked to take, refresh, or check screenshots, before deploying a site or store listing that shows them, or when adding screenshot capture to a repository.
---

# Take Screenshots

Screenshots are captured once, in any clone, into the shared store's
`matrix-artifacts/<project>/screenshots`, beside the matrix workspace (or
beside the clone outside one). Every clone of the repository links its
gitignored `.screenshots` there, so a website deploy or
store upload in another clone publishes the same, newest captures without
recapturing. Brand images are not part of this: they render from
`assets/brand/*.svg` in each clone.

## Run it

`agent-tool screenshots status|link|capture` does the work; run the
repository's pinned agent-tool (`bun run agent-tool screenshots ...` or
`node_modules/.bin/agent-tool screenshots ...`). `link` and `capture` are dry
runs until `--apply`; `--json` gives agents the report.

- From any clone: `agent-tool screenshots <command>` covers that repository.
- From a matrix workspace: `agent-tool screenshots <command> [checkout...]`;
  with no names it covers every checkout that captures.
- If the pinned agent-tool predates these commands, run
  `bunx --bun @a2f0/agent-tool@latest screenshots <command>`.

| Command | Does |
| --- | --- |
| `status [repo...] [--all]` | Link state of each clone and its newest capture relative to HEAD |
| `link [repo...] [--all] [--apply] [--supersede]` | Point `.screenshots` at the store; moves an existing capture into an empty store, or with `--supersede` to `<project>/superseded/` |
| `capture [repo] [--apply] [--allow-dirty] [-- args...]` | Once its checks pass, link every clone of the store's projects that has no `.screenshots`, then run the repository's `screenshots` package script under the project lock and record `capture.json` |

`--all` selects every clone on this machine whose project the store already
holds, beside the store or in a matrix workspace's checkouts, worktrees
included: `link --all --apply` links them all in one run.

`MATRIX_ARTIFACTS_DIR` overrides the store location, and `--project <name>`
names the namespace of a repository without a GitHub origin. `status` exits 1
while a selected clone is not linked, `link` while one is blocked, and an
applied `capture` when it did not finish `complete`; each exits 2 when it
cannot run at all.

## Procedure

1. `status` first. If the clone is not `linked`, run `link`, then
   `link --apply`; `capture` links a clone with no `.screenshots` itself, and
   `status --all` or `link --all` covers every clone on this machine. A
   `blocked` result names what a person must decide (two
   different captures: compare their dates and commits, and if the store's is
   newer rerun with `--supersede`, a link that points elsewhere, a `.screenshots/` ignore
   pattern that needs its trailing slash removed in a PR).
2. Decide whether to capture. If the newest capture is `complete`, `merged`,
   and no screens changed since its commit, reuse it: that is the point of the
   store. Recapture after UI, seed data, or capture-code changes, after a
   `failed` capture, or when asked.
3. Commit first: capture refuses a dirty tree, because the shared store would
   publish uncommitted work. `--allow-dirty` is for a local-only look: it marks the
   capture `dirty`, which builds refuse, so recapture from a commit before
   anyone deploys.
4. Read the repository's capture docs for prerequisites (simulators, Maestro,
   Playwright browsers, seed data, mise-pinned tools). Maestro drives one
   device at a time on this machine: check for a running `maestro` first.
5. Run `capture` as a dry run, then with `--apply` through output capture
   (`agent-tool run --label screenshots -- agent-tool screenshots capture
   --apply`, with the repository's pinned agent-tool for both). Captures take
   minutes; run them in the background and do not start a second one for the
   same project (the lock refuses it).
6. Verify the result, not just the exit code: `status` shows `complete` at your
   commit, and spot-check a few images (open them; check light and dark, each
   layout, and the expected dimensions).
7. Report the capture's commit, whether it was partial (`args`), and which
   clones see it. Before a deploy, quote `status` for the deploying clone.

## Rules

- Never run a repository's `screenshots` package script directly for a shared
  capture; the lock and `capture.json` keep clones from publishing a partial
  or concurrent capture.
- Never commit screenshots, copy them into a repository, or delete the store.
  Never remove `.screenshots` itself; capture code clears files inside it.
- Builds and deploys never capture. `agent-tool screenshots build`, which
  stages screenshots into a website, reads `.screenshots/capture.json` before
  and after copying, and refuses `running`, `failed`, `incomplete`, or `dirty`
  captures and a record that changed meanwhile.
- Before a deploy that publishes screenshots, run `status` and report the
  capture's commit; recapture only when the screens it shows changed since.

## Adding capture to a repository

Follow `references/adding-capture.md`: the package script, ignore pattern, and
output layout every repository shares, and the Playwright (web) and Maestro
(native) patterns tearleads and nc use. In a matrix workspace, its audit checks
it with `bun run audit --rule screenshots-store`.

## Ownership

agent-tool (`a2f0/agent-tool`) owns this skill at `skills/take-screenshots/`
and the commands at `src/screenshots/store/`, with their tests beside them;
`agent-tool skills install --apply` installs it in each adopting repository.
The store's layout and record are described in its `docs/screenshots.md`.
Change them there, never in an installed copy.
