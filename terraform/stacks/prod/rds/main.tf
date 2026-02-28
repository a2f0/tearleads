# Pull network outputs from the prod k8s stack
data "terraform_remote_state" "k8s" {
  backend = "s3"

  config = {
    bucket = "tearleads-terraform-state"
    key    = "prod/k8s/terraform.tfstate"
    region = "us-east-1"
  }
}

module "rds" {
  source = "../../../modules/aws-rds-postgres"

  identifier = "tearleads-prod"
  vpc_id     = data.terraform_remote_state.k8s.outputs.vpc_id
  subnet_ids = data.terraform_remote_state.k8s.outputs.rds_subnet_ids

  # Restrict RDS access to the prod k8s server security group.
  allowed_cidr_blocks        = []
  allowed_security_group_ids = [data.terraform_remote_state.k8s.outputs.k8s_server_security_group_id]
  publicly_accessible        = false

  # Database config
  database_name   = "tearleads"
  master_username = "postgres"
  master_password = var.postgres_password

  # Cheapest instance
  instance_class    = "db.t4g.micro"
  allocated_storage = 20

  # Faster teardown in pre-alpha: disable automated backups.
  backup_retention_period      = 0
  performance_insights_enabled = false

  # Protection
  deletion_protection = false
  skip_final_snapshot = true

  tags = {
    Project     = "tearleads"
    Environment = "prod"
    Stack       = "rds"
  }
}
