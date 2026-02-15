output "server_ip" {
  description = "IPv4 address of the Vault server"
  value       = module.server.ipv4_address
}

output "server_ipv6" {
  description = "IPv6 address of the Vault server"
  value       = module.server.ipv6_address
}

output "server_status" {
  description = "Status of the server"
  value       = module.server.status
}

output "vault_hostname" {
  description = "Vault server hostname"
  value       = "vault.${var.production_domain}"
}

output "vault_url" {
  description = "Vault API URL (via Cloudflare Tunnel)"
  value       = "https://vault.${var.production_domain}"
}

output "ssh_command" {
  description = "SSH command to connect to the server"
  value       = "ssh ${var.server_username}@${module.server.ipv4_address}"
}

output "server_username" {
  description = "Username for SSH access"
  value       = var.server_username
}

output "tunnel_id" {
  description = "Cloudflare tunnel ID"
  value       = module.tunnel.tunnel_id
}

output "tunnel_token" {
  description = "Cloudflare tunnel token (for cloudflared deployment)"
  value       = module.tunnel.tunnel_token
  sensitive   = true
}
