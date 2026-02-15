locals {
  name_prefix = "${var.project_name}-${var.environment}"
  tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

data "azurerm_client_config" "current" {}

# Resource Group
resource "azurerm_resource_group" "tee" {
  name     = "${local.name_prefix}-rg"
  location = var.azure_location
  tags     = local.tags
}

# Virtual Network
resource "azurerm_virtual_network" "tee" {
  name                = "${local.name_prefix}-vnet"
  address_space       = [var.vnet_address_space]
  location            = azurerm_resource_group.tee.location
  resource_group_name = azurerm_resource_group.tee.name
  tags                = local.tags
}

# Subnet
resource "azurerm_subnet" "public" {
  name                 = "${local.name_prefix}-subnet"
  resource_group_name  = azurerm_resource_group.tee.name
  virtual_network_name = azurerm_virtual_network.tee.name
  address_prefixes     = [var.subnet_address_prefix]
}

# COMPLIANCE_SENTINEL: TL-NET-001 | control=network-security-group
# Network isolation via NSG - default deny with explicit allow rules
resource "azurerm_network_security_group" "confidential_vm" {
  name                = "${local.name_prefix}-nsg"
  location            = azurerm_resource_group.tee.location
  resource_group_name = azurerm_resource_group.tee.name
  tags                = local.tags
}

# COMPLIANCE_SENTINEL: TL-NET-002 | control=ssh-access-restriction
# SSH restricted to allowed CIDR only (var.allowed_ssh_cidr)
resource "azurerm_network_security_rule" "ssh" {
  name                        = "SSH"
  priority                    = 1001
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "22"
  source_address_prefix       = var.allowed_ssh_cidr
  destination_address_prefix  = "*"
  resource_group_name         = azurerm_resource_group.tee.name
  network_security_group_name = azurerm_network_security_group.confidential_vm.name
}

# Public IP
resource "azurerm_public_ip" "confidential_vm" {
  name                = "${local.name_prefix}-pip"
  location            = azurerm_resource_group.tee.location
  resource_group_name = azurerm_resource_group.tee.name
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = local.tags
}

# Network Interface
resource "azurerm_network_interface" "confidential_vm" {
  name                = "${local.name_prefix}-nic"
  location            = azurerm_resource_group.tee.location
  resource_group_name = azurerm_resource_group.tee.name
  tags                = local.tags

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.public.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.confidential_vm.id
  }
}

# NSG Association
resource "azurerm_network_interface_security_group_association" "confidential_vm" {
  network_interface_id      = azurerm_network_interface.confidential_vm.id
  network_security_group_id = azurerm_network_security_group.confidential_vm.id
}

# COMPLIANCE_SENTINEL: TL-INFRA-003 | control=managed-identity
# User-assigned managed identity for VM-to-Azure service auth (no stored credentials)
resource "azurerm_user_assigned_identity" "confidential_vm" {
  name                = "${local.name_prefix}-identity"
  resource_group_name = azurerm_resource_group.tee.name
  location            = azurerm_resource_group.tee.location
  tags                = local.tags
}

# COMPLIANCE_SENTINEL: TL-CRYPTO-004 | control=confidential-vm
# Azure Confidential VM with vTPM and Secure Boot (AMD SEV-SNP)
# Hardware-based memory encryption and attestation support
resource "azurerm_linux_virtual_machine" "confidential_vm" {
  name                = "${local.name_prefix}-vm"
  resource_group_name = azurerm_resource_group.tee.name
  location            = azurerm_resource_group.tee.location
  size                = var.vm_size
  admin_username      = var.admin_username

  network_interface_ids = [
    azurerm_network_interface.confidential_vm.id
  ]

  admin_ssh_key {
    username   = var.admin_username
    public_key = file(var.ssh_public_key_file)
  }

  os_disk {
    caching                          = "ReadWrite"
    storage_account_type             = "Premium_LRS"
    disk_size_gb                     = 30
    security_encryption_type         = "VMGuestStateOnly"
    secure_vm_disk_encryption_set_id = null
  }

  source_image_id = var.source_image_id

  dynamic "source_image_reference" {
    for_each = var.source_image_id == null ? [1] : []
    content {
      publisher = "Canonical"
      offer     = "0001-com-ubuntu-confidential-vm-jammy"
      sku       = "22_04-lts-cvm"
      version   = "latest"
    }
  }

  vtpm_enabled        = true
  secure_boot_enabled = true

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.confidential_vm.id]
  }

  tags = local.tags
}

# COMPLIANCE_SENTINEL: TL-CRYPTO-001 | control=key-vault-rbac
# Key Vault with RBAC authorization for secrets and keys
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
  # BUG FIX: Changed from azurerm_subnet.tee to azurerm_subnet.public
  network_acls {
    bypass                     = "AzureServices"
    default_action             = "Deny"
    virtual_network_subnet_ids = [azurerm_subnet.public.id]
  }
}

# Key Vault Administrator role for current user/service principal
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
