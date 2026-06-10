variable "domain" {
  description = "Domain name for DNS records"
  type        = string
}

variable "aws_region" {
  description = "AWS region for prod resources"
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.small"
}

variable "ami_id" {
  description = "AMI ID to use (empty for latest Ubuntu Noble 24.04)"
  type        = string
  default     = ""
}

variable "ssh_key_name" {
  description = "Name of existing AWS EC2 key pair"
  type        = string
}

variable "server_user_data" {
  description = "Cloud-init user data for the server"
  type        = string
  default     = ""
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.42.0.0/16"
}

variable "public_subnet_cidr" {
  description = "Public subnet CIDR"
  type        = string
  default     = "10.42.1.0/24"
}

variable "allowed_ssh_ips" {
  description = "List of IP addresses/CIDRs allowed SSH access"
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}
