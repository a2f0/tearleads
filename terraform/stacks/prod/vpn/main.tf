# Lookup SSH key for cloud-init user_data
data "hcloud_ssh_key" "main" {
  name = var.ssh_key_name
}

# Private network for VPN isolation
resource "hcloud_network" "vpn" {
  name     = "vpn-prod"
  ip_range = var.vpn_network_cidr

  labels = {
    environment = "prod"
    stack       = "vpn"
  }
}

resource "hcloud_network_subnet" "vpn" {
  network_id   = hcloud_network.vpn.id
  type         = "cloud"
  network_zone = "eu-central"
  ip_range     = var.vpn_subnet_cidr
}

# COMPLIANCE_SENTINEL: TL-NET-004 | control=infrastructure-firewall
# Firewall - only WireGuard UDP port and SSH
resource "hcloud_firewall" "vpn" {
  name = "vpn-prod-firewall"

  # SSH access
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.allowed_ssh_ips
  }

  # WireGuard UDP
  rule {
    direction  = "in"
    protocol   = "udp"
    port       = tostring(var.wireguard_port)
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # ICMP
  rule {
    direction  = "in"
    protocol   = "icmp"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  labels = {
    environment = "prod"
    stack       = "vpn"
  }
}

# COMPLIANCE_SENTINEL: TL-INFRA-001 | control=ssh-key-authentication
# COMPLIANCE_SENTINEL: TL-INFRA-002 | control=server-hardening
# VPN Server
resource "hcloud_server" "vpn" {
  name        = "vpn-prod"
  server_type = var.server_type
  location    = var.server_location
  image       = "ubuntu-24.04"
  ssh_keys    = [data.hcloud_ssh_key.main.id]

  firewall_ids = [hcloud_firewall.vpn.id]

  user_data = <<-EOF
    #cloud-config
    users:
      - name: ${var.server_username}
        groups: sudo
        shell: /bin/bash
        sudo: ALL=(ALL) NOPASSWD:ALL
        ssh_authorized_keys:
          - ${data.hcloud_ssh_key.main.public_key}
    ssh_pwauth: false
    disable_root: true
  EOF

  labels = {
    environment = "prod"
    stack       = "vpn"
  }

  lifecycle {
    ignore_changes = [user_data]
  }
}

# Attach server to private network
resource "hcloud_server_network" "vpn" {
  server_id  = hcloud_server.vpn.id
  network_id = hcloud_network.vpn.id
  ip         = cidrhost(var.vpn_subnet_cidr, 10)
}
