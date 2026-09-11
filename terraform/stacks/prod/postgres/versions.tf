terraform {
  required_version = ">= 1.16, < 2.0"

  backend "s3" {
    key = "prod/postgres/terraform.tfstate"
  }

  required_providers {
    external = {
      source  = "hashicorp/external"
      version = "~> 2.3.5"
    }
    restapi = {
      source  = "Mastercard/restapi"
      version = "~> 3.0.0"
    }
    planetscale = {
      source  = "planetscale/planetscale"
      version = "~> 1.9.0"
    }
  }
}

# Read PLANETSCALE_SERVICE_TOKEN_ID and PLANETSCALE_SERVICE_TOKEN from the env.
provider "planetscale" {}

provider "restapi" {
  uri                  = "https://api.planetscale.com/v1"
  write_returns_object = true
  headers = {
    Authorization = "${var.planetscale_service_token_id}:${var.planetscale_service_token}"
  }
}
