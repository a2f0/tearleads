#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$HOME/.terraform-backups/tearleads"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Detect workspace and state file location
cd "$STACK_DIR"
WORKSPACE=$(terraform workspace show 2>/dev/null || echo "default")

if [[ "$WORKSPACE" == "default" ]]; then
  STATE_FILE="$STACK_DIR/terraform.tfstate"
else
  STATE_FILE="$STACK_DIR/terraform.tfstate.d/$WORKSPACE/terraform.tfstate"
fi

BACKUP_FILE="bootstrap-terraform-$WORKSPACE-$TIMESTAMP.tfstate"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "Bootstrap State Backup"
echo "======================"
echo ""
echo "Workspace: $WORKSPACE"
echo ""

# Check if state file exists
if [[ ! -f "$STATE_FILE" ]]; then
  echo -e "${RED}ERROR: State file not found at $STATE_FILE${NC}"
  echo "Has the bootstrap stack been applied?"
  exit 1
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Check if state has resources
RESOURCE_COUNT=$(jq '.resources | length' "$STATE_FILE" 2>/dev/null || echo "0")
if [[ "$RESOURCE_COUNT" == "0" ]]; then
  echo -e "${YELLOW}WARNING: State file contains no resources. Skipping backup.${NC}"
  exit 0
fi

echo "State file: $STATE_FILE"
echo "Resources in state: $RESOURCE_COUNT"
echo ""

# Create plain backup
cp "$STATE_FILE" "$BACKUP_DIR/$BACKUP_FILE"
echo -e "${GREEN}✓${NC} Backup created: $BACKUP_DIR/$BACKUP_FILE"

# Create encrypted backup if age is available
if command -v age &> /dev/null; then
  # Check for age identity
  AGE_IDENTITY="$HOME/.config/age/identity.txt"
  AGE_RECIPIENT="$HOME/.config/age/recipient.txt"

  if [[ -f "$AGE_RECIPIENT" ]]; then
    RECIPIENT=$(cat "$AGE_RECIPIENT")
    age -r "$RECIPIENT" -o "$BACKUP_DIR/$BACKUP_FILE.age" "$STATE_FILE"
    echo -e "${GREEN}✓${NC} Encrypted backup: $BACKUP_DIR/$BACKUP_FILE.age"

    # Remove unencrypted backup if encrypted exists
    rm "$BACKUP_DIR/$BACKUP_FILE"
    echo -e "${GREEN}✓${NC} Removed unencrypted backup (encrypted version saved)"
  else
    echo -e "${YELLOW}!${NC} age recipient not found at $AGE_RECIPIENT"
    echo "  To enable encrypted backups:"
    echo "    mkdir -p ~/.config/age"
    echo "    age-keygen -o ~/.config/age/identity.txt"
    echo "    age-keygen -y ~/.config/age/identity.txt > ~/.config/age/recipient.txt"
  fi
else
  echo -e "${YELLOW}!${NC} age not installed - backup is unencrypted"
  echo "  Install age for encrypted backups: brew install age"
fi

# Keep only last 5 backups
cd "$BACKUP_DIR"
ls -t bootstrap-terraform-*.tfstate* 2>/dev/null | tail -n +6 | xargs -r rm --
BACKUP_COUNT=$(ls -1 bootstrap-terraform-*.tfstate* 2>/dev/null | wc -l | tr -d ' ')
echo ""
echo "Backups retained: $BACKUP_COUNT (keeping last 5)"

echo ""
echo -e "${GREEN}Backup complete!${NC}"
echo ""
echo "Backup location: $BACKUP_DIR"
echo ""
echo "Recommended: Also store a copy in a secure location outside this machine:"
echo "  - 1Password / password manager"
echo "  - Encrypted cloud storage"
echo "  - Offline storage"
