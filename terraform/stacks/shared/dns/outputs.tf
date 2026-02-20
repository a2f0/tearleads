output "zone_id" {
  description = "Cloudflare zone ID for dns_domain"
  value       = data.cloudflare_zone.main.id
}

output "managed_mx_records" {
  description = "Managed MX records keyed by priority-target"
  value = {
    for key, record in cloudflare_record.mx :
    key => record.id
  }
}

output "managed_google_site_verification_records" {
  description = "Managed Google site verification TXT records keyed by token value"
  value = {
    for key, record in cloudflare_record.google_site_verification :
    key => record.id
  }
}
