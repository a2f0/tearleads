# Database Security Technical Control Map (SOC2)

This map ties database security policy controls to concrete implementation and test evidence.

## Sentinel Controls

| Sentinel | Description | Implementation Evidence | Test Evidence |
| --- | --- | --- | --- |
| `TL-DB-001` | RDS encryption at rest enabled using AWS managed keys | `terraform/modules/aws-rds-postgres/main.tf` | `terraform show -json \| jq '.values.root_module.resources[] \| select(.type == "aws_db_instance") \| .values.storage_encrypted'` |
| `TL-DB-002` | Automated RDS backups with 7-day retention period | `terraform/modules/aws-rds-postgres/main.tf` | `terraform show -json \| jq '.values.root_module.resources[] \| select(.type == "aws_db_instance") \| .values.backup_retention_period'` |
| `TL-DB-003` | RDS deletion protection enabled | `terraform/modules/aws-rds-postgres/main.tf` | `terraform show -json \| jq '.values.root_module.resources[] \| select(.type == "aws_db_instance") \| .values.deletion_protection'` |
| `TL-NET-005` | RDS network isolation via security group | `terraform/modules/aws-rds-postgres/main.tf` | `terraform show -json \| jq '.values.root_module.resources[] \| select(.type == "aws_security_group") \| .values.ingress'` |

## Control Details

### TL-DB-001: Encryption at Rest

**Implementation:**

- `storage_encrypted = true` in `aws_db_instance.main`
- Uses AWS KMS for transparent data encryption.

### TL-DB-002: Automated Backups

**Implementation:**

- `backup_retention_period = var.backup_retention_period` (default 7 days)
- `backup_window = "03:00-04:00"`
- Enables point-in-time recovery (PITR).

### TL-DB-003: Deletion Protection

**Implementation:**

- `deletion_protection = var.deletion_protection` (default true)
- Prevents the database from being deleted via Terraform or Console without explicitly disabling protection.

### TL-NET-005: Network Isolation

**Implementation:**

- `aws_security_group.rds` restricts ingress to `var.allowed_cidr_blocks`.
- Default egress is restricted.
- No public access unless `publicly_accessible` is explicitly set to true.

## SOC2 TSC Mapping

| Sentinel | TSC Controls | Rationale |
| --- | --- | --- |
| `TL-DB-001` | CC6.7 | Protection of data at rest |
| `TL-DB-002` | A1.2 | Availability and recovery capability |
| `TL-DB-003` | CC6.7, A1.2 | Protection against accidental or malicious deletion |
| `TL-NET-005` | CC6.6 | Boundary protection for data tier |
