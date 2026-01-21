data "hcloud_ssh_key" "main" {
  name = var.ssh_key_name
}

resource "hcloud_server" "main" {
  name        = var.domain
  image       = "ubuntu-24.04"
  server_type = "cx23"
  # Location slug options include hel1 (Helsinki), fsn1, nbg1, ash, sin.
  location    = "hel1"

  ssh_keys = [data.hcloud_ssh_key.main.id]

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

  labels = {
    environment = var.domain
  }
}
