locals {
  demo_hostnames             = concat(["demo.${var.domain}"], [for domain in var.extra_demo_domains : "demo.${domain}"])
  primary_zone_hostnames     = toset([var.domain, "app.${var.domain}", "demo.${var.domain}", "api.${var.domain}", "code-assist.${var.domain}"])
  tailscale_hostname         = "prod"
  tunnel_cname               = module.tunnel.tunnel_cname
  tunnel_http_service        = "http://localhost:80"
  tunnel_code_assist_service = "http://localhost:3939"
}

data "hcloud_ssh_key" "main" {
  name = var.ssh_key_name
}

module "server" {
  source = "../../../modules/hetzner-server"

  name        = "prod-${var.domain}"
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
      - |
        for i in {1..10}; do
          if systemctl is-active --quiet tailscaled; then
            tailscale up --authkey=${var.tailscale_auth_key} --hostname=${local.tailscale_hostname}
            break
          fi
          sleep 2
        done
  EOF

  create_firewall = true

  firewall_rules = [
    {
      direction  = "in"
      protocol   = "icmp"
      source_ips = ["0.0.0.0/0", "::/0"]
    }
  ]

  labels = {
    environment = "prod"
    stack       = "server"
  }

  depends_on = [
    terraform_data.cloudflare_tunnel_destroy_grace,
  ]
}

data "cloudflare_zone" "production" {
  filter = {
    account = {
      id = var.cloudflare_account_id
    }
    name = var.domain
  }
}

data "cloudflare_zone" "extra_demo" {
  for_each = toset(var.extra_demo_domains)

  filter = {
    account = {
      id = var.cloudflare_account_id
    }
    name = each.value
  }
}

module "website_cache" {
  source = "../../../modules/cloudflare-website-cache"

  zone_id  = data.cloudflare_zone.production.id
  hostname = var.domain
}

module "tunnel" {
  source = "../../../modules/cloudflare-tunnel"

  account_id          = var.cloudflare_account_id
  zone_id             = data.cloudflare_zone.production.id
  lookup_zone_by_name = false
  tunnel_name         = "prod"
  create_dns_records  = false

  ingress_rules = concat(
    [
      {
        hostname = var.domain
        service  = local.tunnel_http_service
      },
      {
        hostname = "app.${var.domain}"
        service  = local.tunnel_http_service
      },
      {
        hostname = "api.${var.domain}"
        service  = local.tunnel_http_service
      },
      {
        hostname = "code-assist.${var.domain}"
        service  = local.tunnel_code_assist_service
      }
    ],
    [
      for hostname in local.demo_hostnames : {
        hostname = hostname
        service  = local.tunnel_http_service
      }
    ]
  )
}

resource "cloudflare_dns_record" "primary_zone_tunnel" {
  for_each = local.primary_zone_hostnames

  zone_id = data.cloudflare_zone.production.id
  name    = each.value
  type    = "CNAME"
  content = local.tunnel_cname
  proxied = true
  ttl     = 1
}

resource "cloudflare_dns_record" "extra_demo_tunnel" {
  for_each = data.cloudflare_zone.extra_demo

  zone_id = each.value.id
  name    = "demo.${each.key}"
  type    = "CNAME"
  content = local.tunnel_cname
  proxied = true
  ttl     = 1
}

resource "terraform_data" "cloudflare_tunnel_destroy_grace" {
  input = {
    tunnel_id             = module.tunnel.tunnel_id
    destroy_grace_seconds = var.cloudflare_tunnel_destroy_grace_seconds
  }

  triggers_replace = [
    module.tunnel.tunnel_id
  ]

  provisioner "local-exec" {
    when    = destroy
    command = "echo 'Waiting ${self.input.destroy_grace_seconds}s for Cloudflare tunnel connections to close before deleting tunnel ${self.input.tunnel_id}.' >&2; sleep ${self.input.destroy_grace_seconds}"
  }
}

resource "terraform_data" "tailscale_destroy_cleanup" {
  input = {
    hostname = local.tailscale_hostname
    tailnet  = var.tailscale_tailnet_id
  }

  triggers_replace = [
    module.server.server_id
  ]

  provisioner "local-exec" {
    when    = destroy
    command = "${path.module}/../../../scripts/cleanup-tailscale-device.sh '${self.input.hostname}' '${self.input.tailnet != null ? self.input.tailnet : ""}'"
  }
}
