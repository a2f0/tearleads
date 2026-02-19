# Lookup SSH key for cloud-init user_data
data "hcloud_ssh_key" "main" {
  name = var.ssh_key_name
}

module "server" {
  source = "../../../modules/hetzner-server"

  name         = "k8s-${var.staging_domain}"
  ssh_key_name = var.ssh_key_name
  server_type  = var.server_type
  location     = var.server_location

  user_data = <<-EOF
    #cloud-config
    write_files:
      - path: /etc/ssh/ssh_host_ed25519_key
        owner: root:root
        permissions: '0600'
        content: |
          ${indent(10, var.ssh_host_private_key)}
      - path: /etc/ssh/ssh_host_ed25519_key.pub
        owner: root:root
        permissions: '0644'
        content: |
          ${indent(10, var.ssh_host_public_key)}
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
      - INSTALL_K3S_EXEC="--disable traefik --tls-san k8s.${var.staging_domain} --tls-san k8s-api.${var.staging_domain}" /tmp/install-k3s.sh
      - rm /tmp/install-k3s.sh
      - mkdir -p /home/${var.server_username}/.kube
      - cp /etc/rancher/k3s/k3s.yaml /home/${var.server_username}/.kube/config
      - chown -R ${var.server_username}:${var.server_username} /home/${var.server_username}/.kube
  EOF

  create_firewall = true
  allowed_ssh_ips = var.allowed_ssh_ips

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
      source_ips = var.allowed_k8s_api_ips
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

data "cloudflare_zone" "staging" {
  account_id = var.cloudflare_account_id
  name       = var.staging_domain
}

# Cloudflare Tunnel - routes staging traffic through Cloudflare
module "tunnel" {
  source = "../../../modules/cloudflare-tunnel"

  account_id          = var.cloudflare_account_id
  zone_id             = data.cloudflare_zone.staging.id
  zone_name           = var.staging_domain
  lookup_zone_by_name = false
  tunnel_name         = "k8s-staging"
  create_dns_records  = false

  ingress_rules = [
    {
      hostname = "k8s.${var.staging_domain}"
      service  = "http://ingress-nginx-controller.ingress-nginx.svc.cluster.local:80"
    },
    {
      hostname = "app.k8s.${var.staging_domain}"
      service  = "http://ingress-nginx-controller.ingress-nginx.svc.cluster.local:80"
    },
    {
      hostname = "api.k8s.${var.staging_domain}"
      service  = "http://ingress-nginx-controller.ingress-nginx.svc.cluster.local:80"
    }
  ]
}

locals {
  ingress_hostnames = [
    "k8s.${var.staging_domain}",
    "app.k8s.${var.staging_domain}",
    "api.k8s.${var.staging_domain}"
  ]
}

resource "cloudflare_record" "k8s_ingress" {
  for_each = {
    for record in flatten([
      for hostname in local.ingress_hostnames : [
        {
          key      = "${hostname}-A"
          hostname = hostname
          type     = "A"
          content  = module.server.ipv4_address
        },
        {
          key      = "${hostname}-AAAA"
          hostname = hostname
          type     = "AAAA"
          content  = module.server.ipv6_address
        }
      ]
    ]) : record.key => record
  }

  zone_id = data.cloudflare_zone.staging.id
  name    = each.value.hostname
  type    = each.value.type
  content = each.value.content
  proxied = false
  ttl     = 1
}

resource "cloudflare_record" "k8s_api" {
  for_each = {
    A    = module.server.ipv4_address
    AAAA = module.server.ipv6_address
  }

  zone_id = data.cloudflare_zone.staging.id
  name    = "k8s-api.${var.staging_domain}"
  type    = each.key
  content = each.value
  proxied = false
  ttl     = 1
}
