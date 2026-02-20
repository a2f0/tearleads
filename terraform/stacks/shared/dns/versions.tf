terraform {
  required_version = ">= 1.6"

  # COMPLIANCE_SENTINEL: TL-DR-001 | control=state-isolation
  backend "s3" {
    key = "shared/dns/terraform.tfstate"
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}
