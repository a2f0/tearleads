output "resource_group_name" {
  description = "Resource group name for the TEE environment"
  value       = module.tee.resource_group_name
}

output "vnet_id" {
  description = "Virtual network ID"
  value       = module.tee.vnet_id
}

output "subnet_id" {
  description = "Subnet where the confidential VM runs"
  value       = module.tee.subnet_id
}

output "vm_id" {
  description = "Confidential VM resource ID"
  value       = module.tee.vm_id
}

output "vm_public_ip" {
  description = "Public IP of the confidential VM"
  value       = module.tee.vm_public_ip
}

output "key_vault_id" {
  description = "Key Vault ID for TEE workflows"
  value       = module.tee.key_vault_id
}

output "key_vault_uri" {
  description = "Key Vault URI"
  value       = module.tee.key_vault_uri
}

output "managed_identity_client_id" {
  description = "Client ID of the VM's managed identity"
  value       = module.tee.managed_identity_client_id
}

output "ssh_command" {
  description = "SSH command to connect to the VM"
  value       = module.tee.ssh_command
}
