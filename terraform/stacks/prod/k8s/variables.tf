variable "domain" {
  description = "Domain name for DNS records (k8s subdomain will be created)"
  type        = string
}

variable "aws_region" {
  description = "AWS region for production k8s resources"
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type for the k8s server"
  type        = string
  default     = "t3.small"
}

variable "server_username" {
  description = "Non-root username for server access"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the prod k8s VPC"
  type        = string
  default     = "10.42.0.0/16"
}

variable "public_subnet_cidr" {
  description = "Public subnet CIDR for the k8s EC2 host"
  type        = string
  default     = "10.42.1.0/24"
}

variable "rds_subnet_a_cidr" {
  description = "Private subnet A CIDR for RDS"
  type        = string
  default     = "10.42.10.0/24"
}

variable "rds_subnet_b_cidr" {
  description = "Private subnet B CIDR for RDS"
  type        = string
  default     = "10.42.11.0/24"
}

variable "allowed_ssh_ips" {
  description = "List of IP addresses/CIDRs allowed to access SSH"
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

variable "allowed_k8s_api_ips" {
  description = "List of IP addresses/CIDRs allowed to access k8s API (port 6443)"
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"] # Match staging behavior to avoid first-run var wiring failures
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

variable "ssh_host_private_key" {
  description = "SSH host private key for the server"
  type        = string
  sensitive   = true
}

variable "ssh_host_public_key" {
  description = "SSH host public key for the server"
  type        = string
}
