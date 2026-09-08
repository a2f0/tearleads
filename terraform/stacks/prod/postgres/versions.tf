terraform {
  required_version = ">= 1.16, < 2.0"

  backend "s3" {
    key = "prod/postgres/terraform.tfstate"
  }

  required_providers {
    planetscale = {
      source  = "planetscale/planetscale"
      version = "~> 1.9.0"
    }
  }
}

# Read PLANETSCALE_SERVICE_TOKEN_ID and PLANETSCALE_SERVICE_TOKEN from the env.
provider "planetscale" {}
