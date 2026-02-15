# Lookup SSH key for cloud-init user_data
data "hcloud_ssh_key" "main" {
  name = var.ssh_key_name
}

module "server" {
  source = "../../../modules/hetzner-server"

  name         = "vault-staging"
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

    package_update: true
    packages:
      - gpg
      - curl

    runcmd:
      # Install HashiCorp GPG key and repo
      - curl -fsSL https://apt.releases.hashicorp.com/gpg | gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
      - echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" > /etc/apt/sources.list.d/hashicorp.list
      - apt-get update
      - apt-get install -y vault
      # Create vault data directory
      - mkdir -p /opt/vault/data
      - chown -R vault:vault /opt/vault
      # Enable and start vault
      - systemctl enable vault
      - systemctl start vault
  EOF

  create_firewall = true
  allowed_ssh_ips = var.allowed_ssh_ips

  firewall_rules = [
    {
      direction  = "in"
      protocol   = "tcp"
      port       = "8200"
      source_ips = var.allowed_vault_ips
    },
    {
      direction  = "in"
      protocol   = "icmp"
      source_ips = ["0.0.0.0/0", "::/0"]
    }
  ]

  labels = {
    environment = "staging"
    stack       = "vault"
  }
}

module "dns" {
  source = "../../../modules/hetzner-dns"

  domain       = var.staging_domain
  ipv4_address = module.server.ipv4_address
  ipv6_address = module.server.ipv6_address

  create_apex_records = false
  subdomains          = toset(["vault"])
  create_mx_records   = false
}
