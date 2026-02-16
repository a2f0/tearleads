output "zone_id" {
  description = "ID of the DNS zone"
  value       = data.hcloud_zone.main.id
}

output "zone_name" {
  description = "Name of the DNS zone"
  value       = data.hcloud_zone.main.name
}

output "apex_fqdn" {
  description = "Fully qualified domain name for apex"
  value       = var.create_apex_records ? var.domain : null
}

output "subdomain_fqdns" {
  description = "Fully qualified domain names for subdomains"
  value       = { for k in var.subdomains : k => "${k}.${var.domain}" }
}

output "wildcard_fqdn" {
  description = "Wildcard FQDN if created"
  value       = var.wildcard_subdomain != "" ? "*.${var.wildcard_subdomain}.${var.domain}" : null
}
