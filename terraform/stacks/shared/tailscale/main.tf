provider "tailscale" {
  tailnet  = var.tailscale_tailnet_id
  api_key  = var.tailscale_api_token
  base_url = var.tailscale_base_url
}

locals {
  acl_policy = {
    groups = {
      "group:staging-access" = var.access_member_emails
      "group:prod-access"    = var.access_member_emails
    }
    tagOwners = {
      "tag:staging-vault" = ["autogroup:admin"]
      "tag:prod-vault"    = ["autogroup:admin"]
    }
    acls = [
      # Allow member-owned devices to communicate with each other
      {
        action = "accept"
        src    = ["autogroup:member"]
        dst    = ["autogroup:member:*"]
      },
      # Staging access: SSH and Vault API to staging-vault tagged devices
      {
        action = "accept"
        src    = ["group:staging-access"]
        dst    = ["tag:staging-vault:22", "tag:staging-vault:8200"]
      },
      # Prod access: SSH and Vault API to prod-vault tagged devices
      {
        action = "accept"
        src    = ["group:prod-access"]
        dst    = ["tag:prod-vault:22", "tag:prod-vault:8200"]
      }
    ]
  }
}

resource "tailscale_acl" "policy" {
  acl                        = jsonencode(local.acl_policy)
  overwrite_existing_content = var.overwrite_existing_acl
  reset_acl_on_destroy       = false
}

resource "tailscale_tailnet_key" "staging_vault" {
  count = var.create_staging_vault_auth_key ? 1 : 0

  description         = "terraform-staging-vault"
  reusable            = true
  preauthorized       = true
  ephemeral           = false
  tags                = ["tag:staging-vault"]
  expiry              = var.auth_key_expiry_seconds
  recreate_if_invalid = "always"
}

resource "tailscale_tailnet_key" "prod_vault" {
  count = var.create_prod_vault_auth_key ? 1 : 0

  description         = "terraform-prod-vault"
  reusable            = true
  preauthorized       = true
  ephemeral           = false
  tags                = ["tag:prod-vault"]
  expiry              = var.auth_key_expiry_seconds
  recreate_if_invalid = "always"
}
