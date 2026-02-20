output "alerts_group_email" {
  description = "Email address of the alerts distribution group"
  value       = var.alerts_group_enabled ? googleworkspace_group.alerts[0].email : null
}

output "group_emails" {
  description = "Map of managed group names to their email addresses"
  value = {
    for email, group in googleworkspace_group.groups :
    group.name => email
  }
}
