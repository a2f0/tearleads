terraform {
  required_version = ">= 1.6"

  backend "s3" {
    key = "staging/tee/terraform.tfstate"
  }

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

# COMPLIANCE_SENTINEL: TL-CRYPTO-005 | control=key-vault-protection
# Disable purge on destroy to protect cryptographic keys
provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }
  }
}
