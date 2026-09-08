terraform {
  required_version = ">= 1.16, < 2.0"
  backend "s3" {
    key = "staging/storage/terraform.tfstate"
  }
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.63"
    }
  }
}

# PlanetScale production is in AWS us-east-1; both blob stores use that region.
provider "aws" {
  region = "us-east-1"
  default_tags {
    tags = { Project = "tearleads", ManagedBy = "terraform", Stack = "staging/storage" }
  }
}
