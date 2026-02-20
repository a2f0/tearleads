data "cloudflare_zone" "staging" {
  account_id = var.cloudflare_account_id
  name       = var.staging_domain
}

locals {
  ipv6_address = "${trimsuffix(hcloud_server.tuxedo.ipv6_network, "::/64")}::1"
}

resource "cloudflare_record" "tuxedo_ipv4" {
  zone_id = data.cloudflare_zone.staging.id
  name    = var.dns_hostname
  type    = "A"
  content = hcloud_server.tuxedo.ipv4_address
  proxied = false
  ttl     = 60
}

resource "cloudflare_record" "tuxedo_ipv6" {
  zone_id = data.cloudflare_zone.staging.id
  name    = var.dns_hostname
  type    = "AAAA"
  content = local.ipv6_address
  proxied = false
  ttl     = 60
}
