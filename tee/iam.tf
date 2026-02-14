# COMPLIANCE_SENTINEL: TL-INFRA-003 | control=managed-identity
# User-assigned managed identity for VM-to-Azure service auth (no stored credentials)
resource "azurerm_user_assigned_identity" "confidential_vm" {
  name                = "${local.name_prefix}-identity"
  resource_group_name = azurerm_resource_group.tee.name
  location            = azurerm_resource_group.tee.location
  tags                = local.tags
}
