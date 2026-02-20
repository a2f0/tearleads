provider "googleworkspace" {
  customer_id             = var.googleworkspace_customer_id
  access_token            = var.googleworkspace_access_token
  impersonated_user_email = var.googleworkspace_impersonated_user_email
  service_account         = var.googleworkspace_service_account
  credentials             = var.googleworkspace_credentials
  oauth_scopes            = var.googleworkspace_oauth_scopes
}

locals {
  strict_group_settings_defaults = {
    allow_external_members         = false
    allow_web_posting              = false
    include_in_global_address_list = false
    who_can_join                   = "INVITED_CAN_JOIN"
    who_can_discover_group         = "ALL_MEMBERS_CAN_DISCOVER"
    who_can_view_group             = "ALL_MEMBERS_CAN_VIEW"
    who_can_view_membership        = "ALL_MEMBERS_CAN_VIEW"
    who_can_post_message           = "ALL_MEMBERS_CAN_POST"
    who_can_contact_owner          = "ALL_MEMBERS_CAN_CONTACT"
    who_can_leave_group            = "ALL_MEMBERS_CAN_LEAVE"
  }

  effective_group_settings = {
    for email, group in var.googleworkspace_groups :
    email => merge(
      local.strict_group_settings_defaults,
      try(var.googleworkspace_group_settings_overrides[email], tomap({}))
    )
  }
}

resource "googleworkspace_group" "groups" {
  for_each = var.googleworkspace_groups

  email       = each.key
  name        = each.value.name
  description = try(each.value.description, null)
  aliases     = each.value.aliases
}

resource "googleworkspace_group_settings" "groups" {
  for_each = local.effective_group_settings

  email = googleworkspace_group.groups[each.key].email

  allow_external_members         = each.value.allow_external_members
  allow_web_posting              = each.value.allow_web_posting
  include_in_global_address_list = each.value.include_in_global_address_list
  who_can_join                   = each.value.who_can_join
  who_can_discover_group         = each.value.who_can_discover_group
  who_can_view_group             = each.value.who_can_view_group
  who_can_view_membership        = each.value.who_can_view_membership
  who_can_post_message           = each.value.who_can_post_message
  who_can_contact_owner          = each.value.who_can_contact_owner
  who_can_leave_group            = each.value.who_can_leave_group
}

# =============================================================================
# Alerts Distribution Group
# Locked-down group for receiving system alerts (AWS billing, monitoring, etc.)
# =============================================================================

resource "googleworkspace_group" "alerts" {
  count = var.alerts_group_enabled ? 1 : 0

  email       = "alerts@${var.googleworkspace_domain}"
  name        = "System Alerts"
  description = "Receives automated alerts from AWS, monitoring systems, and infrastructure"
}

resource "googleworkspace_group_settings" "alerts" {
  count = var.alerts_group_enabled ? 1 : 0

  email = googleworkspace_group.alerts[0].email

  # Allow external services (AWS SNS, etc.) to send to this group
  allow_external_members = false
  who_can_post_message   = "ANYONE_CAN_POST"

  # Lock down membership - invite only, no self-service
  who_can_join        = "INVITED_CAN_JOIN"
  who_can_leave_group = "NONE_CAN_LEAVE"

  # Hide from discovery - members only (most restrictive available)
  include_in_global_address_list = false
  who_can_discover_group         = "ALL_MEMBERS_CAN_DISCOVER"
  who_can_view_group             = "ALL_MEMBERS_CAN_VIEW"
  who_can_view_membership        = "ALL_MEMBERS_CAN_VIEW"
  who_can_contact_owner          = "ALL_MEMBERS_CAN_CONTACT"

  # No web posting - email only
  allow_web_posting = false
}

# Group members managed via Google Workspace Admin UI
