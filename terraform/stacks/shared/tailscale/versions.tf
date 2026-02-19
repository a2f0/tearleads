terraform {
  required_version = ">= 1.6"

  # COMPLIANCE_SENTINEL: TL-DR-001 | control=state-isolation
  backend "s3" {
    key = "shared/tailscale/terraform.tfstate"
  }

  required_providers {
    tailscale = {
      source  = "tailscale/tailscale"
      version = "~> 0.28.0"
    }
  }
}
