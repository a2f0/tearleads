# COMPLIANCE_SENTINEL: TL-VENDOR-002 | control=hetzner-cloud-vendor
# COMPLIANCE_SENTINEL: TL-INFRA-001 | control=ssh-key-auth
# SSH key-only authentication - password auth disabled via cloud-init
data "hcloud_ssh_key" "main" {
  name = var.ssh_key_name
}

# COMPLIANCE_SENTINEL: TL-NET-004 | control=infrastructure-firewall
# Hetzner Cloud firewall with default-deny posture
# Framework mappings:
# - SOC2: CC6.6 (External Threat Protection)
# - NIST SP 800-53: SC-7 (Boundary Protection)
# - HIPAA: 164.312(e)(1) (Transmission Security)
resource "hcloud_firewall" "main" {
  name = "${var.domain}-firewall"

  # SSH - restricted to management IPs (configurable via var.allowed_ssh_ips)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.allowed_ssh_ips
  }

  # HTTP - for certbot and redirects
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # HTTPS - web traffic
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # SMTP - mail reception
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "25"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # ICMP - allow ping for diagnostics
  rule {
    direction  = "in"
    protocol   = "icmp"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  labels = {
    environment = var.domain
  }
}

# COMPLIANCE_SENTINEL: TL-INFRA-002 | control=server-hardening
# Server hardening: root disabled, non-root user with sudo, SSH key-only
resource "hcloud_server" "main" {
  name        = var.domain
  image       = "ubuntu-24.04"
  server_type = "cx23"
  location    = var.server_location

  ssh_keys = [data.hcloud_ssh_key.main.id]

  user_data = <<-EOF
    #cloud-config
    users:
      - name: ${var.server_username}
        groups: sudo, www-data
        shell: /bin/bash
        sudo: ALL=(ALL) NOPASSWD:ALL
        ssh_authorized_keys:
          - ${data.hcloud_ssh_key.main.public_key}
    ssh_pwauth: false
    disable_root: true
  EOF

  firewall_ids = [hcloud_firewall.main.id]

  labels = {
    environment = var.domain
  }
}
