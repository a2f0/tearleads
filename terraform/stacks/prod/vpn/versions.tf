terraform {
  required_version = ">= 1.6"

  backend "s3" {
    key = "prod/vpn/terraform.tfstate"
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
