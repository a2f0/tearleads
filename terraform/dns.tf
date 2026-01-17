data "hcloud_zone" "main" {
  name = var.domain
}

locals {
  ipv6_address = "${trimsuffix(hcloud_server.main.ipv6_network, "::/64")}::1"
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

resource "hcloud_zone_rrset" "www" {
  zone = data.hcloud_zone.main.name
  name = "www"
  type = "A"
  ttl  = 60
  records = [
    { value = hcloud_server.main.ipv4_address }
  ]
}

resource "hcloud_zone_rrset" "www_ipv6" {
  zone = data.hcloud_zone.main.name
  name = "www"
  type = "AAAA"
  ttl  = 60
  records = [
    { value = local.ipv6_address }
  ]
}

resource "hcloud_zone_rrset" "app" {
  zone = data.hcloud_zone.main.name
  name = "app"
  type = "A"
  ttl  = 60
  records = [
    { value = hcloud_server.main.ipv4_address }
  ]
}

resource "hcloud_zone_rrset" "app_ipv6" {
  zone = data.hcloud_zone.main.name
  name = "app"
  type = "AAAA"
  ttl  = 60
  records = [
    { value = local.ipv6_address }
  ]
}

resource "hcloud_zone_rrset" "api" {
  zone = data.hcloud_zone.main.name
  name = "api"
  type = "A"
  ttl  = 60
  records = [
    { value = hcloud_server.main.ipv4_address }
  ]
}

resource "hcloud_zone_rrset" "api_ipv6" {
  zone = data.hcloud_zone.main.name
  name = "api"
  type = "AAAA"
  ttl  = 60
  records = [
    { value = local.ipv6_address }
  ]
}

resource "hcloud_zone_rrset" "email" {
  zone = data.hcloud_zone.main.name
  name = "email"
  type = "A"
  ttl  = 60
  records = [
    { value = hcloud_server.main.ipv4_address }
  ]
}

resource "hcloud_zone_rrset" "email_ipv6" {
  zone = data.hcloud_zone.main.name
  name = "email"
  type = "AAAA"
  ttl  = 60
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
