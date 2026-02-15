terraform {
  required_version = ">= 1.6"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

# COMPLIANCE_SENTINEL: TL-CRYPTO-005 | control=key-vault-protection
# Disable purge on destroy to protect cryptographic keys
# Framework mappings:
# - SOC2: CC6.7 (Information Disposal)
# - NIST SP 800-53: SC-12 (Cryptographic Key Management)
provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = false
      recover_soft_deleted_key_vaults = true
    }
  }
}
