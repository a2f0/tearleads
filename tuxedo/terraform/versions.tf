terraform {
  required_version = ">= 1.0"

  # COMPLIANCE_SENTINEL: TL-DR-001 | control=state-isolation
  backend "s3" {
    key = "tuxedo/terraform.tfstate"
  }

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.58"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
