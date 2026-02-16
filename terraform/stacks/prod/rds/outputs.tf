output "endpoint" {
  description = "RDS endpoint (host:port)"
  value       = module.rds.endpoint
}

output "address" {
  description = "RDS hostname (for k8s configmap)"
  value       = module.rds.address
}

output "port" {
  description = "RDS port"
  value       = module.rds.port
}

output "database_name" {
  description = "Database name"
  value       = module.rds.database_name
}

output "username" {
  description = "Master username"
  value       = module.rds.username
}
