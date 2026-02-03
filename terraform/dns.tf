data "hcloud_zone" "main" {
  name = var.domain
}

locals {
  ipv6_address = "${trimsuffix(hcloud_server.main.ipv6_network, "::/64")}::1"
  subdomains   = toset(["www", "app", "api", "download", "email"])
}

resource "hcloud_zone_rrset" "apex" {
  zone = data.hcloud_zone.main.name
  name = "@"
  type = "A"
  ttl  = 60
  records = [
    { value = hcloud_server.main.ipv4_address }
  ]
}

resource "hcloud_zone_rrset" "apex_ipv6" {
  zone = data.hcloud_zone.main.name
  name = "@"
  type = "AAAA"
  ttl  = 60
  records = [
    { value = local.ipv6_address }
  ]
}

resource "hcloud_zone_rrset" "subdomains_a" {
  for_each = local.subdomains
  zone     = data.hcloud_zone.main.name
  name     = each.key
  type     = "A"
  ttl      = 60
  records = [
    { value = hcloud_server.main.ipv4_address }
  ]
}

resource "hcloud_zone_rrset" "subdomains_aaaa" {
  for_each = local.subdomains
  zone     = data.hcloud_zone.main.name
  name     = each.key
  type     = "AAAA"
  ttl      = 60
  records = [
    { value = local.ipv6_address }
  ]
}

resource "hcloud_zone_rrset" "mx" {
  zone = data.hcloud_zone.main.name
  name = "@"
  type = "MX"
  ttl  = 300
  records = [
    { value = "10 email.${var.domain}." }
  ]
}
