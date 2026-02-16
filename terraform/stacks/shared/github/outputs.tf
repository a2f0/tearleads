output "repository_url" {
  description = "GitHub repository URL"
  value       = github_repository.main.html_url
}

output "repository_ssh_clone_url" {
  description = "SSH clone URL"
  value       = github_repository.main.ssh_clone_url
}

output "repository_id" {
  description = "GitHub repository ID"
  value       = github_repository.main.repo_id
}

output "repository_node_id" {
  description = "GitHub repository node ID"
  value       = github_repository.main.node_id
}
