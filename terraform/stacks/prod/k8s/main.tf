# Lookup SSH key for cloud-init user_data
data "hcloud_ssh_key" "main" {
  name = var.ssh_key_name
}

module "server" {
  source = "../../../modules/hetzner-server"

  name         = "k8s-prod-${var.production_domain}"
  ssh_key_name = var.ssh_key_name
  server_type  = var.server_type
  location     = var.server_location

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

    runcmd:
      - curl -sfL https://get.k3s.io -o /tmp/install-k3s.sh
      - chmod +x /tmp/install-k3s.sh
      - INSTALL_K3S_EXEC="--disable traefik --tls-san k8s.${var.production_domain}" /tmp/install-k3s.sh
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
      source_ips = ["0.0.0.0/0", "::/0"]
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

# Cloudflare Tunnel - routes traffic through Cloudflare without exposing public IP
module "tunnel" {
  source = "../../../modules/cloudflare-tunnel"

  account_id  = var.cloudflare_account_id
  zone_name   = var.production_domain
  tunnel_name = "k8s-prod"

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
