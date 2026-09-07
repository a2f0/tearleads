terraform {
  required_version = ">= 1.16, < 2.0"

  backend "local" {
    path = "terraform.tfstate"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.63"
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
