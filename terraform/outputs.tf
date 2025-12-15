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
  value       = "example.${var.domain}"
}

output "ssh_command" {
  description = "SSH command to connect to the server"
  value       = "ssh root@example.${var.domain}"
}
