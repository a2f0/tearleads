terraform {
  required_version = ">= 1.6"

  backend "local" {
    path = "terraform.tfstate"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "symcrypt"
      ManagedBy = "terraform"
      Stack     = "bootstrap"
    }
  }
}
