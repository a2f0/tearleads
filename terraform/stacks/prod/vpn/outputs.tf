output "server_ip" {
  description = "Public IPv4 address of the VPN server"
  value       = hcloud_server.vpn.ipv4_address
}

output "server_ipv6" {
  description = "Public IPv6 address of the VPN server"
  value       = hcloud_server.vpn.ipv6_address
}

output "server_private_ip" {
  description = "Private IP address in VPN network"
  value       = hcloud_server_network.vpn.ip
}

output "server_status" {
  description = "Status of the server"
  value       = hcloud_server.vpn.status
}

output "wireguard_port" {
  description = "WireGuard UDP port"
  value       = var.wireguard_port
}

output "wireguard_endpoint" {
  description = "WireGuard endpoint for clients"
  value       = "${hcloud_server.vpn.ipv4_address}:${var.wireguard_port}"
}

output "ssh_command" {
  description = "SSH command to connect to the server"
  value       = "ssh ${var.server_username}@${hcloud_server.vpn.ipv4_address}"
}

output "add_client_command" {
  description = "Command to add a new VPN client"
  value       = "sudo wg-add-client <client-name>"
}

output "network_id" {
  description = "Hetzner private network ID"
  value       = hcloud_network.vpn.id
}

output "server_username" {
  description = "Username for SSH access"
  value       = var.server_username
}
