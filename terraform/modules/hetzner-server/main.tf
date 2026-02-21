# COMPLIANCE_SENTINEL: TL-NET-004 | control=infrastructure-firewall
# Hetzner Cloud firewall with default-deny posture
resource "hcloud_firewall" "main" {
  count = var.create_firewall ? 1 : 0
  name  = "${var.name}-firewall"

  # SSH - restricted to allowed IPs
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.allowed_ssh_ips
  }

  # Additional custom rules
  dynamic "rule" {
    for_each = var.firewall_rules
    content {
      direction  = rule.value.direction
      protocol   = rule.value.protocol
      port       = rule.value.port
      source_ips = rule.value.source_ips
    }
  }

  labels = var.labels
}

# COMPLIANCE_SENTINEL: TL-INFRA-002 | control=server-hardening
# Server hardening applied via cloud-init user_data
resource "hcloud_server" "main" {
  name        = var.name
  image       = var.image
  server_type = var.server_type
  location    = var.location

  ssh_keys = [var.ssh_key_id]

  user_data = var.user_data

  firewall_ids = var.create_firewall ? [hcloud_firewall.main[0].id] : []

  labels = var.labels
}
