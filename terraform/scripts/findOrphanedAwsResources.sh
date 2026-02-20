#!/bin/bash
# Find AWS resources that exist in the account but are NOT managed by Terraform
#
# Usage: ./findOrphanedAwsResources.sh [--region us-east-1]
#
# Prerequisites:
#   - AWS CLI configured with appropriate credentials
#   - jq installed
#   - Access to the terraform state bucket

set -euo pipefail

# Configuration
STATE_BUCKET="tearleads-terraform-state"
DEFAULT_REGION="us-east-1"
REGION="${1:-$DEFAULT_REGION}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_orphan() { echo -e "${RED}[ORPHAN]${NC} $1"; }

# Temporary directory for state files
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# ============================================================================
# Step 1: Download all terraform state files and extract managed resources
# ============================================================================

log_info "Fetching terraform state files from s3://$STATE_BUCKET..."

declare -A MANAGED_RESOURCES

# List all state files in the bucket
STATE_KEYS=$(aws s3api list-objects-v2 \
  --bucket "$STATE_BUCKET" \
  --query "Contents[?ends_with(Key, '.tfstate')].Key" \
  --output text 2>/dev/null || echo "")

if [[ -z "$STATE_KEYS" ]]; then
  log_error "No state files found in s3://$STATE_BUCKET"
  exit 1
fi

# Download and parse each state file
for key in $STATE_KEYS; do
  log_info "Processing state: $key"

  state_file="$TEMP_DIR/$(echo "$key" | tr '/' '_')"
  aws s3 cp "s3://$STATE_BUCKET/$key" "$state_file" --quiet

  # Extract AWS resource identifiers from state
  # Format: type.name -> id/arn
  jq -r '
    .resources[]? |
    select(.type | startswith("aws_")) |
    .instances[]? |
    {type: .type, id: (.attributes.id // .attributes.arn // .attributes.name // empty)} |
    "\(.type):\(.id)"
  ' "$state_file" 2>/dev/null | while read -r resource; do
    MANAGED_RESOURCES["$resource"]=1
  done
done

# Export managed resources to a file for comparison
jq -r '
  .resources[]? |
  select(.type | startswith("aws_")) |
  .instances[]? |
  {type: .type, id: (.attributes.id // .attributes.arn // .attributes.name // empty)} |
  "\(.type):\(.id)"
' "$TEMP_DIR"/*.tfstate 2>/dev/null | sort -u > "$TEMP_DIR/managed_resources.txt"

MANAGED_COUNT=$(wc -l < "$TEMP_DIR/managed_resources.txt" | tr -d ' ')
log_info "Found $MANAGED_COUNT managed AWS resources in terraform state"

# ============================================================================
# Step 2: Query AWS for actual resources
# ============================================================================

ORPHAN_COUNT=0

is_managed() {
  local resource_type="$1"
  local resource_id="$2"
  grep -q "^${resource_type}:${resource_id}$" "$TEMP_DIR/managed_resources.txt" 2>/dev/null
}

# --- S3 Buckets ---
check_s3_buckets() {
  log_info "Checking S3 buckets..."
  local buckets
  buckets=$(aws s3api list-buckets --query 'Buckets[].Name' --output text 2>/dev/null || echo "")

  for bucket in $buckets; do
    if ! is_managed "aws_s3_bucket" "$bucket"; then
      log_orphan "S3 Bucket: $bucket"
      ((ORPHAN_COUNT++)) || true
    fi
  done
}

# --- ECR Repositories ---
check_ecr_repositories() {
  log_info "Checking ECR repositories..."
  local repos
  repos=$(aws ecr describe-repositories --query 'repositories[].repositoryName' --output text --region "$REGION" 2>/dev/null || echo "")

  for repo in $repos; do
    if ! is_managed "aws_ecr_repository" "$repo"; then
      log_orphan "ECR Repository: $repo"
      ((ORPHAN_COUNT++)) || true
    fi
  done
}

# --- RDS Instances ---
check_rds_instances() {
  log_info "Checking RDS instances..."
  local instances
  instances=$(aws rds describe-db-instances --query 'DBInstances[].DBInstanceIdentifier' --output text --region "$REGION" 2>/dev/null || echo "")

  for instance in $instances; do
    if ! is_managed "aws_db_instance" "$instance"; then
      log_orphan "RDS Instance: $instance"
      ((ORPHAN_COUNT++)) || true
    fi
  done
}

# --- DynamoDB Tables ---
check_dynamodb_tables() {
  log_info "Checking DynamoDB tables..."
  local tables
  tables=$(aws dynamodb list-tables --query 'TableNames[]' --output text --region "$REGION" 2>/dev/null || echo "")

  for table in $tables; do
    # Skip terraform state lock table
    if [[ "$table" == "tearleads-terraform-locks" ]]; then
      continue
    fi
    if ! is_managed "aws_dynamodb_table" "$table"; then
      log_orphan "DynamoDB Table: $table"
      ((ORPHAN_COUNT++)) || true
    fi
  done
}

# --- IAM Users ---
check_iam_users() {
  log_info "Checking IAM users..."
  local users
  users=$(aws iam list-users --query 'Users[].UserName' --output text 2>/dev/null || echo "")

  for user in $users; do
    if ! is_managed "aws_iam_user" "$user"; then
      log_orphan "IAM User: $user"
      ((ORPHAN_COUNT++)) || true
    fi
  done
}

# --- IAM Roles ---
check_iam_roles() {
  log_info "Checking IAM roles..."
  local roles
  roles=$(aws iam list-roles --query 'Roles[].RoleName' --output text 2>/dev/null || echo "")

  for role in $roles; do
    # Skip AWS service-linked roles and AWS-managed roles
    if [[ "$role" == AWSServiceRole* ]] || [[ "$role" == aws-* ]] || [[ "$role" == AWS* ]]; then
      continue
    fi
    if ! is_managed "aws_iam_role" "$role"; then
      log_orphan "IAM Role: $role"
      ((ORPHAN_COUNT++)) || true
    fi
  done
}

# --- Security Groups ---
check_security_groups() {
  log_info "Checking security groups..."
  local sgs
  sgs=$(aws ec2 describe-security-groups --query 'SecurityGroups[].GroupId' --output text --region "$REGION" 2>/dev/null || echo "")

  for sg in $sgs; do
    # Get the group name to skip default
    sg_name=$(aws ec2 describe-security-groups --group-ids "$sg" --query 'SecurityGroups[0].GroupName' --output text --region "$REGION" 2>/dev/null || echo "")
    if [[ "$sg_name" == "default" ]]; then
      continue
    fi
    if ! is_managed "aws_security_group" "$sg"; then
      log_orphan "Security Group: $sg ($sg_name)"
      ((ORPHAN_COUNT++)) || true
    fi
  done
}

# --- Route53 Hosted Zones ---
check_route53_zones() {
  log_info "Checking Route53 hosted zones..."
  local zones
  zones=$(aws route53 list-hosted-zones --query 'HostedZones[].Id' --output text 2>/dev/null || echo "")

  for zone in $zones; do
    zone_id=$(echo "$zone" | sed 's|/hostedzone/||')
    if ! is_managed "aws_route53_zone" "$zone_id"; then
      zone_name=$(aws route53 get-hosted-zone --id "$zone" --query 'HostedZone.Name' --output text 2>/dev/null || echo "unknown")
      log_orphan "Route53 Zone: $zone_id ($zone_name)"
      ((ORPHAN_COUNT++)) || true
    fi
  done
}

# ============================================================================
# Step 3: Run all checks
# ============================================================================

echo ""
log_info "Scanning AWS account for orphaned resources..."
echo ""

check_s3_buckets
check_ecr_repositories
check_rds_instances
check_dynamodb_tables
check_iam_users
check_iam_roles
check_security_groups
check_route53_zones

# ============================================================================
# Step 4: Summary
# ============================================================================

echo ""
echo "============================================"
if [[ $ORPHAN_COUNT -eq 0 ]]; then
  log_success "No orphaned AWS resources found!"
else
  log_warn "Found $ORPHAN_COUNT orphaned AWS resources not managed by Terraform"
  echo ""
  echo "These resources exist in AWS but are not in any terraform state file."
  echo "Consider:"
  echo "  1. Importing them into terraform: terraform import <resource> <id>"
  echo "  2. Deleting them if no longer needed"
  echo "  3. Adding them to an ignore list if intentionally unmanaged"
fi
echo "============================================"

exit $ORPHAN_COUNT
