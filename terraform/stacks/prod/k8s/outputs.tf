output "server_ip" {
  description = "IPv4 address of the k8s server"
  value       = module.server.ipv4_address
}

output "server_ipv6" {
  description = "IPv6 address of the k8s server"
  value       = module.server.ipv6_address
}

output "server_status" {
  description = "Status of the server"
  value       = module.server.status
}

output "k8s_hostname" {
  description = "K8s cluster hostname"
  value       = "k8s.${var.production_domain}"
}

output "ssh_command" {
  description = "SSH command to connect to the server"
  value       = "ssh k8s-ssh.${var.production_domain}"
}

output "ssh_hostname" {
  description = "SSH hostname for direct server access"
  value       = "k8s-ssh.${var.production_domain}"
}

output "kubeconfig_command" {
  description = "Command to fetch kubeconfig"
  value       = "scp k8s-ssh.${var.production_domain}:.kube/config ~/.kube/config-prod-k8s"
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
