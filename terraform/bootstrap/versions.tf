terraform {
  required_version = ">= 1.6"

  # Bootstrap uses local backend only - no remote state
  # This avoids chicken-and-egg: we need the bucket to exist before using S3 backend
  backend "local" {
    path = "terraform.tfstate"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "tearleads"
      ManagedBy = "terraform"
      Stack     = "bootstrap"
    }
  }
}
