locals {
  name_prefix = "${var.project_name}-${var.environment}"
  tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "azurerm_resource_group" "tee" {
  name     = "${local.name_prefix}-rg"
  location = var.azure_location
  tags     = local.tags
}

resource "azurerm_virtual_network" "tee" {
  name                = "${local.name_prefix}-vnet"
  address_space       = [var.vnet_address_space]
  location            = azurerm_resource_group.tee.location
  resource_group_name = azurerm_resource_group.tee.name
  tags                = local.tags
}

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

resource "azurerm_public_ip" "confidential_vm" {
  name                = "${local.name_prefix}-pip"
  location            = azurerm_resource_group.tee.location
  resource_group_name = azurerm_resource_group.tee.name
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = local.tags
}

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

resource "azurerm_network_interface_security_group_association" "confidential_vm" {
  network_interface_id      = azurerm_network_interface.confidential_vm.id
  network_security_group_id = azurerm_network_security_group.confidential_vm.id
}
