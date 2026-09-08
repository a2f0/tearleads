output "url" {
  value = "https://${cloudflare_workers_custom_domain.website.hostname}"
}
output "worker_name" {
  value = cloudflare_workers_custom_domain.website.service
}
