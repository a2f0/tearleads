output "server_ip" {
  description = "IPv4 address of the k8s server"
  value       = aws_instance.server.public_ip
}

output "server_ipv6" {
  description = "IPv6 address of the k8s server"
  value       = null
}

output "server_private_ip" {
  description = "Private IPv4 address of the k8s server"
  value       = aws_instance.server.private_ip
}

output "server_status" {
  description = "Status of the server"
  value       = aws_instance.server.instance_state
}

output "k8s_hostname" {
  description = "K8s cluster hostname"
  value       = "k8s.${var.domain}"
}

output "k8s_api_hostname" {
  description = "Direct Kubernetes API hostname"
  value       = "k8s-api.${var.domain}"
}

output "ssh_command" {
  description = "SSH command to connect to the server"
  value       = "ssh k8s-ssh.${var.domain}"
}

output "ssh_hostname" {
  description = "SSH hostname for direct server access"
  value       = "k8s-ssh.${var.domain}"
}

output "kubeconfig_command" {
  description = "Command to fetch kubeconfig"
  value       = "scp k8s-ssh.${var.domain}:.kube/config ~/.kube/config-prod-k8s"
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

output "vpc_id" {
  description = "VPC ID for the prod k8s stack"
  value       = aws_vpc.k8s.id
}

output "k8s_subnet_cidr" {
  description = "CIDR block of the k8s server subnet"
  value       = aws_subnet.public_a.cidr_block
}

output "rds_subnet_ids" {
  description = "Private subnet IDs used by the prod RDS stack"
  value       = [aws_subnet.rds_a.id, aws_subnet.rds_b.id]
}

output "k8s_server_security_group_id" {
  description = "Security group ID for the prod k8s EC2 server"
  value       = aws_security_group.k8s_server.id
}
