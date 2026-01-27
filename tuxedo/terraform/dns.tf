data "hcloud_zone" "main" {
  name = var.domain
}

locals {
  ipv6_address = "${trimsuffix(hcloud_server.tuxedo.ipv6_network, "::/64")}::1"
}

resource "hcloud_record" "tuxedo_ipv4" {
  zone_id = data.hcloud_zone.main.id
  name    = var.dns_hostname
  type    = "A"
  ttl     = 60
  value   = hcloud_server.tuxedo.ipv4_address
}

resource "hcloud_record" "tuxedo_ipv6" {
  zone_id = data.hcloud_zone.main.id
  name    = var.dns_hostname
  type    = "AAAA"
  ttl     = 60
  value   = local.ipv6_address
}
