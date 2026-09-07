terraform {
  required_version = ">= 1.16, < 2.0"

  backend "s3" {
    key = "prod/server/terraform.tfstate"
  }

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.68"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.24"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
