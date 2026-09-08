# Website deployment

The Astro website is built once per environment and served directly by Cloudflare
Workers Static Assets. It has no server runtime or dependency on the API server.

| Environment | Worker | Hostname | Terraform state |
| --- | --- | --- | --- |
| Production | `tearleads-website-prod` | `tearleads.com` | `prod/website/terraform.tfstate` |
| Staging | `tearleads-website-staging` | `website-staging.tearleads.com` | `staging/website/terraform.tfstate` |

These Worker names are separate from the legacy Stealth website Workers.
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
`--dry-run` builds and validates the Wrangler upload and Terraform plan without
publishing. `--skip-terraform` publishes assets against an existing domain.

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

For the initial migration, apply the updated server stacks to remove their
website tunnel DNS records before deploying the website domains. Existing A,
AAAA, or CNAME records must not compete with a Worker custom domain. The full
tier scripts already use this order. Ansible removes the obsolete website nginx
configuration and `/var/www/website` as part of the same migration.

`public/_headers` keeps HTML and the screenshot manifest revalidating while Astro
bundles and versioned screenshots receive immutable browser caching. Wrangler
publishes assets as a deployment, so website deploys no longer purge the old
origin cache. The server's former website cache rules are removed by Terraform.
Cloudflare's [static asset documentation](https://developers.cloudflare.com/workers/static-assets/)
describes routing and deployment caching.
