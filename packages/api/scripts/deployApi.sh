#!/bin/sh
set -eu

cd "$(dirname "$0")/../../.."

# Get server hostname from Terraform
HOSTNAME=$(cd terraform && terraform output -raw hostname)

if [ -z "$HOSTNAME" ]; then
  echo "Error: Could not get hostname from Terraform output"
  exit 1
fi

# Build shared package (API dependency)
pnpm --filter @rapid/shared build

# Build the API
pnpm --filter @rapid/api build

# Create deployment package
echo "Creating deployment package..."
DEPLOY_DIR=$(mktemp -d)
trap 'rm -rf "$DEPLOY_DIR"' EXIT

# Copy built API
cp -r packages/api/dist "$DEPLOY_DIR/"

# Copy package.json and remove workspace dependency (npm doesn't understand workspace: protocol)
jq 'del(.dependencies["@rapid/shared"])' packages/api/package.json > "$DEPLOY_DIR/package.json"

# Copy shared package (workspace dependency)
mkdir -p "$DEPLOY_DIR/node_modules/@rapid"
cp -r packages/shared/dist "$DEPLOY_DIR/node_modules/@rapid/shared"
cp packages/shared/package.json "$DEPLOY_DIR/node_modules/@rapid/shared/"

# Install production dependencies only
cd "$DEPLOY_DIR"
pnpm install --prod --ignore-scripts
cd -

# Upload to server
echo "Deploying to ${HOSTNAME}..."
rsync -avz --delete \
  -e "ssh -o StrictHostKeyChecking=no" \
  "$DEPLOY_DIR/" \
  "root@${HOSTNAME}:/opt/rapid-api/"

# Set ownership and restart service
ssh -o StrictHostKeyChecking=no "root@${HOSTNAME}" <<'REMOTE'
chown -R www-data:www-data /opt/rapid-api
chmod -R 755 /opt/rapid-api
systemctl restart rapid-api
systemctl --no-pager status rapid-api
REMOTE

# shellcheck disable=SC2154
echo "API deployed to https://api.${TF_VAR_domain}"
