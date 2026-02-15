data "hcloud_zone" "main" {
  name = var.domain
}

# Apex A record
resource "hcloud_zone_rrset" "apex_a" {
  count = var.create_apex_records ? 1 : 0

  zone = data.hcloud_zone.main.name
  name = "@"
  type = "A"
  ttl  = var.ttl
  records = [
    { value = var.ipv4_address }
  ]
}

# Apex AAAA record
resource "hcloud_zone_rrset" "apex_aaaa" {
  count = var.create_apex_records ? 1 : 0

  zone = data.hcloud_zone.main.name
  name = "@"
  type = "AAAA"
  ttl  = var.ttl
  records = [
    { value = var.ipv6_address }
  ]
}

# Subdomain A records
resource "hcloud_zone_rrset" "subdomain_a" {
  for_each = var.subdomains

  zone = data.hcloud_zone.main.name
  name = each.key
  type = "A"
  ttl  = var.ttl
  records = [
    { value = var.ipv4_address }
  ]
}

# Subdomain AAAA records
resource "hcloud_zone_rrset" "subdomain_aaaa" {
  for_each = var.subdomains

  zone = data.hcloud_zone.main.name
  name = each.key
  type = "AAAA"
  ttl  = var.ttl
  records = [
    { value = var.ipv6_address }
  ]
}

# Wildcard A record
resource "hcloud_zone_rrset" "wildcard_a" {
  count = var.wildcard_subdomain != "" ? 1 : 0

  zone = data.hcloud_zone.main.name
  name = "*.${var.wildcard_subdomain}"
  type = "A"
  ttl  = var.ttl
  records = [
    { value = var.ipv4_address }
  ]
}

# Wildcard AAAA record
resource "hcloud_zone_rrset" "wildcard_aaaa" {
  count = var.wildcard_subdomain != "" ? 1 : 0

  zone = data.hcloud_zone.main.name
  name = "*.${var.wildcard_subdomain}"
  type = "AAAA"
  ttl  = var.ttl
  records = [
    { value = var.ipv6_address }
  ]
}

# MX record
resource "hcloud_zone_rrset" "mx" {
  count = var.create_mx_records ? 1 : 0

  zone = data.hcloud_zone.main.name
  name = "@"
  type = "MX"
  ttl  = var.mx_ttl
  records = [
    { value = "${var.mx_priority} ${var.mx_hostname}.${var.domain}." }
  ]
}
