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

output "tailscale_hostname" {
  description = "Vault server Tailscale hostname"
  value       = "vault-prod"
}

output "vault_url" {
  description = "Vault API URL (via Tailscale)"
  value       = "http://vault-prod:8200"
}

output "ssh_command" {
  description = "SSH command to connect to the server (via Tailscale)"
  value       = "ssh vault-prod"
}

output "server_username" {
  description = "Username for SSH access"
  value       = var.server_username
}
