# Lookup SSH key for cloud-init user_data
data "hcloud_ssh_key" "main" {
  name = var.SSH_KEY_NAME
}

module "server" {
  source = "../../../modules/hetzner-server"

  name         = "k8s-${var.STAGING_DOMAIN}"
  ssh_key_name = var.SSH_KEY_NAME
  server_type  = var.SERVER_TYPE
  location     = var.SERVER_LOCATION

  user_data = <<-EOF
    #cloud-config
    users:
      - name: ${var.SERVER_USERNAME}
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
      - INSTALL_K3S_EXEC="--disable traefik --tls-san k8s.${var.STAGING_DOMAIN}" /tmp/install-k3s.sh
      - rm /tmp/install-k3s.sh
      - mkdir -p /home/${var.SERVER_USERNAME}/.kube
      - cp /etc/rancher/k3s/k3s.yaml /home/${var.SERVER_USERNAME}/.kube/config
      - chown -R ${var.SERVER_USERNAME}:${var.SERVER_USERNAME} /home/${var.SERVER_USERNAME}/.kube
  EOF

  create_firewall = true
  allowed_ssh_ips = var.ALLOWED_SSH_IPS

  firewall_rules = [
    {
      direction  = "in"
      protocol   = "tcp"
      port       = "80"
      source_ips = ["0.0.0.0/0", "::/0"]
    },
    {
      direction  = "in"
      protocol   = "tcp"
      port       = "443"
      source_ips = ["0.0.0.0/0", "::/0"]
    },
    {
      direction  = "in"
      protocol   = "tcp"
      port       = "6443"
      source_ips = var.ALLOWED_K8S_API_IPS
    },
    {
      direction  = "in"
      protocol   = "icmp"
      source_ips = ["0.0.0.0/0", "::/0"]
    }
  ]

  labels = {
    environment = "staging"
    stack       = "k8s"
  }
}

module "dns" {
  source = "../../../modules/hetzner-dns"

  domain       = var.STAGING_DOMAIN
  ipv4_address = module.server.ipv4_address
  ipv6_address = module.server.ipv6_address

  create_apex_records = false
  subdomains          = toset(["k8s"])
  wildcard_subdomain  = "k8s"
  create_mx_records   = false
}
