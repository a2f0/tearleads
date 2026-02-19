provider "googleworkspace" {
  customer_id             = var.googleworkspace_customer_id
  access_token            = var.googleworkspace_access_token
  impersonated_user_email = var.googleworkspace_impersonated_user_email
  service_account         = var.googleworkspace_service_account
  credentials             = var.googleworkspace_credentials
  oauth_scopes            = var.googleworkspace_oauth_scopes
}

resource "googleworkspace_group" "groups" {
  for_each = var.googleworkspace_groups

  email       = each.key
  name        = each.value.name
  description = try(each.value.description, null)
  aliases     = each.value.aliases
}
