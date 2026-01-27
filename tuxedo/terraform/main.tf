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
    users:
      - name: ${var.server_username}
        groups: sudo, www-data
        shell: /bin/bash
        lock_passwd: false
        sudo: ALL=(ALL) ALL
        ssh_authorized_keys:
          - ${data.hcloud_ssh_key.main.public_key}
    ssh_pwauth: false
    disable_root: true
  EOF

  labels = {
    environment = "tuxedo"
    service     = "tuxedo"
  }
}
