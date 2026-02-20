locals {
  tailscale_hostname = "vault-prod"
}

# Read Tailscale stack outputs for tagged auth key
data "terraform_remote_state" "tailscale" {
  backend = "s3"
  config = {
    bucket = "tearleads-terraform-state"
    key    = "shared/tailscale/terraform.tfstate"
    region = "us-east-1"
  }
}

# Lookup SSH key for cloud-init user_data
data "hcloud_ssh_key" "main" {
  name = var.ssh_key_name
}

# Cleanup Tailscale device registration on destroy
# This prevents stale entries like vault-prod-1, vault-prod-2, etc.
resource "null_resource" "tailscale_cleanup" {
  triggers = {
    hostname  = local.tailscale_hostname
    api_token = var.tailscale_api_token
  }

  provisioner "local-exec" {
    when    = destroy
    command = <<-EOF
      echo "Cleaning up Tailscale devices matching '${self.triggers.hostname}'..."

      # List all devices and find ones matching our hostname pattern
      DEVICES=$(curl -s -H "Authorization: Bearer ${self.triggers.api_token}" \
        "https://api.tailscale.com/api/v2/tailnet/-/devices" | \
        jq -r '.devices[] | select(.hostname | startswith("${self.triggers.hostname}")) | "\(.id) \(.hostname)"')

      if [ -z "$DEVICES" ]; then
        echo "No matching devices found."
        exit 0
      fi

      echo "Found devices:"
      echo "$DEVICES"

      # Delete each matching device
      echo "$DEVICES" | while read -r ID NAME; do
        echo "Deleting device: $NAME ($ID)"
        curl -s -X DELETE -H "Authorization: Bearer ${self.triggers.api_token}" \
          "https://api.tailscale.com/api/v2/device/$ID"
      done

      echo "Tailscale cleanup complete."
    EOF
  }
}

module "server" {
  source = "../../../modules/hetzner-server"

  name         = "vault-prod"
  ssh_key_name = var.ssh_key_name
  server_type  = var.server_type
  location     = var.server_location

  # Cloud-init handles base setup only (SSH, Tailscale, Vault install)
  # Vault configuration is managed by Ansible: ansible/playbooks/vault.yml
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

    package_update: true
    packages:
      - gpg
      - curl

    runcmd:
      # Restart SSH to use the persistent host keys written above
      - systemctl restart ssh
      # Install Tailscale
      - curl -fsSL https://tailscale.com/install.sh | sh
      - tailscale up --authkey=${data.terraform_remote_state.tailscale.outputs.prod_vault_auth_key} --hostname=vault-prod
      # Install HashiCorp GPG key and repo
      - curl -fsSL https://apt.releases.hashicorp.com/gpg | gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
      - echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" > /etc/apt/sources.list.d/hashicorp.list
      - apt-get update
      - apt-get install -y vault
      # Create vault data directory (Ansible configures Vault itself)
      - mkdir -p /opt/vault/data
      - chown -R vault:vault /opt/vault
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
