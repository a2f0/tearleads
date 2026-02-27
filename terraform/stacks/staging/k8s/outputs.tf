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
  value       = "k8s.${var.domain}"
}

output "k8s_api_hostname" {
  description = "K8s API hostname"
  value       = "k8s-api.${var.domain}"
}

output "ssh_command" {
  description = "SSH command to connect to the server"
  value       = "ssh ${local.tailscale_hostname}"
}

output "ssh_hostname" {
  description = "SSH hostname for direct server access (via Tailscale MagicDNS)"
  value       = local.tailscale_hostname
}

output "kubeconfig_command" {
  description = "Command to fetch kubeconfig"
  value       = "scp ${local.tailscale_hostname}:.kube/config ~/.kube/config-staging-k8s"
}

output "server_username" {
  description = "Username for SSH access"
  value       = var.server_username
}

output "SERVER_USERNAME" {
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

output "cloudflare_zone_nameservers" {
  description = "Cloudflare authoritative nameservers for the staging zone"
  value       = data.cloudflare_zone.staging.name_servers
}

output "tailscale_hostname" {
  description = "Tailscale hostname for the k8s server"
  value       = local.tailscale_hostname
}

output "tailscale_auth_key" {
  description = "Tailscale auth key for k8s server (passthrough from shared stack)"
  value       = data.terraform_remote_state.tailscale.outputs.staging_k8s_auth_key
  sensitive   = true
}
