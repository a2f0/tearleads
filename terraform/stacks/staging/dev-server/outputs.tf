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

output "hostname" {
  description = "Primary hostname"
  value       = var.staging_domain
}

output "ssh_command" {
  description = "SSH command to connect to the server"
  value       = "ssh ${var.server_username}@${module.server.ipv4_address}"
}

output "server_username" {
  description = "Username for SSH access"
  value       = var.server_username
}
