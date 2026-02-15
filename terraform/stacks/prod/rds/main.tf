# Use default VPC for simplicity
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

module "rds" {
  source = "../../../modules/aws-rds-postgres"

  identifier = "tearleads-prod"
  vpc_id     = data.aws_vpc.default.id
  subnet_ids = data.aws_subnets.default.ids

  # Allow connections from anywhere (k8s cluster will connect via public IP)
  # In production, restrict to k8s cluster IP
  allowed_cidr_blocks = var.allowed_cidr_blocks
  publicly_accessible = true

  # Database config
  database_name   = "tearleads"
  master_username = "postgres"
  master_password = var.postgres_password

  # Cheapest instance
  instance_class    = "db.t4g.micro"
  allocated_storage = 20

  # Backups
  backup_retention_period = 7

  # Protection
  deletion_protection = true
  skip_final_snapshot = false

  tags = {
    Project     = "tearleads"
    Environment = "prod"
    Stack       = "rds"
  }
}
