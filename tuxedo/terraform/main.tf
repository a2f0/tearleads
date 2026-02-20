data "hcloud_ssh_key" "main" {
  name = var.ssh_key_name
}

resource "hcloud_server" "tuxedo" {
  name        = var.server_name
  image       = var.server_image
  server_type = var.server_type
  location    = var.server_location

  ssh_keys = [data.hcloud_ssh_key.main.id]

  user_data = <<-EOF
    #cloud-config
    # Prevent cloud-init from regenerating ed25519 key (we provide our own for stable identity)
    # Allow RSA/ECDSA generation since SSH needs them for compatibility
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
        groups: sudo, www-data
        shell: /bin/bash
        lock_passwd: false
        # NOPASSWD required for Ansible automation on this ephemeral dev server.
        # Security tradeoff acknowledged: SSH key auth + no root login mitigate risk.
        sudo: ALL=(ALL) NOPASSWD:ALL
        ssh_authorized_keys:
          - ${data.hcloud_ssh_key.main.public_key}
    ssh_pwauth: false
    disable_root: true

    runcmd:
      # Restart SSH to use the persistent host keys written above
      - systemctl restart ssh
  EOF

  labels = {
    environment = "tuxedo"
    service     = "tuxedo"
  }
}
