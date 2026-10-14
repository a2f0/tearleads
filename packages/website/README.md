# Website deployment

For the Privacy Policy and Terms of Service publication status and revision
guidance, see the [legal publication review](./LEGAL_REVIEW.md).

The Astro website is built once per environment and served directly by Cloudflare
Workers Static Assets. It has no server runtime or dependency on the API server.

| Environment | Worker | Hostname | Terraform state |
| --- | --- | --- | --- |
| Production | `tearleads-website-prod` | `tearleads.com` | `prod/website/terraform.tfstate` |
| Staging | `tearleads-website-staging` | `website-staging.tearleads.com` | `staging/website/terraform.tfstate` |

Wrangler owns asset deployments; the independent Terraform roots in
`terraform/stacks/{prod,staging}/website` own custom domains. Rebuilding a server
leaves the website available. The API, application, and demo still use the server.

```sh
scripts/deployStagingWebsite.sh
scripts/deployProductionWebsite.sh
```

Each script loads `.secrets/root.env` and its tier environment, builds Astro with
the tier's application and billing URLs, publishes the Worker, then applies its
domain stack. A failed build or upload stops before changing the domain.
`--dry-run` builds, checks the Wrangler configuration and bundle, and plans
Terraform without uploading assets or publishing. `--skip-terraform` publishes
assets against an existing domain. Both commands select the Worker name from
the explicit Wrangler environment.

Cloudflare credentials use `TF_VAR_cloudflare_api_token` and
`TF_VAR_cloudflare_account_id`. The token needs Workers Scripts Edit, Workers
Routes Edit, and Zone Read for the target account/zone. Terraform also needs the
existing AWS credentials for its S3 backend. No SSH or Hetzner credentials are
needed for a standalone website deployment.

The full `scripts/deployStaging.sh` and `scripts/deployProduction.sh` include this
website deployment. Their `--skip-terraform` skips server/storage provisioning;
website domains still reconcile. Their `--skip-infra` also skips domain Terraform.

`scripts/destroyStaging.sh` removes the Workers, database, and R2 storage, then
destroys the website domain and deletes the staging Worker. For website-only
teardown use
`packages/website/scripts/destroyStagingWebsite.sh [--auto-approve]`. A failed
domain teardown leaves the Worker available. Server-only destruction preserves it.
The Terraform wrapper rejects production domain destruction before loading
credentials. Intentional production removal requires operating the root directly.

`public/_headers` keeps HTML and the screenshot manifest revalidating while Astro
bundles and versioned screenshots receive immutable browser caching. Wrangler
publishes assets and their cache headers together as a deployment.
Favicons also revalidate because their URLs are not versioned; this lets icon
updates reach returning browsers instead of retaining the old one for a year.
Cloudflare's [static asset documentation](https://developers.cloudflare.com/workers/static-assets/)
describes routing and deployment caching.

The homepage's macOS and Linux download links select the production or staging
R2 download domain using `PUBLIC_ENVIRONMENT`. Each build resolves download discovery
metadata into a matching pair of immutable installer and SHA-256 checksum URLs;
offline builds retain the verified first release. Build and upload
the matching release with `scripts/uploadMacosRelease.sh` or
`scripts/uploadLinuxRelease.sh` for production; use
`scripts/uploadMacosStagingRelease.sh` or `scripts/uploadLinuxStagingRelease.sh`
for staging. Run these from the repository root before deploying the website.
See the desktop instructions for
[macOS](../app-electrobun/README.md#macos-releases) and
[Linux from Docker](../app-electrobun/README.md#linux-releases-from-docker).

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
themes. Contacts include portraits; document details include the specimen
driver's license, passport, credit card (front and back), and birth certificate.
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
Workers Routes Edit and Zone Read, plus AWS credentials for its S3 backend.

Initial publishing is an operator task using existing production credentials.
Workers Scripts Edit grants account-wide edits, including the production API,
app, and website Workers; do not copy that token into continuity's CI secrets.
For later automation, use an account-owned token with Editor scoped only to the
existing `tearleads-continuity` Worker. See Cloudflare's
[Workers roles and scopes](https://developers.cloudflare.com/workers/authorization/workers/).
