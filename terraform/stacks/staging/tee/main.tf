module "tee" {
  source = "../../../modules/azure-tee"

  project_name          = var.project_name
  environment           = var.environment
  azure_location        = var.azure_location
  vnet_address_space    = var.vnet_address_space
  subnet_address_prefix = var.subnet_address_prefix
  allowed_ssh_cidr      = var.allowed_ssh_cidr
  vm_size               = var.vm_size
  source_image_id       = var.source_image_id
  admin_username        = var.admin_username
  ssh_public_key_file   = var.ssh_public_key_file
}
