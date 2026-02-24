# Lookup SSH key for cloud-init user_data
data "hcloud_ssh_key" "main" {
  name = var.ssh_key_name
}

module "server" {
  source = "../../../modules/hetzner-server"

  name        = "k8s-prod-${var.production_domain}"
  ssh_key_id  = data.hcloud_ssh_key.main.id
  server_type = var.server_type
  location    = var.server_location

  user_data = <<-EOF
    #cloud-config
    # Prevent cloud-init from regenerating ed25519 key (we provide our own)
    # Allow RSA/ECDSA generation since SSH needs them
    ssh_deletekeys: false
    ssh_genkeytypes: ['rsa', 'ecdsa']

    write_files:
      - path: /etc/ssh/ssh_host_ed25519_key
        owner: root:root
        permissions: '0600'
        encoding: b64
        content: ${base64encode("${chomp(var.ssh_host_private_key)}\n")}
      - path: /etc/ssh/ssh_host_ed25519_key.pub
        owner: root:root
        permissions: '0644'
        encoding: b64
        content: ${base64encode("${chomp(var.ssh_host_public_key)}\n")}
    users:
      - name: ${var.server_username}
        groups: sudo
        shell: /bin/bash
        sudo: ALL=(ALL) NOPASSWD:ALL
        ssh_authorized_keys:
          - ${data.hcloud_ssh_key.main.public_key}
    ssh_pwauth: false
    disable_root: true

    runcmd:
      # Restart SSH to use the persistent host keys written above
      - systemctl restart ssh
      - curl -sfL https://get.k3s.io -o /tmp/install-k3s.sh
      - chmod +x /tmp/install-k3s.sh
      - INSTALL_K3S_EXEC="--disable traefik --tls-san k8s.${var.production_domain} --tls-san k8s-api.${var.production_domain}" /tmp/install-k3s.sh
      - rm /tmp/install-k3s.sh
      - mkdir -p /home/${var.server_username}/.kube
      - cp /etc/rancher/k3s/k3s.yaml /home/${var.server_username}/.kube/config
      - chown -R ${var.server_username}:${var.server_username} /home/${var.server_username}/.kube
  EOF

  create_firewall = true
  allowed_ssh_ips = var.allowed_ssh_ips

  # Ports 80/443 closed - traffic routes through Cloudflare Tunnel
  firewall_rules = [
    {
      direction  = "in"
      protocol   = "tcp"
      port       = "6443"
      source_ips = var.allowed_k8s_api_ips
    },
    {
      direction  = "in"
      protocol   = "icmp"
      source_ips = ["0.0.0.0/0", "::/0"]
    }
  ]

  labels = {
    environment = "prod"
    stack       = "k8s"
  }
}

# Cloudflare zone lookup for DNS records
data "cloudflare_zone" "production" {
  account_id = var.cloudflare_account_id
  name       = var.production_domain
}

# Cloudflare Tunnel - routes traffic through Cloudflare without exposing public IP
module "tunnel" {
  source = "../../../modules/cloudflare-tunnel"

  account_id          = var.cloudflare_account_id
  zone_id             = data.cloudflare_zone.production.id
  lookup_zone_by_name = false
  tunnel_name         = "k8s-prod"

  ingress_rules = [
    {
      hostname = "k8s.${var.production_domain}"
      service  = "http://localhost:80"
    },
    {
      hostname = "*.k8s.${var.production_domain}"
      service  = "http://localhost:80"
    }
  ]
}

# Direct DNS records for SSH access (not proxied through tunnel)
resource "cloudflare_record" "k8s_ssh" {
  for_each = {
    A    = module.server.ipv4_address
    AAAA = module.server.ipv6_address
  }

  zone_id = data.cloudflare_zone.production.id
  name    = "k8s-ssh.${var.production_domain}"
  type    = each.key
  content = each.value
  proxied = false
  ttl     = 1
}

# Direct DNS records for Kubernetes API access (not proxied through tunnel)
resource "cloudflare_record" "k8s_api" {
  for_each = {
    A    = module.server.ipv4_address
    AAAA = module.server.ipv6_address
  }

  zone_id = data.cloudflare_zone.production.id
  name    = "k8s-api.${var.production_domain}"
  type    = each.key
  content = each.value
  proxied = false
  ttl     = 1
}
