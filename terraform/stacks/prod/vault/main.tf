# Lookup SSH key for cloud-init user_data
data "hcloud_ssh_key" "main" {
  name = var.ssh_key_name
}

module "server" {
  source = "../../../modules/hetzner-server"

  name         = "vault-prod"
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

  # No public Vault port - access via Cloudflare Tunnel only
  firewall_rules = [
    {
      direction  = "in"
      protocol   = "icmp"
      source_ips = ["0.0.0.0/0", "::/0"]
    }
  ]

  labels = {
    environment = "prod"
    stack       = "vault"
  }
}

# Cloudflare Tunnel for secure Vault access (no public port exposure)
module "tunnel" {
  source = "../../../modules/cloudflare-tunnel"

  account_id  = var.cloudflare_account_id
  zone_name   = var.production_domain
  tunnel_name = "vault-prod"

  ingress_rules = [
    {
      hostname = "vault.${var.production_domain}"
      service  = "http://localhost:8200"
    }
  ]
}
