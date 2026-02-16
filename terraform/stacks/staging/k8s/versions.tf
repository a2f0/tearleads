terraform {
  required_version = ">= 1.6"

  # COMPLIANCE_SENTINEL: TL-DR-001 | control=state-isolation
  backend "s3" {
    key = "staging/k8s/terraform.tfstate"
  }

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.58"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}
