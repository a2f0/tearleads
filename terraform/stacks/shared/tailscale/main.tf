provider "tailscale" {
  tailnet  = var.tailscale_tailnet_id
  api_key  = var.tailscale_api_token
  base_url = var.tailscale_base_url
}

locals {
  vpn_access_group_principal = "group:${var.vpn_access_group_name}"

  acl_policy = {
    groups = {
      (local.vpn_access_group_principal) = var.vpn_access_member_emails
    }
    tagOwners = {
      (var.vpn_gateway_tag) = ["autogroup:admin"]
    }
    acls = [
      {
        action = "accept"
        src    = [local.vpn_access_group_principal]
        dst    = ["${var.vpn_gateway_tag}:*"]
      }
    ]
  }
}

resource "tailscale_acl" "vpn_policy" {
  acl                        = jsonencode(local.acl_policy)
  overwrite_existing_content = var.overwrite_existing_acl
  reset_acl_on_destroy       = false
}

resource "tailscale_tailnet_key" "vpn_gateway" {
  count = var.create_vpn_gateway_auth_key ? 1 : 0

  description         = "terraform-vpn-gateway-bootstrap"
  reusable            = true
  preauthorized       = true
  ephemeral           = false
  tags                = [var.vpn_gateway_tag]
  expiry              = var.vpn_gateway_auth_key_expiry_seconds
  recreate_if_invalid = "always"
}
