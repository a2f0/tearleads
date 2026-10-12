output "api_url" {
  description = "Public API origin for this tier"
  value       = module.api_domain.url
}
output "app_url" {
  description = "Public web application origin for this tier"
  value       = module.app_domain.url
}
output "demo_url" {
  description = "Public demo application origin for this tier"
  value       = module.demo_domain.url
}
