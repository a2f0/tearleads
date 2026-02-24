terraform {
  required_version = ">= 1.6"

  backend "s3" {
    bucket         = "tearleads-terraform-state"
    key            = "stacks/prod/s3/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "tearleads-terraform-locks"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}
