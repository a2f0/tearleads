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

    package_update: true
    packages:
      - wireguard
      - wireguard-tools
      - qrencode

    write_files:
      - path: /etc/sysctl.d/99-wireguard.conf
        content: |
          net.ipv4.ip_forward = 1
          net.ipv6.conf.all.forwarding = 1

    runcmd:
      # Enable IP forwarding
      - sysctl -p /etc/sysctl.d/99-wireguard.conf
      # Generate server keys
      - mkdir -p /etc/wireguard
      - wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key
      - chmod 600 /etc/wireguard/server_private.key
      # Create initial WireGuard config
      - |
        cat > /etc/wireguard/wg0.conf << 'WGCONF'
        [Interface]
        Address = ${cidrhost(var.wireguard_client_cidr, 1)}/24
        ListenPort = ${var.wireguard_port}
        PrivateKey = PLACEHOLDER_PRIVATE_KEY
        PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
        PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

        # Add client peers below
        WGCONF
      - sed -i "s|PLACEHOLDER_PRIVATE_KEY|$(cat /etc/wireguard/server_private.key)|" /etc/wireguard/wg0.conf
      - chmod 600 /etc/wireguard/wg0.conf
      # Enable and start WireGuard
      - systemctl enable wg-quick@wg0
      - systemctl start wg-quick@wg0
      # Create helper script to add clients
      - |
        cat > /usr/local/bin/wg-add-client << 'SCRIPT'
        #!/bin/bash
        set -e
        CLIENT_NAME="$1"
        if [ -z "$CLIENT_NAME" ]; then
          echo "Usage: wg-add-client <client-name>"
          exit 1
        fi
        CLIENT_DIR="/etc/wireguard/clients/$CLIENT_NAME"
        mkdir -p "$CLIENT_DIR"
        # Generate client keys
        wg genkey | tee "$CLIENT_DIR/private.key" | wg pubkey > "$CLIENT_DIR/public.key"
        chmod 600 "$CLIENT_DIR/private.key"
        # Find next available IP
        LAST_IP=$(grep -oP 'AllowedIPs = 10\.200\.0\.\K[0-9]+' /etc/wireguard/wg0.conf | sort -n | tail -1)
        NEXT_IP=$((LAST_IP + 1))
        if [ -z "$LAST_IP" ]; then NEXT_IP=2; fi
        # Add peer to server config
        cat >> /etc/wireguard/wg0.conf << PEER

        [Peer]
        # $CLIENT_NAME
        PublicKey = $(cat "$CLIENT_DIR/public.key")
        AllowedIPs = 10.200.0.$NEXT_IP/32
        PEER
        # Create client config
        SERVER_PUBLIC=$(cat /etc/wireguard/server_public.key)
        SERVER_IP=$(curl -s http://169.254.169.254/hetzner/v1/metadata/public-ipv4)
        cat > "$CLIENT_DIR/$CLIENT_NAME.conf" << CLIENT
        [Interface]
        PrivateKey = $(cat "$CLIENT_DIR/private.key")
        Address = 10.200.0.$NEXT_IP/24
        DNS = 1.1.1.1, 8.8.8.8

        [Peer]
        PublicKey = $SERVER_PUBLIC
        Endpoint = $SERVER_IP:${var.wireguard_port}
        AllowedIPs = ${var.vpn_network_cidr}, ${var.wireguard_client_cidr}
        PersistentKeepalive = 25
        CLIENT
        # Reload WireGuard
        wg syncconf wg0 <(wg-quick strip wg0)
        echo "Client config: $CLIENT_DIR/$CLIENT_NAME.conf"
        qrencode -t ansiutf8 < "$CLIENT_DIR/$CLIENT_NAME.conf"
        SCRIPT
      - chmod +x /usr/local/bin/wg-add-client
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
