output "server_id" {
  description = "ID of the server"
  value       = hcloud_server.main.id
}

output "server_name" {
  description = "Name of the server"
  value       = hcloud_server.main.name
}

output "ipv4_address" {
  description = "IPv4 address of the server"
  value       = hcloud_server.main.ipv4_address
}

output "ipv6_address" {
  description = "IPv6 address of the server (first address in /64 block)"
  value       = "${trimsuffix(hcloud_server.main.ipv6_network, "::/64")}::1"
}

output "ipv6_network" {
  description = "IPv6 /64 network assigned to the server"
  value       = hcloud_server.main.ipv6_network
}

output "status" {
  description = "Status of the server"
  value       = hcloud_server.main.status
}

output "firewall_id" {
  description = "ID of the firewall (if created)"
  value       = var.create_firewall ? hcloud_firewall.main[0].id : null
}
