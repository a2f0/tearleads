---
name: seo-optimization
description: Audit and improve how a repository's websites appear in search results and link previews, covering titles, descriptions, canonical URLs, Open Graph, structured data, robots.txt, sitemaps, status codes, and keeping non-production tiers out of search indexes. Use for an SEO audit or optimization pass, not copywriting or general feature work.
---

# SEO Optimization

Make every production page say what it is in the HTML that is served
before JavaScript runs, name one canonical URL, and be discoverable through
robots.txt and a sitemap. Keep every non-production tier out of search
indexes. Judge the deployed result, not the source: a correct template that
never reaches the live response is not a fix.

## Establish scope

Read the repository's instructions and the docs they point to, including
setup, validation, versioning, deployment, and title policy. Use the user's
scope. A report-only request stays read-only. An optimization pass may make
reversible changes in the repository and ship them through its normal
workflow when shipping is authorized; existing explicit authorization still
applies, so do not ask for it again. On a repeat pass, read the previous SEO
change and its docs, keep the decisions it recorded, and re-check what it
called compliant against the current standard; when it left no change,
audit from scratch.

This skill does not by itself authorize DNS changes, zone or CDN settings,
search console registration, store listings, or production content rewrites.
Write titles and descriptions from copy the site or repository already has.
Never invent product claims, platforms, prices, ratings, or reviews, and never
add links to store pages that are not live.

## Inventory hosts

List every public hostname the repository serves, by tier, from hosting
configuration (for example `wrangler.jsonc` routes), infrastructure code,
deploy workflows, and docs. Classify each one:

- **content**: marketing site, landing page, resume, or documentation that
  should rank. A standalone web tool with no separate marketing site is a
  content host for its landing page.
- **app**: an interactive application or app shell, often `app.*` or
  `demo.*`, whose marketing lives elsewhere.
- **internal**: admin dashboard, asset gallery, or API host. A package's
  viewer or demo site, whose pages other sites copy, is internal unless the
  repository or the user says it should rank; ask when it is unclear.
- **non-production**: staging, preview, or any other tier that is not the
  production site.

For each host, find how it is built and deployed. Note whether each tier has
its own build or one artifact is promoted, whether a merge deploys or a
person runs a command, and whether a Worker or server script answers some
responses itself. These facts decide where a tier-specific header can live.
Include hosts the platform adds on its own, such as `*.workers.dev` and
per-version preview URLs, which serve duplicate copies of the site.

Probe each host's current state with `agent-tool seo probe`, run through the
repository's pinned agent-tool: `bun run agent-tool seo probe <host> [path]`,
or `node_modules/.bin/agent-tool seo probe <host> [path]` where there is no
package script. It reports a page's title, description, canonical, robots
meta, `X-Robots-Tag`, Open Graph and Twitter tags, preview image, JSON-LD
types, and h1 count, then the site's robots.txt, sitemap, missing path, and
`http://` behavior. `--page` skips the site files;
`--headers <host> <path>...` prints one line per path without following
redirects, for checking headers on assets, redirects, and errors; `--links`
lists the page's internal links that do not answer 200 directly; and
`--sitemap` checks every sitemap URL's status, canonical, and robots, and
reports duplicate titles and descriptions. The mode flag comes first, the
host is a hostname with an optional port, and each path starts with `/`. The
probe matches text patterns rather than parsing HTML, so confirm anything
surprising in the raw response before acting on it. A `000` status means no
response, including a URL it refused to request: one that is not HTTP or
HTTPS, or one on a private or local address that a page or redirect, not the
command line, named. Set `SEO_PROBE_USER_AGENT` to a browser user agent to see
what a zone injects only for browsers.

Check whether the default branch already has merged work that has not been
deployed, because a deploy ships it too. Deployment listings often do not
name a commit. The strongest check is to build the default branch with
production settings and compare its files with the live ones byte for byte;
otherwise compare deploy times with merge times (for CI deploys, the head
commit of the deploy runs), read a version marker in the live HTML or bundle,
or run the repository's deploy verifier read-only. A deploy may also apply
database migrations; list pending ones read-only first.

## Apply the standard

Apply [references/standard.md](references/standard.md), which holds the
checklist for each host class; read "Every host" and the sections for the
classes you found. Its outcomes, in one line each:

- **Non-production**: noindex on every response and page, crawlable, no
  canonical or sitemap. Production is never noindexed, except its error page
  and paths deliberately kept out of search.
- **Content**: complete static head, preview image, structured data,
  robots.txt, sitemap, and real 404s.
- **App**: descriptive shell metadata and a real robots.txt; a canonical only
  when routes are not distinct public content.
- **Internal**: noindex for HTML surfaces; API hosts only when trivial.

Platform specifics live in
[references/cloudflare-workers.md](references/cloudflare-workers.md) (static
asset headers, trailing slashes, not-found handling, Cloudflare's managed
robots.txt) and [references/frameworks.md](references/frameworks.md) (Astro,
Next.js static export, Vite single-page apps, Bun's HTML bundler,
react-native-web, service workers, and `agent-tool images` for preview
images). Read the sections that match the repository.

Keep changes proportionate: metadata, robots, sitemaps, status codes, and
light heading or `alt` fixes on pages you touch. Record larger work, such as
prerendering JavaScript-only content, performance refactors, localized URL
trees, or redirects that need DNS, as recommendations.

## Validate and verify

Run the repository's full documented validation. Build every tier you
changed and inspect its output: each HTML `<head>`, `_headers` or equivalent,
robots.txt, the sitemap, and the preview image. Add tests where the
repository has a natural place for them:

- metadata is present in the static HTML with JavaScript disabled;
- the non-production build carries noindex and the production build does not;
- every sitemap URL equals the canonical URL of the page it lists;
- every internal link answers without a redirect;
- an unknown path returns 404 when served by the real hosting runtime, not a
  development server that answers every path with the app, and the error
  page's own URL (such as `/404`) carries noindex.

Before changing a title or description, search the tests for the old text.
Shell snippets added to docs must not use `path` as a variable name, because
zsh ties it to `PATH`.

After deploying, probe every host on every tier; the probe adds a
cache-busting query. Confirm that production carries no noindex in headers or
markup, that the preview image at the URL the page names answers 200 with an
image type and the declared size, and that every sitemap URL answers 200
without a redirect. Confirm that each non-production host sends the header
on HTML, assets, fallbacks, and redirects. Record what the CDN did to
robots.txt.

## Report

Use the repository's report convention, or put the evidence in the PR and
the final summary:

- hosts with their classification and live result, per tier;
- the changes made, and what was deliberately left unchanged, with reasons;
- recommendations ordered by impact, with an owner or the decision they need;
- questions that only the user can answer, such as whether user-generated
  public pages should be indexable, or which URL form legal pages should use.

Out-of-scope items belong in recommendations unless the user authorizes
them: search console and Bing Webmaster verification and sitemap submission,
infrastructure changes such as `www` redirects and zone settings (see
[references/cloudflare-workers.md](references/cloudflare-workers.md)), CDN
robots and AI-crawler settings, store links and smart app banners before
store IDs exist, app association files, and content or performance work.
Keep reusable procedure in this skill and dated findings in the report.

## Ownership

agent-tool (`a2f0/agent-tool`) owns this skill in `skills/seo-optimization/`,
and the `seo probe` command with its tests in `src/seo/`. Repositories get
the skill from `agent-tool skills install --apply`; do not edit the installed
copy. Change it in agent-tool by PR. A repository's hosts, tiers, and deploy
checks belong in its own docs.
