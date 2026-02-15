data "azurerm_client_config" "current" {}

# COMPLIANCE_SENTINEL: TL-CRYPTO-001 | control=key-vault-rbac
# Key Vault with RBAC authorization for secrets and keys
# Framework mappings:
# - SOC2: CC6.1, CC6.7 (Logical Access Security)
# - NIST SP 800-53: SC-12, SC-13 (Cryptographic Key Management)
# - HIPAA: 164.312(a)(2)(iv) (Encryption and Decryption)
resource "azurerm_key_vault" "tee" {
  name                       = "${var.project_name}${var.environment}kv"
  location                   = azurerm_resource_group.tee.location
  resource_group_name        = azurerm_resource_group.tee.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "premium"
  purge_protection_enabled   = true
  soft_delete_retention_days = 90
  rbac_authorization_enabled = true
  tags                       = local.tags

  # Network rules - restrict to VNet and Azure services
  network_acls {
    bypass                     = "AzureServices"
    default_action             = "Deny"
    virtual_network_subnet_ids = [azurerm_subnet.tee.id]
  }
}

resource "azurerm_role_assignment" "kv_admin" {
  scope                = azurerm_key_vault.tee.id
  role_definition_name = "Key Vault Administrator"
  principal_id         = data.azurerm_client_config.current.object_id
}

# COMPLIANCE_SENTINEL: TL-CRYPTO-002 | control=vm-secrets-access
# Least-privilege secrets access for confidential VM identity
resource "azurerm_role_assignment" "vm_kv_secrets" {
  scope                = azurerm_key_vault.tee.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.confidential_vm.principal_id
}

resource "azurerm_role_assignment" "vm_kv_crypto" {
  scope                = azurerm_key_vault.tee.id
  role_definition_name = "Key Vault Crypto User"
  principal_id         = azurerm_user_assigned_identity.confidential_vm.principal_id
}

# COMPLIANCE_SENTINEL: TL-CRYPTO-003 | control=attestation-key
# RSA 2048-bit key for TEE attestation and sealed-key workflows
resource "azurerm_key_vault_key" "tee" {
  name         = "${local.name_prefix}-key"
  key_vault_id = azurerm_key_vault.tee.id
  key_type     = "RSA"
  key_size     = 2048

  key_opts = [
    "decrypt",
    "encrypt",
    "sign",
    "verify",
    "wrapKey",
    "unwrapKey",
  ]

  depends_on = [azurerm_role_assignment.kv_admin]
}
