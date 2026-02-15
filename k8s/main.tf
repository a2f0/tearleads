data "hcloud_ssh_key" "main" {
  name = var.ssh_key_name
}

resource "hcloud_server" "k8s" {
  name        = "k8s-${var.domain}"
  image       = "ubuntu-24.04"
  server_type = var.server_type
  location    = var.server_location

  ssh_keys = [data.hcloud_ssh_key.main.id]

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

    runcmd:
      - curl -sfL https://get.k3s.io -o /tmp/install-k3s.sh
      - chmod +x /tmp/install-k3s.sh
      - INSTALL_K3S_EXEC="--disable traefik --tls-san k8s.${var.domain}" /tmp/install-k3s.sh
      - rm /tmp/install-k3s.sh
      - mkdir -p /home/${var.server_username}/.kube
      - cp /etc/rancher/k3s/k3s.yaml /home/${var.server_username}/.kube/config
      - chown -R ${var.server_username}:${var.server_username} /home/${var.server_username}/.kube
  EOF

  labels = {
    environment = "k8s"
    domain      = var.domain
  }
}
