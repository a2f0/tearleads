data "hcloud_zone" "main" {
  name = var.domain
}

locals {
  ipv6_address = "${trimsuffix(hcloud_server.k8s.ipv6_network, "::/64")}::1"
}

resource "hcloud_zone_rrset" "k8s_a" {
  zone = data.hcloud_zone.main.name
  name = "k8s"
  type = "A"
  ttl  = 60
  records = [
    { value = hcloud_server.k8s.ipv4_address }
  ]
}

resource "hcloud_zone_rrset" "k8s_aaaa" {
  zone = data.hcloud_zone.main.name
  name = "k8s"
  type = "AAAA"
  ttl  = 60
  records = [
    { value = local.ipv6_address }
  ]
}

resource "hcloud_zone_rrset" "k8s_wildcard_a" {
  zone = data.hcloud_zone.main.name
  name = "*.k8s"
  type = "A"
  ttl  = 60
  records = [
    { value = hcloud_server.k8s.ipv4_address }
  ]
}

resource "hcloud_zone_rrset" "k8s_wildcard_aaaa" {
  zone = data.hcloud_zone.main.name
  name = "*.k8s"
  type = "AAAA"
  ttl  = 60
  records = [
    { value = local.ipv6_address }
  ]
}
