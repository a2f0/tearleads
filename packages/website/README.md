# Website deployment

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
packages/website/scripts/deployStagingWebsite.sh
packages/website/scripts/deployProductionWebsite.sh
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

`scripts/destroyStaging.sh` removes the server and S3 storage, then destroys the
website domain and deletes the staging Worker. For website-only teardown use
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
