data "hcloud_ssh_key" "main" {
  name = var.ssh_key_name
}

resource "hcloud_server" "main" {
  name        = "example"
  image       = "ubuntu-24.04"
  server_type = "cx23"
  location    = "fsn1"

  ssh_keys = [data.hcloud_ssh_key.main.id]

  labels = {
    environment = "example"
  }
}
