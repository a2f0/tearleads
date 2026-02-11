variable "project_name" {
  description = "Project name used for resource naming."
  type        = string
  default     = "tee"
}

variable "environment" {
  description = "Deployment environment."
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "VPC CIDR block."
  type        = string
  default     = "10.42.0.0/16"
}

variable "public_subnet_cidr" {
  description = "Public subnet CIDR block."
  type        = string
  default     = "10.42.1.0/24"
}

variable "allowed_ssh_cidr" {
  description = "CIDR allowed to SSH into the enclave host."
  type        = string
  default     = "0.0.0.0/0"
}

variable "instance_type" {
  description = "Nitro Enclaves-capable EC2 instance type."
  type        = string
  default     = "m5.xlarge"
}
