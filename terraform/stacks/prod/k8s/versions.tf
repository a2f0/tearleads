terraform {
  required_version = ">= 1.6"

  backend "s3" {
    key = "prod/k8s/terraform.tfstate"
  }

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.58"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

provider "aws" {
  region = "us-east-1"
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
