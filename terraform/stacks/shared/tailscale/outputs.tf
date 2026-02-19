output "vpn_access_principal" {
  description = "Policy group principal used in ACL policy for VPN access"
  value       = local.vpn_access_group_principal
}

output "vpn_gateway_tag" {
  description = "Tag used for VPN gateway devices"
  value       = var.vpn_gateway_tag
}

output "acl_policy_json" {
  description = "Rendered ACL policy JSON applied to the tailnet"
  value       = tailscale_acl.vpn_policy.acl
}

output "vpn_gateway_auth_key" {
  description = "Optional reusable auth key for VPN gateway bootstrap"
  value       = try(tailscale_tailnet_key.vpn_gateway[0].key, null)
  sensitive   = true
}
