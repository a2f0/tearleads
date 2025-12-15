output "server_ip" {
  description = "Public IP address of the server"
  value       = hcloud_server.main.ipv4_address
}

output "server_status" {
  description = "Status of the server"
  value       = hcloud_server.main.status
}

output "hostname" {
  description = "Server hostname"
  value       = var.domain
}

output "ssh_command" {
  description = "SSH command to connect to the server"
  value       = "ssh ${var.server_username}@${var.domain}"
}

output "server_username" {
  description = "Username for SSH access"
  value       = var.server_username
}
