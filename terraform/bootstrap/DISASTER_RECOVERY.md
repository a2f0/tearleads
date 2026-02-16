# Bootstrap Stack Disaster Recovery

This document describes how to recover the bootstrap Terraform state if it is lost or corrupted.

## What This Stack Contains

The bootstrap stack manages two critical AWS resources:

| Resource | Name | Purpose |
|----------|------|---------|
| S3 Bucket | `tearleads-terraform-state` | Stores state for all other stacks |
| DynamoDB Table | `tearleads-terraform-locks` | Provides state locking |

## Why Recovery Matters

- **Local state only**: Bootstrap uses local state (stored in `terraform.tfstate`) because it creates the S3 bucket that stores all other state
- **Chicken-and-egg**: We can't store bootstrap state in S3 before S3 exists
- **If lost**: Terraform loses track of these resources, but they still exist in AWS

## Scripts

| Script | Purpose |
|--------|---------|
| `./scripts/backup.sh` | Create a timestamped backup of current state |
| `./scripts/restore.sh` | Restore state from a backup (interactive) |
| `./scripts/recover.sh` | Full recovery: restore from backup OR re-import from AWS |

## Prevention

### Backup the State File

Run the backup script after any changes to the bootstrap stack:

```bash
./scripts/backup.sh
```

This creates timestamped, encrypted backups in multiple locations.

### Where Backups Are Stored

The backup script stores copies in:

1. `~/.terraform-backups/tearleads/` - Local encrypted backup
2. Optionally: 1Password, cloud storage, or other secure location (manual)

## Recovery Scenarios

### Scenario 1: State File Deleted or Corrupted (Backup Available)

**Symptoms**: `terraform plan` shows it wants to create resources that already exist

**Recovery**:

```bash
./scripts/restore.sh
```

This script will:

1. List available backups
2. Let you choose which one to restore
3. Validate the restored state

### Scenario 2: State File Lost, No Backup Available

**Recovery**:

```bash
./scripts/recover.sh
```

This script will:

1. Check if AWS resources still exist
2. Re-import them into a fresh state file
3. Validate the recovery with `terraform plan`
4. Create a backup of the recovered state

### Scenario 3: AWS Resources Accidentally Deleted

**This is catastrophic** - all other stacks would lose their state.

**Prevention**:

- `prevent_destroy` lifecycle rules are in place
- DynamoDB deletion protection is enabled
- S3 versioning allows object recovery

**If this happens**:

1. Restore S3 bucket from versioned objects (if bucket still exists)
2. Or restore from S3 cross-region replication (if configured)
3. Or recreate everything from scratch (last resort)

## Manual Recovery Steps

If the scripts don't work, here's the manual process:

### Step 1: Verify Resources Exist in AWS

```bash
# Check S3 bucket
aws s3api head-bucket --bucket tearleads-terraform-state

# Check DynamoDB table
aws dynamodb describe-table --table-name tearleads-terraform-locks
```

### Step 2: Remove Corrupted State

```bash
cd terraform/bootstrap
rm -f terraform.tfstate terraform.tfstate.backup
```

### Step 3: Reinitialize

```bash
terraform init
```

### Step 4: Import Resources

```bash
# Import S3 bucket
terraform import aws_s3_bucket.terraform_state tearleads-terraform-state

# Import S3 bucket versioning
terraform import aws_s3_bucket_versioning.terraform_state tearleads-terraform-state

# Import S3 bucket encryption
terraform import aws_s3_bucket_server_side_encryption_configuration.terraform_state tearleads-terraform-state

# Import S3 bucket public access block
terraform import aws_s3_bucket_public_access_block.terraform_state tearleads-terraform-state

# Import DynamoDB table
terraform import aws_dynamodb_table.terraform_locks tearleads-terraform-locks
```

### Step 5: Verify Recovery

```bash
terraform plan
```

Should show: `No changes. Your infrastructure matches the configuration.`

### Step 6: Backup the Recovered State

```bash
./scripts/backup.sh
```

## Testing Recovery

Periodically test the recovery process:

1. Copy current state to a temp location
2. Delete the state file
3. Run `./scripts/recover.sh`
4. Verify with `terraform plan`
5. Compare recovered state with backup

## Contact

If you encounter issues not covered here, the AWS resources can always be manually verified and re-imported as long as they exist in AWS.
