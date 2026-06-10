output "server_ip" {
  description = "Public IPv4 address of the server"
  value       = aws_instance.server.public_ip
}

output "server_private_ip" {
  description = "Private IPv4 address of the server"
  value       = aws_instance.server.private_ip
}

output "server_status" {
  description = "Instance state"
  value       = aws_instance.server.instance_state
}

output "ssh_hostname" {
  description = "SSH hostname for server access"
  value       = "ssh.${var.domain}"
}

output "ssh_command" {
  description = "SSH command to connect"
  value       = "ssh ssh.${var.domain}"
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

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "security_group_id" {
  description = "Server security group ID"
  value       = aws_security_group.server.id
}
