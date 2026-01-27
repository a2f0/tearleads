data "hcloud_zone" "main" {
  name = var.domain
}

locals {
  ipv6_address = "${trimsuffix(hcloud_server.tuxedo.ipv6_network, "::/64")}::1"
}

resource "hcloud_zone_rrset" "tuxedo_ipv4" {
  zone = data.hcloud_zone.main.name
  name = var.dns_hostname
  type = "A"
  ttl  = 60
  records = [
    { value = hcloud_server.tuxedo.ipv4_address }
  ]
}

resource "hcloud_zone_rrset" "tuxedo_ipv6" {
  zone = data.hcloud_zone.main.name
  name = var.dns_hostname
  type = "AAAA"
  ttl  = 60
  records = [
    { value = local.ipv6_address }
  ]
}
