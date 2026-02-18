---
name: cost-model
description: Infrastructure cost estimation and tracking
---


# Cost Model

Estimate and track infrastructure costs for Hetzner and Azure resources.

## Commands

### Live Infrastructure Costs (Recommended)

```bash
npx tsx scripts/costModel/index.ts live
```

Shows costs for **actual provisioned servers** from Hetzner plus terraform estimates for Azure.

### Estimate from Terraform

```bash
npx tsx scripts/costModel/index.ts estimate
```

Shows estimated monthly costs based on terraform definitions (may differ from live).

### Take a Cost Snapshot

```bash
npx tsx scripts/costModel/index.ts snapshot
```

Saves a timestamped JSON snapshot to `scripts/costModel/snapshots/`.

### List Snapshots

```bash
npx tsx scripts/costModel/index.ts list
```

Lists all saved cost snapshots.

### Scrape Live Pricing

```bash
npx tsx scripts/costModel/index.ts scrape
```

Fetches current pricing from Hetzner CLI and Azure Retail Prices API.

### List Active Servers

```bash
npx tsx scripts/costModel/index.ts servers
```

Lists currently provisioned Hetzner servers (requires `hcloud` CLI).

## Infrastructure Sources

| Directory           | Provider      | Resources                          |
| ------------------- | ------------- | ---------------------------------- |
| `terraform/`        | Hetzner Cloud | cx23 server, firewall, DNS         |
| `tuxedo/terraform/` | Hetzner Cloud | Variable server type               |
| `tee/`              | Azure         | Confidential VMs (DCasv5), VNet    |

### Query User Accounting

```bash
npx tsx scripts/costModel/index.ts billing
```

Requires database credentials:

```bash
export POSTGRES_READ_ONLY_USER=costmodel_ro
export POSTGRES_READ_ONLY_PASSWORD=<password>
export POSTGRES_DATABASE=<database>
export POSTGRES_HOST=<host>       # optional, default: localhost
export POSTGRES_PORT=<port>       # optional, default: 5432
```

## Notes

- Hetzner does NOT charge for bandwidth
- Azure charges for egress after 100 GB/month free tier
- Snapshots are gitignored to keep cost data local
- The `billing` command queries `organization_billing_accounts` and `ai_usage` tables
