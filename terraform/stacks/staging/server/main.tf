locals {
  tailscale_hostname = "staging"
}

data "terraform_remote_state" "tailscale" {
  backend = "s3"
  config = {
    bucket = "tearleads-terraform-state"
    key    = "shared/tailscale/terraform.tfstate"
    region = "us-east-1"
  }
}

data "hcloud_ssh_key" "main" {
  name = var.ssh_key_name
}

module "server" {
  source = "../../../modules/hetzner-server"

  name        = "staging-${var.domain}"
  ssh_key_id  = data.hcloud_ssh_key.main.id
  server_type = var.server_type
  location    = var.server_location

  user_data = var.server_user_data != "" ? var.server_user_data : <<-EOF
    #cloud-config
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

    runcmd:
      - systemctl restart ssh
      - curl -fsSL https://tailscale.com/install.sh | sh
      - tailscale up --authkey=${data.terraform_remote_state.tailscale.outputs.staging_auth_key} --hostname=${local.tailscale_hostname}
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
      protocol   = "icmp"
      source_ips = ["0.0.0.0/0", "::/0"]
    }
  ]

  labels = {
    environment = "staging"
    stack       = "server"
  }
}

data "cloudflare_zone" "staging" {
  filter = {
    account = {
      id = var.cloudflare_account_id
    }
    name = var.domain
  }
}

module "tunnel" {
  source = "../../../modules/cloudflare-tunnel"

  account_id          = var.cloudflare_account_id
  zone_id             = data.cloudflare_zone.staging.id
  lookup_zone_by_name = false
  tunnel_name         = "staging"

  ingress_rules = [
    {
      hostname = var.domain
      service  = "http://localhost:80"
    },
    {
      hostname = "app.${var.domain}"
      service  = "http://localhost:80"
    },
    {
      hostname = "api.${var.domain}"
      service  = "http://localhost:80"
    }
  ]
}

resource "cloudflare_dns_record" "server" {
  for_each = {
    A    = module.server.ipv4_address
    AAAA = module.server.ipv6_address
  }

  zone_id = data.cloudflare_zone.staging.id
  name    = var.domain
  type    = each.key
  content = each.value
  proxied = false
  ttl     = 1
}

resource "terraform_data" "tailscale_destroy_cleanup" {
  input = {
    hostname  = local.tailscale_hostname
    api_token = var.tailscale_api_token
    server_id = module.server.server_id
  }

  provisioner "local-exec" {
    when = destroy
    environment = {
      TAILSCALE_API_TOKEN = self.input.api_token
    }
    command = "${path.module}/../../../scripts/cleanup-tailscale-device.sh ${self.input.hostname}"
  }
}
