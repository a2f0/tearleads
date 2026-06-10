# Look up the zone
data "cloudflare_zone" "main" {
  count = var.lookup_zone_by_name ? 1 : 0
  filter = {
    account = {
      id = var.account_id
    }
    name = var.zone_name
  }
}

locals {
  zone_id = var.lookup_zone_by_name ? data.cloudflare_zone.main[0].id : var.zone_id
}

# Generate a secret for the tunnel
resource "random_id" "tunnel_secret" {
  byte_length = 32
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "main" {
  account_id    = var.account_id
  name          = var.tunnel_name
  tunnel_secret = random_id.tunnel_secret.b64_std
  config_src    = "cloudflare"
}

data "cloudflare_zero_trust_tunnel_cloudflared_token" "main" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.main.id
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "main" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.main.id

  config = {
    ingress = concat(
      [for rule in var.ingress_rules : {
        hostname = rule.hostname
        service  = rule.service
        path     = rule.path != "" ? rule.path : null
      }],
      [{ hostname = "", service = var.catch_all_service }]
    )
  }
}

resource "cloudflare_dns_record" "tunnel" {
  for_each = var.create_dns_records ? {
    for rule in var.ingress_rules : rule.hostname => rule
  } : {}

  zone_id = local.zone_id
  name    = each.value.hostname
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.main.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
}
