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

output "merge_signing_app_installation_enabled" {
  description = "Whether Terraform manages merge-signing app installation on this repository"
  value       = var.enable_merge_signing_app_installation
}

output "merge_signing_app_installation_id" {
  description = "Configured merge-signing app installation ID"
  value = coalesce(
    var.merge_signing_app_installation_id,
    var.tearleads_version_bumper_installation_id,
    var.tearleads_version_bumper_installatio_id
  )
}

output "merge_signing_app_slug" {
  description = "Configured merge-signing app slug"
  value = coalesce(
    var.merge_signing_app_slug,
    var.tearleads_version_bumper_app_slug
  )
}

output "merge_signing_app_id" {
  description = "Configured merge-signing app ID"
  value = coalesce(
    var.merge_signing_app_id,
    var.tearleads_version_bumper_app_id
  )
}

output "merge_signing_app_node_id" {
  description = "GitHub App node ID when merge_signing_app_slug is provided"
  value       = try(data.github_app.merge_signing[0].node_id, null)
}

output "main_protection_mode" {
  description = "Whether main protections are managed by branch_protection or repository_ruleset"
  value       = var.use_repository_ruleset_for_main ? "repository_ruleset" : "branch_protection"
}

output "merge_signing_bypass_enabled" {
  description = "Whether merge-signing app bypass is enabled in repository ruleset mode"
  value       = var.enable_merge_signing_bypass
}
