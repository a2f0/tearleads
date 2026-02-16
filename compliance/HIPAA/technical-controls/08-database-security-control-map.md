# Database Security Technical Control Map (HIPAA)

This map ties database security policy controls to HIPAA Security Rule requirements and implementation evidence.

## Sentinel Controls

| Sentinel | Description | HIPAA Standard | Implementation Evidence |
| --- | --- | --- | --- |
| `TL-DB-001` | RDS encryption at rest enabled | 164.312(a)(2)(iv) | `terraform/modules/aws-rds-postgres/main.tf` |
| `TL-DB-002` | Automated RDS backups enabled | 164.308(a)(7)(ii)(A) | `terraform/modules/aws-rds-postgres/main.tf` |
| `TL-DB-003` | RDS deletion protection enabled | 164.308(a)(7)(ii)(A) | `terraform/modules/aws-rds-postgres/main.tf` |
| `TL-NET-005` | RDS network isolation via security group | 164.312(e)(1) | `terraform/modules/aws-rds-postgres/main.tf` |

## HIPAA Standard Mapping

### 164.312(a)(2)(iv) - Encryption and Decryption

- Implementation of a mechanism to encrypt and decrypt ePHI (`TL-DB-001`).

### 164.308(a)(7)(ii)(A) - Data Backup Plan

- Establish and implement procedures to create and maintain retrievable exact copies of ePHI (`TL-DB-002`, `TL-DB-003`).

### 164.312(e)(1) - Transmission Security

- Guard against unauthorized access to ePHI being transmitted via network boundary controls (`TL-NET-005`).
