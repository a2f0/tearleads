---
name: validate-docs
description: Validate Tearleads documentation links, code references, and the website's published technical documents. Use after editing Markdown, renaming or moving files that docs cite, before a documentation release, or when asked to find broken or stale documentation links.
---

# Validate Docs

Check that every link in the repository's Markdown resolves, that published
documents link the code they cite, and that the website renders them. Keep
matching copies of this skill under `.agents/skills` and `.claude/skills`.
Read `AGENTS.md` for output capture and validation; the check itself is
documented in `docs/developer/static-analysis.md` under "Documentation links".

A validation request authorizes fixing broken links and linking code
references. Honor report-only requests. Shipping is separate: use `ship-pr`
only when requested.

## Offline checks

1. Run `bun run lint:doc-links`. It covers every tracked Markdown file except
   the managed skill copies: relative targets, heading fragments (GitHub slug
   rules), `#L<n>` line anchors, and links to this repository's `main` on
   GitHub. In `docs/` and `formal/` it also reports code spans that name a
   repository path without linking it.
2. For unlinked code references, run `bun run lint:doc-links -- --fix`, then
   `bun run lint:markdown`. The fix lengthens lines; rewrap any paragraph it
   pushes past 80 columns by hand, keeping each link on one line. Tables are
   exempt from the line limit.
3. For a missing target, find where the file went
   (`git log --diff-filter=R --name-status -- <old-path>` or a search for its
   symbols) and link the new location. Delete the sentence's reference only if
   the code no longer exists, and say so in the PR.
4. For a missing fragment, open the target and link the heading that now
   carries the content. A renamed heading breaks every inbound fragment; search
   for the old slug across the repository.
5. Code spans with braces (`{a,b}.ts`), globs, or placeholders are not checked.
   In published documents, prefer one link per file over brace notation.

## External links

Run `bun run lint:doc-links -- --external`. It probes each URL once and fails
only on 404, 410, or an unknown host. Treat `unverified` lines (401, 403, 429,
5xx, timeouts) as leads: open the page in a browser before changing it, since
many hosts reject automated requests for pages a reader can open. Pin links to
other repositories' files to a commit when the content they cite matters.

## Website

`packages/website/src/technicalDocs.ts` lists the documents published under
`/docs/`. After changing one of them or the list:

1. `bun run agent:run --label website-tests -- bun run --cwd packages/website test`
   builds the site and fails on root-relative links that miss a built file or
   pages that share a title or description.
2. For layout changes, build with
   `bun run --cwd packages/website build`, serve with `bunx --bun astro preview`
   from the package, and check a long document (keying design) and a
   table-heavy one (cipher suites) at desktop and 390-pixel widths in light and
   dark color schemes. The page must not scroll horizontally; wide tables
   scroll inside their own region.
3. A document outside `docs/*.md` and `formal/*.md` also needs a `build` and
   `test` input in `packages/website/turbo.json`.

## Report

List the commands run and their results, each fixed link with its old and new
target, references removed because the code is gone, and unverified external
URLs with what a browser showed.
