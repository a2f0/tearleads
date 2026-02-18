# Look up the zone
data "cloudflare_zone" "main" {
  count = var.lookup_zone_by_name ? 1 : 0
  name  = var.zone_name
}

locals {
  zone_id = var.lookup_zone_by_name ? data.cloudflare_zone.main[0].id : var.zone_id
}

# Generate a secret for the tunnel
resource "random_id" "tunnel_secret" {
  byte_length = 32
}

# COMPLIANCE_SENTINEL: TL-NET-006 | control=cloudflare-tunnel-isolation
# Create the tunnel
resource "cloudflare_tunnel" "main" {
  account_id = var.account_id
  name       = var.tunnel_name
  secret     = random_id.tunnel_secret.b64_std
}

# Configure tunnel ingress rules
resource "cloudflare_tunnel_config" "main" {
  account_id = var.account_id
  tunnel_id  = cloudflare_tunnel.main.id

  config {
    dynamic "ingress_rule" {
      for_each = var.ingress_rules
      content {
        hostname = ingress_rule.value.hostname
        service  = ingress_rule.value.service
        path     = ingress_rule.value.path != "" ? ingress_rule.value.path : null
      }
    }

    # Catch-all rule (required)
    ingress_rule {
      service = var.catch_all_service
    }
  }
}

# Create DNS CNAME records pointing to the tunnel
resource "cloudflare_record" "tunnel" {
  for_each = var.create_dns_records ? {
    for rule in var.ingress_rules : rule.hostname => rule
  } : {}

  zone_id = local.zone_id
  name    = each.value.hostname
  type    = "CNAME"
  content = "${cloudflare_tunnel.main.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1 # Auto TTL when proxied
}
