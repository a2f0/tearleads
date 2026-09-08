terraform {
  required_version = ">= 1.16, < 2.0"
  backend "s3" {
    key = "prod/website/terraform.tfstate"
  }
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.24"
    }
  }
}
provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
