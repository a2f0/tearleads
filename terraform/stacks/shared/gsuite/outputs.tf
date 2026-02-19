output "groups" {
  description = "Managed groups keyed by group email"
  value = {
    for email, group in googleworkspace_group.groups :
    email => {
      id          = group.id
      name        = group.name
      description = group.description
      aliases     = group.aliases
    }
  }
}
