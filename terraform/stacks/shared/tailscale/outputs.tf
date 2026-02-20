output "acl_policy_json" {
  description = "Rendered ACL policy JSON applied to the tailnet"
  value       = tailscale_acl.policy.acl
}

output "staging_vault_auth_key" {
  description = "Reusable auth key for staging Vault bootstrap (tag:staging-vault)"
  value       = try(tailscale_tailnet_key.staging_vault[0].key, null)
  sensitive   = true
}

output "prod_vault_auth_key" {
  description = "Reusable auth key for production Vault bootstrap (tag:prod-vault)"
  value       = try(tailscale_tailnet_key.prod_vault[0].key, null)
  sensitive   = true
}
