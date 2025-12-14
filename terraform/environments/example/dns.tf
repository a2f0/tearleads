data "hcloud_zone" "main" {
  name = var.domain
}

resource "hcloud_zone_rrset" "main" {
  zone = data.hcloud_zone.main.name
  name = "example"
  type = "A"
  ttl  = 60
  records = [
    { value = hcloud_server.main.ipv4_address }
  ]
}
