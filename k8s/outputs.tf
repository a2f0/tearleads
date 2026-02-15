output "server_ip" {
  description = "Public IP address of the k8s server"
  value       = hcloud_server.k8s.ipv4_address
}

output "server_status" {
  description = "Status of the server"
  value       = hcloud_server.k8s.status
}

output "hostname" {
  description = "K8s server hostname"
  value       = "k8s.${var.domain}"
}

output "ssh_command" {
  description = "SSH command to connect to the server"
  value       = "ssh ${var.server_username}@k8s.${var.domain}"
}

output "server_username" {
  description = "Username for SSH access"
  value       = var.server_username
}

output "kubeconfig_command" {
  description = "Command to retrieve kubeconfig"
  value       = "./scripts/kubeconfig.sh > ~/.kube/config-k8s"
}
