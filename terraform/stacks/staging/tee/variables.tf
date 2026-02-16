variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "tee"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "staging"
}

variable "azure_location" {
  description = "Azure region for all resources"
  type        = string
  default     = "eastus"
}

variable "vnet_address_space" {
  description = "Virtual network address space"
  type        = string
  default     = "10.42.0.0/16"
}

variable "subnet_address_prefix" {
  description = "Subnet address prefix"
  type        = string
  default     = "10.42.1.0/24"
}

variable "allowed_ssh_cidr" {
  description = "CIDR allowed to SSH into the confidential VM"
  type        = string
}

variable "vm_size" {
  description = "Azure Confidential VM size (DCasv5 series)"
  type        = string
  default     = "Standard_DC2as_v5"
}

variable "source_image_id" {
  description = "Optional managed image ID for the VM"
  type        = string
  default     = null
}

variable "admin_username" {
  description = "Admin username for the VM"
  type        = string
  default     = "deploy"
}

variable "ssh_public_key_file" {
  description = "Path to SSH public key file"
  type        = string
}
