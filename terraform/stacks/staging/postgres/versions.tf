terraform {
  required_version = ">= 1.16, < 2.0"

  backend "s3" {
    # State lives in Cloudflare R2. The stack wrappers in terraform/scripts
    # pass the tier's TF_STATE_* key as the credentials the S3 backend reads.
    bucket = "tearleads-terraform-state"
    key    = "staging/postgres/terraform.tfstate"
    region = "auto"
    endpoints = {
      s3 = "https://0be508e6c4caa573595c5f94e11900e4.r2.cloudflarestorage.com"
    }
    use_lockfile                = true
    use_path_style              = true
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.24"
    }
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

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
