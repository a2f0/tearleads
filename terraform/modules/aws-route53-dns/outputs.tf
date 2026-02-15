output "zone_id" {
  description = "Route 53 zone ID"
  value       = data.aws_route53_zone.main.zone_id
}

output "zone_name" {
  description = "Route 53 zone name"
  value       = data.aws_route53_zone.main.name
}
