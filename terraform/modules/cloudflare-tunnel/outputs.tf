output "tunnel_id" {
  description = "Cloudflare tunnel ID"
  value       = cloudflare_zero_trust_tunnel_cloudflared.main.id
}

output "tunnel_name" {
  description = "Cloudflare tunnel name"
  value       = cloudflare_zero_trust_tunnel_cloudflared.main.name
}

output "tunnel_token" {
  description = "Tunnel token for cloudflared (use in k8s secret)"
  value       = cloudflare_zero_trust_tunnel_cloudflared.main.tunnel_token
  sensitive   = true
}

output "tunnel_cname" {
  description = "CNAME target for DNS records"
  value       = "${cloudflare_zero_trust_tunnel_cloudflared.main.id}.cfargotunnel.com"
}

output "zone_id" {
  description = "Cloudflare zone ID"
  value       = var.lookup_zone_by_name ? data.cloudflare_zone.main[0].id : var.zone_id
}
