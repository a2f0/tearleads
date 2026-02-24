# Pull k8s server IP from the prod k8s stack
data "terraform_remote_state" "k8s" {
  backend = "s3"

  config = {
    bucket = "tearleads-terraform-state"
    key    = "prod/k8s/terraform.tfstate"
    region = "us-east-1"
  }
}

# Dedicated VPC for RDS
resource "aws_vpc" "rds" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name        = "tearleads-prod-rds"
    Project     = "tearleads"
    Environment = "prod"
  }
}

# Internet gateway (required for publicly accessible RDS)
resource "aws_internet_gateway" "rds" {
  vpc_id = aws_vpc.rds.id

  tags = {
    Name        = "tearleads-prod-rds"
    Project     = "tearleads"
    Environment = "prod"
  }
}

# Route table with internet access
resource "aws_route_table" "rds" {
  vpc_id = aws_vpc.rds.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.rds.id
  }

  tags = {
    Name        = "tearleads-prod-rds"
    Project     = "tearleads"
    Environment = "prod"
  }
}

# Subnets in two AZs (required for DB subnet group)
resource "aws_subnet" "rds_a" {
  vpc_id            = aws_vpc.rds.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "us-east-1a"

  tags = {
    Name        = "tearleads-prod-rds-a"
    Project     = "tearleads"
    Environment = "prod"
  }
}

resource "aws_subnet" "rds_b" {
  vpc_id            = aws_vpc.rds.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "us-east-1b"

  tags = {
    Name        = "tearleads-prod-rds-b"
    Project     = "tearleads"
    Environment = "prod"
  }
}

resource "aws_route_table_association" "rds_a" {
  subnet_id      = aws_subnet.rds_a.id
  route_table_id = aws_route_table.rds.id
}

resource "aws_route_table_association" "rds_b" {
  subnet_id      = aws_subnet.rds_b.id
  route_table_id = aws_route_table.rds.id
}

module "rds" {
  source = "../../../modules/aws-rds-postgres"

  identifier = "tearleads-prod"
  vpc_id     = aws_vpc.rds.id
  subnet_ids = [aws_subnet.rds_a.id, aws_subnet.rds_b.id]

  # Allow traffic from the k8s server (fallback to 0.0.0.0 when k8s is already destroyed)
  allowed_cidr_blocks = ["${try(data.terraform_remote_state.k8s.outputs.server_ip, "0.0.0.0")}/32"]
  publicly_accessible = true # Required for k8s cluster outside VPC

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
  deletion_protection = false
  skip_final_snapshot = true

  tags = {
    Project     = "tearleads"
    Environment = "prod"
    Stack       = "rds"
  }
}
