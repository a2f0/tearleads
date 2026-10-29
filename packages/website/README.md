# Website deployment

For the Privacy Policy and Terms of Service publication status and revision
guidance, see the [legal publication review](./LEGAL_REVIEW.md).

The Astro website is built once per environment and served directly by
Cloudflare Workers Static Assets. It has no server runtime and does not depend
on the API.

| Environment | Worker | Hostname | Terraform state |
| --- | --- | --- | --- |
| Production | `tearleads-website-prod` | `tearleads.com` | `prod/website/terraform.tfstate` |
| Staging | `tearleads-website-staging` | `website-staging.tearleads.com` | `staging/website/terraform.tfstate` |

Wrangler owns asset deployments; the independent Terraform roots in
`terraform/stacks/{prod,staging}/website` own custom domains.

```sh
scripts/deploy/deployStagingWebsite.sh
scripts/deploy/deployProductionWebsite.sh
```

Each script loads its tier's `.secrets/<tier>/shared.env` and `app.env`, builds
Astro with the tier's application and billing URLs, publishes the Worker, then
applies its domain stack. A failed build or upload stops before changing the domain.
`--dry-run` builds, checks the Wrangler configuration and bundle, and plans
Terraform without uploading assets or publishing. `--skip-terraform` publishes
assets against an existing domain. Both commands select the Worker name from
the explicit Wrangler environment.

Cloudflare credentials use `TF_VAR_cloudflare_api_token` and
`TF_VAR_cloudflare_account_id`. The token needs Workers Scripts Edit, Workers
Routes Edit, and Zone Read for the target account/zone; production's also needs
Zone Settings Edit, because its stack owns the zone's Always Use HTTPS setting
(see [public hostnames](../../docs/developer/infrastructure.md#public-hostnames)).
Terraform also needs the tier's R2 state key, `TF_STATE_ACCESS_KEY_ID` and
`TF_STATE_SECRET_ACCESS_KEY` in `app.env`. No other credentials are needed for
a standalone website deployment.

The full `scripts/deploy/deployStaging.sh` and
`scripts/deploy/deployProduction.sh` include this website deployment. Their
`--skip-terraform` (alias `--skip-infra`) skips every Terraform apply,
including the website domain; the Worker and its assets still deploy.

`scripts/deploy/destroyStaging.sh` and `scripts/deploy/destroyProduction.sh`
detach the edge hostnames and remove the API and app Workers, database, R2
storage, and desktop downloads, then destroy the website domain and delete the
tier's website Worker. Deleting a Worker also needs Workers KV Storage Read. For
a staging website-only teardown use
`packages/website/scripts/destroyWebsite.sh staging`; production runs only under
`scripts/deploy/destroyProduction.sh`. A failed domain teardown leaves the
Worker available. The Terraform wrapper rejects production domain destruction
before loading credentials, so the teardown applies a saved destroy plan
instead.

`public/_headers` keeps HTML and the screenshot manifest revalidating while Astro
bundles and versioned screenshots receive immutable browser caching. Wrangler
publishes assets and their cache headers together as a deployment.
Favicons also revalidate because their URLs are not versioned, so icon updates
reach returning browsers.
Cloudflare's [static asset documentation](https://developers.cloudflare.com/workers/static-assets/)
describes routing and deployment caching.

The homepage's macOS, Linux, and Windows download links select the production
or staging R2 download domain using `PUBLIC_ENVIRONMENT`. Each build resolves
download discovery metadata into a matching pair of immutable installer and
SHA-256 checksum URLs. When discovery is unavailable, macOS and Linux fall back
to a pinned, verified release and Windows hides its link. Publish the matching
release from the repository root before deploying the website; see the desktop
instructions for [macOS](../app-electrobun/README.md#macos-releases),
[Linux from Docker](../app-electrobun/README.md#linux-releases-from-docker), and
[Windows](../app-electrobun/README.md#windows-releases-from-github-actions).

## Technical documents

`/docs/` publishes the repository documents listed in `src/technicalDocs.ts`
(security guarantees, keying design, protocol specification, cipher suites,
protocol models, limits, and glossary). The Markdown under `docs/` and `formal/`
stays the source of truth: the `docs` content collection
(`src/content.config.ts`) reads it from the repository root at build time, and
`src/docLinksPlugin.ts`, a hast plugin on Astro's default Sätteri processor,
rewrites each relative link to the published page when its target is listed, or
to the file on GitHub's `main` otherwise. It also gives headings GitHub's ids,
so fragments behave as on GitHub, replaces each document's h1 with an anchor
(the page header renders the listed title), and wraps tables in a scrollable
region. Code blocks render unhighlighted to suit the grayscale theme.
`src/docsBuild.test.ts` builds the site and checks the rendered links. To
publish another document, add it to `technicalDocs` and, if it lives outside
`docs/*.md` and `formal/*.md`, to the `build` and `test` inputs in `turbo.json`.
Astro caches rendered entries by source digest and would not notice a plugin or
registry change, so `freshDocsCache` drops that cache at the start of every
build. `bun run lint:doc-links` validates the links in the source Markdown; see
[documentation
links](../../docs/developer/static-analysis.md#documentation-links).

## Search and link previews

Every page carries Open Graph and Twitter card tags and the `og-image.png`
preview that the agent-tool `website` image target renders from
`assets/brand`. Indexable pages also name their `https://tearleads.com`
canonical URL and `og:url`; staging pages and drafts carry a robots tag
instead. The home page adds a schema.org graph from `src/structuredData.ts`.
`src/seoIntegration.ts` writes the crawler files for the build's
`PUBLIC_ENVIRONMENT`: production gets `robots.txt` with its `Sitemap` line and
a `sitemap.xml` of every page's canonical URL; staging gets a `robots.txt`
without a sitemap, a `noindex, nofollow` robots tag on every page, and
`X-Robots-Tag: noindex, nofollow` added to the `/*` rule in the built
`_headers`. Staging never uses `Disallow`, which would hide the noindex from
crawlers.

Each screenshot route names its own screen and layout in its h1 and title,
and adds the captured themes in its description (`screenshotPageMeta` in
`src/components/screenshotsManifest.ts`). The gallery keeps the h1 and title
in step with the URL it rewrites as visitors move between screens. The build
test fails when a page lacks exactly one h1 or when two pages share a heading,
title, or description.

The home page loads only its first phone capture eagerly, at high priority,
because it is the hero's likely largest paint. Every other capture loads
lazily, and each image declares its capture's width and height so late images
never shift the layout.

Unknown paths answer 404 with `src/pages/404.astro`, through the Worker's
`not_found_handling: "404-page"`. The host redirects `/pricing` to `/pricing/`,
so internal links use the trailing-slash form that canonical URLs name, and the
build test fails on a root-relative link that would redirect or miss a file.

## Continuity gallery

### Local website screenshots

From the repository root, build the website with fresh screenshots:

```sh
bun install --frozen-lockfile
bun run build:website
bun run --cwd packages/website preview
```

`build:website` builds the SDK and SQLite prerequisites, creates an encrypted
backup from the commit-pinned `@a2f0/continuity` development dependency, restores
it through the app, and captures desktop, phone, and tablet in light and dark
themes. Phone and tablet captures are saved as device screens, with the
display's rounded corners transparent and without the in-app test banner; the
home page frames phone captures in a device bezel. Contacts include portraits;
document details include the fictional driver's license, passport, credit card
(front and back), and birth certificate.
Family photos, tools and appliances with multiple photos and purchase receipts,
and populated weight and blood pressure charts are captured as well.
Capture assertions use Continuity's expected names, note text, document titles,
and image counts. The separate two-peer authorship captures still exercise the
collaboration demo.

Astro stages these local `.screenshots/` files into its gallery and homepage
figures, then writes the site to `packages/website/dist/`. This command runs
locally and does not publish anything. For a site-only rebuild using the last
captures, run `bun run --cwd packages/website build`; without captures that
command renders the existing empty gallery state.

Use `bun run screenshots --project=web` for a desktop-only recapture or
`bun run screenshots:seed` to generate just `tearleads-seed.tlbackup.json` for
manual restore. PNGs and the backup stay gitignored. Update the Continuity SHA
in the root `package.json` catalog, run
`bun install`, then rebuild the screenshots and website to adopt new canon.
The website consumes PNGs and a manifest; it does not import application code.

### Standalone specimen gallery

The [continuity repository](https://github.com/a2f0/continuity) builds and
publishes the scrollable specimen gallery at `continuity.tearleads.com` with
Wrangler. Its domain has a separate stack, `terraform/stacks/prod/continuity`,
and state key, `prod/continuity/terraform.tfstate`; website and tier deploys do
not apply it. Publish `tearleads-continuity` first, then run:

```sh
terraform/scripts/run-continuity-stack.sh plan -out=/path/to/gallery.tfplan
terraform/scripts/run-continuity-stack.sh apply /path/to/gallery.tfplan
```

Subsequent gallery asset deployments do not need Terraform. The gallery sends
`noindex` in HTML and response headers. Publish the Worker into the tearleads.com
Cloudflare account (`TF_VAR_cloudflare_account_id`). The hostname stack needs
Workers Routes Edit and Zone Read, plus production's R2 state key.

Publishing the gallery is an operator task using production credentials.
Workers Scripts Edit grants account-wide edits, including the production API,
app, and website Workers; do not copy that token into continuity's CI secrets.
Automation should use an account-owned token with Editor scoped only to the
`tearleads-continuity` Worker. See Cloudflare's
[Workers roles and scopes](https://developers.cloudflare.com/workers/authorization/workers/).
