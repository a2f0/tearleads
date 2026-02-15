#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$HOME/.terraform-backups/tearleads"

# Detect workspace and state file location
cd "$STACK_DIR"
WORKSPACE=$(terraform workspace show 2>/dev/null || echo "default")

if [[ "$WORKSPACE" == "default" ]]; then
  STATE_FILE="$STACK_DIR/terraform.tfstate"
else
  STATE_FILE="$STACK_DIR/terraform.tfstate.d/$WORKSPACE/terraform.tfstate"
fi

# Resource identifiers
S3_BUCKET="tearleads-terraform-state"
DYNAMODB_TABLE="tearleads-terraform-locks"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo "Bootstrap State Recovery"
echo "========================"
echo ""
echo "Workspace: $WORKSPACE"
echo "State file: $STATE_FILE"
echo ""

# Check AWS credentials
if ! aws sts get-caller-identity &>/dev/null; then
  echo -e "${RED}ERROR: AWS credentials not configured or invalid${NC}"
  echo "Please configure AWS credentials and try again:"
  echo "  export AWS_ACCESS_KEY_ID=..."
  echo "  export AWS_SECRET_ACCESS_KEY=..."
  exit 1
fi

AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION="${AWS_REGION:-us-east-1}"
echo "AWS Account: $AWS_ACCOUNT"
echo "AWS Region: $AWS_REGION"
echo ""

# Check if state file already exists and has resources
if [[ -f "$STATE_FILE" ]]; then
  RESOURCE_COUNT=$(jq '.resources | length' "$STATE_FILE" 2>/dev/null || echo "0")
  if [[ "$RESOURCE_COUNT" != "0" ]]; then
    echo -e "${YELLOW}WARNING: State file already exists with $RESOURCE_COUNT resources${NC}"
    echo ""
    echo "Options:"
    echo "  1. Run 'terraform plan' to check if state is valid"
    echo "  2. Backup and remove the state file, then re-run this script"
    echo ""
    read -p "Continue anyway? This will overwrite existing state. [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Aborted."
      exit 1
    fi
  fi
fi

echo -e "${CYAN}Step 1: Verifying AWS resources exist...${NC}"
echo ""

# Check S3 bucket
echo -n "  S3 bucket ($S3_BUCKET): "
if aws s3api head-bucket --bucket "$S3_BUCKET" 2>/dev/null; then
  echo -e "${GREEN}exists${NC}"
else
  echo -e "${RED}NOT FOUND${NC}"
  echo ""
  echo "ERROR: S3 bucket does not exist. Cannot recover."
  echo "The bucket may have been deleted. You'll need to recreate the bootstrap stack."
  exit 1
fi

# Check DynamoDB table
echo -n "  DynamoDB table ($DYNAMODB_TABLE): "
if aws dynamodb describe-table --table-name "$DYNAMODB_TABLE" &>/dev/null; then
  echo -e "${GREEN}exists${NC}"
else
  echo -e "${RED}NOT FOUND${NC}"
  echo ""
  echo "ERROR: DynamoDB table does not exist. Cannot recover."
  echo "The table may have been deleted. You'll need to recreate the bootstrap stack."
  exit 1
fi

echo ""
echo -e "${CYAN}Step 2: Checking for local backups...${NC}"
echo ""

LATEST_BACKUP=""
if [[ -d "$BACKUP_DIR" ]]; then
  # Look for workspace-specific backups first, then any bootstrap backup
  LATEST_BACKUP=$(ls -t "$BACKUP_DIR"/bootstrap-terraform-"$WORKSPACE"-*.tfstate* 2>/dev/null | head -1 || true)
  if [[ -z "$LATEST_BACKUP" ]]; then
    LATEST_BACKUP=$(ls -t "$BACKUP_DIR"/bootstrap-terraform-*.tfstate* 2>/dev/null | head -1 || true)
  fi
fi

if [[ -n "$LATEST_BACKUP" ]]; then
  echo -e "  Found backup: ${GREEN}$LATEST_BACKUP${NC}"
  echo ""
  read -p "  Restore from backup instead of re-importing? [Y/n] " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    # Restore from backup
    if [[ "$LATEST_BACKUP" == *.age ]]; then
      echo "  Decrypting backup..."
      AGE_IDENTITY="$HOME/.config/age/identity.txt"
      if [[ ! -f "$AGE_IDENTITY" ]]; then
        echo -e "${RED}ERROR: age identity not found at $AGE_IDENTITY${NC}"
        echo "Cannot decrypt backup. Will proceed with re-import instead."
      else
        age -d -i "$AGE_IDENTITY" -o "$STATE_FILE" "$LATEST_BACKUP"
        echo -e "${GREEN}✓${NC} State restored from encrypted backup"
        echo ""
        echo -e "${CYAN}Step 3: Validating restored state...${NC}"
        cd "$STACK_DIR"
        terraform init -input=false
        if terraform plan -detailed-exitcode &>/dev/null; then
          echo -e "${GREEN}✓${NC} State is valid - no changes detected"
          echo ""
          echo -e "${GREEN}Recovery complete!${NC}"
          exit 0
        else
          echo -e "${YELLOW}!${NC} State may be outdated. Proceeding with re-import..."
        fi
      fi
    else
      cp "$LATEST_BACKUP" "$STATE_FILE"
      echo -e "${GREEN}✓${NC} State restored from backup"
      echo ""
      echo -e "${CYAN}Step 3: Validating restored state...${NC}"
      cd "$STACK_DIR"
      terraform init -input=false
      if terraform plan -detailed-exitcode &>/dev/null; then
        echo -e "${GREEN}✓${NC} State is valid - no changes detected"
        echo ""
        echo -e "${GREEN}Recovery complete!${NC}"
        exit 0
      else
        echo -e "${YELLOW}!${NC} State may be outdated. Proceeding with re-import..."
      fi
    fi
  fi
else
  echo "  No local backups found in $BACKUP_DIR"
fi

echo ""
echo -e "${CYAN}Step 3: Re-importing resources from AWS...${NC}"
echo ""

# Remove existing state and ensure directory exists
rm -f "$STATE_FILE" "$STATE_FILE.backup"
mkdir -p "$(dirname "$STATE_FILE")"

# Initialize Terraform
cd "$STACK_DIR"
echo "  Initializing Terraform..."
terraform init -input=false

# Import resources
echo ""
echo "  Importing S3 bucket..."
terraform import aws_s3_bucket.terraform_state "$S3_BUCKET"

echo ""
echo "  Importing S3 bucket versioning..."
terraform import aws_s3_bucket_versioning.terraform_state "$S3_BUCKET"

echo ""
echo "  Importing S3 bucket encryption..."
terraform import aws_s3_bucket_server_side_encryption_configuration.terraform_state "$S3_BUCKET"

echo ""
echo "  Importing S3 public access block..."
terraform import aws_s3_bucket_public_access_block.terraform_state "$S3_BUCKET"

echo ""
echo "  Importing DynamoDB table..."
terraform import aws_dynamodb_table.terraform_locks "$DYNAMODB_TABLE"

echo ""
echo -e "${CYAN}Step 4: Validating imported state...${NC}"
echo ""

# Run plan to verify
PLAN_OUTPUT=$(terraform plan -detailed-exitcode 2>&1) || PLAN_EXIT=$?
PLAN_EXIT=${PLAN_EXIT:-0}

if [[ $PLAN_EXIT -eq 0 ]]; then
  echo -e "${GREEN}✓${NC} State is valid - no changes detected"
elif [[ $PLAN_EXIT -eq 2 ]]; then
  echo -e "${YELLOW}!${NC} Minor drift detected. This is usually safe."
  echo "  Review with: terraform plan"
  echo "  Apply fixes with: terraform apply"
else
  echo -e "${RED}ERROR: Terraform plan failed${NC}"
  echo "$PLAN_OUTPUT"
  exit 1
fi

echo ""
echo -e "${CYAN}Step 5: Creating backup of recovered state...${NC}"
"$SCRIPT_DIR/backup.sh"

echo ""
echo -e "${GREEN}Recovery complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Review the state: terraform state list"
echo "  2. Verify no drift: terraform plan"
echo "  3. Store backup in a secure location"
