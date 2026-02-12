output "resource_group_name" {
  description = "Resource group name for the TEE environment."
  value       = azurerm_resource_group.tee.name
}

output "vnet_id" {
  description = "Virtual network ID."
  value       = azurerm_virtual_network.tee.id
}

output "subnet_id" {
  description = "Subnet where the confidential VM runs."
  value       = azurerm_subnet.public.id
}

output "vm_id" {
  description = "Confidential VM resource ID."
  value       = azurerm_linux_virtual_machine.confidential_vm.id
}

output "vm_public_ip" {
  description = "Public IP of the confidential VM."
  value       = azurerm_public_ip.confidential_vm.ip_address
}

output "key_vault_id" {
  description = "Key Vault ID for TEE workflows."
  value       = azurerm_key_vault.tee.id
}

output "key_vault_uri" {
  description = "Key Vault URI."
  value       = azurerm_key_vault.tee.vault_uri
}

output "managed_identity_client_id" {
  description = "Client ID of the VM's managed identity."
  value       = azurerm_user_assigned_identity.confidential_vm.client_id
}
