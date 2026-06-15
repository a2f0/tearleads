output "server_ip" {
  description = "IPv4 address of the server"
  value       = module.server.ipv4_address
}

output "server_ipv6" {
  description = "IPv6 address of the server"
  value       = module.server.ipv6_address
}

output "server_status" {
  description = "Status of the server"
  value       = module.server.status
}

output "ssh_command" {
  description = "SSH command to connect (via Tailscale MagicDNS)"
  value       = "ssh ${local.tailscale_hostname}"
}

output "ssh_hostname" {
  description = "Tailscale hostname for server access"
  value       = local.tailscale_hostname
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
  description = "Cloudflare tunnel token"
  value       = module.tunnel.tunnel_token
  sensitive   = true
}

output "s3_endpoint" {
  description = "Public Garage S3-compatible endpoint"
  value       = "https://s3.${var.domain}"
}

output "cloudflare_zone_nameservers" {
  description = "Cloudflare authoritative nameservers"
  value       = data.cloudflare_zone.production.name_servers
}

output "tailscale_hostname" {
  description = "Tailscale hostname for the server"
  value       = local.tailscale_hostname
}
