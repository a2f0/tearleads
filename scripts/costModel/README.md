# Cost Model Tooling

Infrastructure cost estimation and tracking for tearleads resources.

## Goals

1. **Parse Terraform declarations** - Extract resource types, sizes, and locations from `.tf` files
2. **Estimate costs** - Map resources to provider pricing (compute, storage, bandwidth, etc.)
3. **Track over time** - Take cost snapshots to monitor infrastructure spend
4. **User accounting** - Cross-reference with postgres database for per-user cost attribution

## Infrastructure Sources

| Directory | Provider | Resources | Bandwidth Cost |
|-----------|----------|-----------|----------------|
| `terraform/` | Hetzner Cloud | cx23 server, firewall, DNS | No |
| `tuxedo/terraform/` | Hetzner Cloud | Variable server type | No |
| `tee/` | Azure | Confidential VMs (DCasv5), VNet, KMS | Yes |

## Provider Pricing References

### Hetzner Cloud

- [Pricing page](https://www.hetzner.com/cloud)
- No egress/bandwidth charges
- Simple flat monthly rates per server type

### Azure Confidential VMs

- [Pricing page](https://azure.microsoft.com/en-us/pricing/details/virtual-machines/linux/)
- DCasv5-series pricing varies by region
- Bandwidth costs apply (egress charges per GB after free tier)
- Additional costs: Premium storage, Key Vault operations

## Architecture

```text
scripts/costModel/
├── README.md              # This file
├── index.ts               # Main entry point
├── commands/
│   ├── billing.ts         # User accounting reports
│   ├── live.ts            # Live server cost estimates
│   └── orphans.ts         # Find unmanaged AWS resources
├── providers/
│   ├── hetzner.ts         # Hetzner Cloud pricing data
│   └── azure.ts           # Azure pricing data
├── parsers/
│   └── terraform.ts       # Parse .tf files for resources
├── types.ts               # Shared type definitions
└── snapshots/             # Cost snapshot storage (gitignored JSON)
```

## Usage

```bash
# Estimate costs from live provisioned servers (recommended)
npx tsx scripts/costModel/index.ts live

# Estimate costs from terraform definitions
npx tsx scripts/costModel/index.ts estimate

# List active Hetzner servers
npx tsx scripts/costModel/index.ts servers

# Take a cost snapshot
npx tsx scripts/costModel/index.ts snapshot

# List saved snapshots
npx tsx scripts/costModel/index.ts list

# Scrape live pricing from provider APIs
npx tsx scripts/costModel/index.ts scrape

# Query user accounting from postgres (requires DB credentials)
npx tsx scripts/costModel/index.ts billing

# Find AWS resources not managed by Terraform (requires AWS CLI)
npx tsx scripts/costModel/index.ts orphans
npx tsx scripts/costModel/index.ts orphans us-west-2  # specify region
```

Or use the skill:

```text
/cost-model
```

## Database Credentials

The `billing` command requires a read-only postgres user. Set these environment variables:

```bash
export POSTGRES_READ_ONLY_USER=costmodel_ro  # default: costmodel_ro
export POSTGRES_READ_ONLY_PASSWORD=<password>  # required
export POSTGRES_DATABASE=<database>            # required
export POSTGRES_HOST=<host>                    # default: localhost
export POSTGRES_PORT=<port>                    # default: 5432
```

Provision the read-only user via your database bootstrap workflow before running billing reports.

## AWS Orphaned Resources

The `orphans` command finds AWS resources that exist in your account but are not managed by Terraform. This helps identify:

- Resources created manually that should be imported
- Leftover resources from deleted infrastructure
- Resources that may be incurring unexpected costs

### Prerequisites

- AWS CLI configured with appropriate credentials
- Access to the `tearleads-terraform-state` S3 bucket

### Resources Checked

| Resource Type | AWS API | Notes |
|---------------|---------|-------|
| S3 Buckets | `s3api list-buckets` | Global |
| ECR Repositories | `ecr describe-repositories` | Regional |
| RDS Instances | `rds describe-db-instances` | Regional |
| DynamoDB Tables | `dynamodb list-tables` | Skips terraform lock table |
| IAM Users | `iam list-users` | Global |
| IAM Roles | `iam list-roles` | Skips AWS service roles |
| Security Groups | `ec2 describe-security-groups` | Skips default SGs |
| Route53 Zones | `route53 list-hosted-zones` | Global |

## Future Work

- [ ] Scrape live pricing from provider APIs/CLIs
- [ ] Integrate with postgres user accounting tables
- [ ] Alerting on cost threshold breaches
- [ ] Historical cost trending dashboard
