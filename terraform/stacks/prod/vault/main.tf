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
    # Prevent cloud-init from regenerating ed25519 key (we provide our own)
    # Allow RSA/ECDSA generation since SSH needs them
    ssh_deletekeys: false
    ssh_genkeytypes: ['rsa', 'ecdsa']

    write_files:
      - path: /etc/ssh/ssh_host_ed25519_key
        owner: root:root
        permissions: '0600'
        encoding: b64
        content: ${base64encode(var.ssh_host_private_key)}
      - path: /etc/ssh/ssh_host_ed25519_key.pub
        owner: root:root
        permissions: '0644'
        encoding: b64
        content: ${base64encode(var.ssh_host_public_key)}
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
      # Ensure trailing newline in key files (base64 decode may strip it)
      - sed -i -e '$a\' /etc/ssh/ssh_host_ed25519_key
      - sed -i -e '$a\' /etc/ssh/ssh_host_ed25519_key.pub
      # Restart SSH to use the persistent host keys written above
      - systemctl restart ssh
      # Install Tailscale
      - curl -fsSL https://tailscale.com/install.sh | sh
      - tailscale up --authkey=${var.tailscale_auth_key} --hostname=vault-prod
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

  # No public Vault port - access via Tailscale only
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
