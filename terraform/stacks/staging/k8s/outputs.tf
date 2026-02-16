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
  value       = "k8s.${var.staging_domain}"
}

output "ssh_command" {
  description = "SSH command to connect to the server"
  value       = "ssh ${var.server_username}@${module.server.ipv4_address}"
}

output "kubeconfig_command" {
  description = "Command to fetch kubeconfig"
  value       = "scp ${var.server_username}@${module.server.ipv4_address}:.kube/config ~/.kube/config-staging-k8s"
}

output "SERVER_USERNAME" {
  description = "Username for SSH access"
  value       = var.server_username
}
