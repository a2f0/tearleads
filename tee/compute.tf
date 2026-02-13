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

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-confidential-vm-jammy"
    sku       = "22_04-lts-cvm"
    version   = "latest"
  }

  vtpm_enabled        = true
  secure_boot_enabled = true

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.confidential_vm.id]
  }

  tags = local.tags
}
