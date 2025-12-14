#!/bin/sh
set -e

TFC_API="https://app.terraform.io/api/v2"

check_var() {
  var_name="$1"
  eval "var_value=\$$var_name"
  if [ -z "$var_value" ]; then
    echo "Error: $var_name is not set."
    exit 1
  fi
}

CREDS_FILE="$HOME/.terraform.d/credentials.tfrc.json"
if [ ! -f "$CREDS_FILE" ]; then
  echo "Error: Not logged in. Run 'terraform login' first."
  exit 1
fi
TFE_TOKEN=$(jq -r '.credentials["app.terraform.io"].token' "$CREDS_FILE")
if [ "$TFE_TOKEN" = "null" ] || [ -z "$TFE_TOKEN" ]; then
  echo "Error: Not logged in. Run 'terraform login' first."
  exit 1
fi
check_var "TF_CLOUD_ORGANIZATION"
check_var "TF_WORKSPACE"
check_var "TF_VAR_hcloud_token"
check_var "TF_VAR_ssh_key_name"
check_var "TF_VAR_domain"

# Get workspace ID
WORKSPACE_ID=$(curl -s \
  --header "Authorization: Bearer $TFE_TOKEN" \
  --header "Content-Type: application/vnd.api+json" \
  "$TFC_API/organizations/$TF_CLOUD_ORGANIZATION/workspaces/$TF_WORKSPACE" | \
  jq -r '.data.id')

if [ "$WORKSPACE_ID" = "null" ] || [ -z "$WORKSPACE_ID" ]; then
  echo "Error: Could not find workspace $TF_WORKSPACE in org $TF_CLOUD_ORGANIZATION"
  exit 1
fi

echo "Found workspace: $WORKSPACE_ID"

set_variable() {
  var_key="$1"
  var_value="$2"
  sensitive="$3"

  # Check if variable already exists
  existing=$(curl -s \
    --header "Authorization: Bearer $TFE_TOKEN" \
    "$TFC_API/workspaces/$WORKSPACE_ID/vars" | \
    jq -r ".data[] | select(.attributes.key == \"$var_key\") | .id")

  payload=$(cat <<EOF
{
  "data": {
    "type": "vars",
    "attributes": {
      "key": "$var_key",
      "value": "$var_value",
      "category": "terraform",
      "hcl": false,
      "sensitive": $sensitive
    }
  }
}
EOF
)

  if [ -n "$existing" ]; then
    # Update existing variable
    curl -s \
      --header "Authorization: Bearer $TFE_TOKEN" \
      --header "Content-Type: application/vnd.api+json" \
      --request PATCH \
      --data "$payload" \
      "$TFC_API/workspaces/$WORKSPACE_ID/vars/$existing" > /dev/null
    echo "Updated: $var_key"
  else
    # Create new variable
    payload=$(cat <<EOF
{
  "data": {
    "type": "vars",
    "attributes": {
      "key": "$var_key",
      "value": "$var_value",
      "category": "terraform",
      "hcl": false,
      "sensitive": $sensitive
    },
    "relationships": {
      "workspace": {
        "data": {
          "id": "$WORKSPACE_ID",
          "type": "workspaces"
        }
      }
    }
  }
}
EOF
)
    curl -s \
      --header "Authorization: Bearer $TFE_TOKEN" \
      --header "Content-Type: application/vnd.api+json" \
      --request POST \
      --data "$payload" \
      "$TFC_API/vars" > /dev/null
    echo "Created: $var_key"
  fi
}

set_variable "hcloud_token" "$TF_VAR_hcloud_token" "true"
set_variable "ssh_key_name" "$TF_VAR_ssh_key_name" "false"
set_variable "domain" "$TF_VAR_domain" "false"

echo ""
echo "All Terraform Cloud variables have been set successfully!"
