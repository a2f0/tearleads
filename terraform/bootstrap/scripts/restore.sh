#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$HOME/.terraform-backups/tearleads"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Detect workspace and state file location
cd "$STACK_DIR"
WORKSPACE=$(terraform workspace show 2>/dev/null || echo "default")

if [[ "$WORKSPACE" == "default" ]]; then
  STATE_FILE="$STACK_DIR/terraform.tfstate"
else
  STATE_FILE="$STACK_DIR/terraform.tfstate.d/$WORKSPACE/terraform.tfstate"
fi

echo "Bootstrap State Restore"
echo "======================="
echo ""
echo "Workspace: $WORKSPACE"
echo "State file: $STATE_FILE"
echo ""

# Check for backups
if [[ ! -d "$BACKUP_DIR" ]]; then
  echo -e "${RED}ERROR: No backup directory found at $BACKUP_DIR${NC}"
  echo ""
  echo "No backups have been created yet. Run ./scripts/backup.sh first."
  exit 1
fi

# List available backups
echo -e "${CYAN}Available backups:${NC}"
echo ""

BACKUPS=($(ls -t "$BACKUP_DIR"/bootstrap-terraform-*.tfstate* 2>/dev/null || true))

if [[ ${#BACKUPS[@]} -eq 0 ]]; then
  echo -e "${RED}ERROR: No backups found in $BACKUP_DIR${NC}"
  echo ""
  echo "Run ./scripts/backup.sh to create a backup."
  exit 1
fi

# Display backups with numbers
for i in "${!BACKUPS[@]}"; do
  BACKUP_FILE="${BACKUPS[$i]}"
  BACKUP_NAME=$(basename "$BACKUP_FILE")
  BACKUP_DATE=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$BACKUP_FILE" 2>/dev/null || stat -c "%y" "$BACKUP_FILE" 2>/dev/null | cut -d. -f1)
  BACKUP_SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')

  if [[ "$BACKUP_FILE" == *.age ]]; then
    echo "  [$((i+1))] $BACKUP_NAME (encrypted, $BACKUP_SIZE, $BACKUP_DATE)"
  else
    echo "  [$((i+1))] $BACKUP_NAME ($BACKUP_SIZE, $BACKUP_DATE)"
  fi
done

echo ""
echo "  [0] Cancel"
echo ""

# Prompt for selection
read -p "Select backup to restore [1]: " SELECTION
SELECTION=${SELECTION:-1}

if [[ "$SELECTION" == "0" ]]; then
  echo "Cancelled."
  exit 0
fi

# Validate selection
if ! [[ "$SELECTION" =~ ^[0-9]+$ ]] || [[ "$SELECTION" -lt 1 ]] || [[ "$SELECTION" -gt ${#BACKUPS[@]} ]]; then
  echo -e "${RED}ERROR: Invalid selection${NC}"
  exit 1
fi

SELECTED_BACKUP="${BACKUPS[$((SELECTION-1))]}"
echo ""
echo "Selected: $(basename "$SELECTED_BACKUP")"
echo ""

# Confirm restore
if [[ -f "$STATE_FILE" ]]; then
  echo -e "${YELLOW}WARNING: This will overwrite the existing state file.${NC}"
  read -p "Continue? [y/N] " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
  fi
  echo ""
fi

# Create state directory if needed
mkdir -p "$(dirname "$STATE_FILE")"

# Restore the backup
echo -e "${CYAN}Restoring backup...${NC}"

if [[ "$SELECTED_BACKUP" == *.age ]]; then
  # Encrypted backup - need to decrypt
  AGE_IDENTITY="$HOME/.config/age/identity.txt"

  if [[ ! -f "$AGE_IDENTITY" ]]; then
    echo -e "${RED}ERROR: age identity not found at $AGE_IDENTITY${NC}"
    echo ""
    echo "Cannot decrypt backup. Make sure your age identity is available."
    exit 1
  fi

  age -d -i "$AGE_IDENTITY" -o "$STATE_FILE" "$SELECTED_BACKUP"
  echo -e "${GREEN}✓${NC} Decrypted and restored from: $(basename "$SELECTED_BACKUP")"
else
  # Plain backup - just copy
  cp "$SELECTED_BACKUP" "$STATE_FILE"
  echo -e "${GREEN}✓${NC} Restored from: $(basename "$SELECTED_BACKUP")"
fi

echo ""
echo -e "${CYAN}Validating restored state...${NC}"
echo ""

# Initialize terraform if needed
terraform init -input=false >/dev/null 2>&1 || true

# Validate with plan
PLAN_EXIT=0
terraform plan -detailed-exitcode >/dev/null 2>&1 || PLAN_EXIT=$?

if [[ $PLAN_EXIT -eq 0 ]]; then
  echo -e "${GREEN}✓${NC} State is valid - infrastructure matches"
elif [[ $PLAN_EXIT -eq 2 ]]; then
  echo -e "${YELLOW}!${NC} State restored but drift detected"
  echo ""
  echo "  The backup may be outdated. Review changes with:"
  echo "    terraform plan"
  echo ""
  echo "  To sync state with current infrastructure:"
  echo "    terraform apply"
else
  echo -e "${RED}!${NC} Validation failed - state may be corrupted"
  echo ""
  echo "  Try a different backup or use ./scripts/recover.sh to re-import from AWS"
fi

echo ""
echo -e "${GREEN}Restore complete!${NC}"
echo ""
echo "Commands:"
echo "  terraform state list    # View resources in state"
echo "  terraform plan          # Check for drift"
echo "  terraform apply         # Sync any changes"
