# Lookup SSH key for cloud-init user_data
data "hcloud_ssh_key" "main" {
  name = var.ssh_key_name
}

locals {
  subdomains = toset(["www", "app", "api", "download", "email"])
}

module "server" {
  source = "../../../modules/hetzner-server"

  name         = var.staging_domain
  ssh_key_name = var.ssh_key_name
  server_type  = var.server_type
  location     = var.server_location

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
      port       = "25"
      source_ips = ["0.0.0.0/0", "::/0"]
    },
    {
      direction  = "in"
      protocol   = "icmp"
      source_ips = ["0.0.0.0/0", "::/0"]
    }
  ]

  labels = {
    environment = "staging"
    stack       = "dev-server"
  }
}

module "dns" {
  source = "../../../modules/hetzner-dns"

  domain       = var.staging_domain
  ipv4_address = module.server.ipv4_address
  ipv6_address = module.server.ipv6_address

  create_apex_records = true
  subdomains          = local.subdomains
  create_mx_records   = true
  mx_hostname         = "email"
}
