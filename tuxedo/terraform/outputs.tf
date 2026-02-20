locals {
  full_dns_hostname = "${var.dns_hostname}.${var.staging_domain}"
}

output "server_ip" {
  description = "Public IP address of the server"
  value       = hcloud_server.tuxedo.ipv4_address
}

output "server_status" {
  description = "Status of the server"
  value       = hcloud_server.tuxedo.status
}

output "server_name" {
  description = "Server name"
  value       = var.server_name
}

output "dns_hostname" {
  description = "DNS hostname pointing at the server"
  value       = local.full_dns_hostname
}

output "ssh_command" {
  description = "SSH command to connect to the server"
  value       = "ssh ${var.server_username}@${local.full_dns_hostname}"
}

output "server_username" {
  description = "Username for SSH access"
  value       = var.server_username
}

output "ssh_host_public_key" {
  description = "SSH host public key for known_hosts (ed25519)"
  value       = var.ssh_host_public_key
}

output "known_hosts_entry" {
  description = "Ready-to-use known_hosts entry for this server"
  value       = "${local.full_dns_hostname} ${var.ssh_host_public_key}"
}
