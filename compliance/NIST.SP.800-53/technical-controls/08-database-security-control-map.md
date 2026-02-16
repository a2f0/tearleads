# Database Security Technical Control Map (NIST SP 800-53)

This map ties database security policy controls to concrete implementation and evidence per NIST SP 800-53 requirements.

## Sentinel Controls

| Sentinel | Description | NIST Controls | Implementation Evidence |
| --- | --- | --- | --- |
| `TL-DB-001` | RDS encryption at rest enabled | SC-28 | `terraform/modules/aws-rds-postgres/main.tf` |
| `TL-DB-002` | Automated RDS backups enabled | CP-9 | `terraform/modules/aws-rds-postgres/main.tf` |
| `TL-DB-003` | RDS deletion protection enabled | CP-9, SC-28 | `terraform/modules/aws-rds-postgres/main.tf` |
| `TL-NET-005` | RDS network isolation via security group | SC-7 | `terraform/modules/aws-rds-postgres/main.tf` |

## NIST Control Family Mapping

### SC - System and Communications Protection

- **SC-28**: Protection of Information at Rest - RDS encryption at rest (`TL-DB-001`).
- **SC-7**: Boundary Protection - RDS security group isolation (`TL-NET-005`).

### CP - Contingency Planning

- **CP-9**: Information System Backup - Automated RDS backups with retention (`TL-DB-002`).
- **CP-10**: Information System Recovery and Reconstitution - Backups support recovery objectives.

## SOC2 TSC Mapping

| Sentinel | NIST Control | Description |
| --- | --- | --- |
| `TL-DB-001` | SC-28 | Protection of information at rest |
| `TL-DB-002` | CP-9 | Information system backup |
| `TL-DB-003` | SC-28, CP-9 | Protection of assets and availability |
| `TL-NET-005` | SC-7 | Boundary protection |
