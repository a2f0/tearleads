locals {
  hostname_suffix = var.deployment_tier == "staging" ? "-staging" : ""
  api_hostname    = "api${local.hostname_suffix}.${var.domain}"
  app_hostname    = "app${local.hostname_suffix}.${var.domain}"
  demo_hostname   = "demo${local.hostname_suffix}.${var.domain}"
  # Demo hosts outside this stack's zone (e.g. demo.tearleads.de) ride the same
  # tunnel; only their DNS records live in another zone.
  extra_demo_hostnames   = { for domain in var.extra_demo_domains : domain => "demo${local.hostname_suffix}.${domain}" }
  demo_hostnames         = concat([local.demo_hostname], values(local.extra_demo_hostnames))
  primary_zone_hostnames = toset([local.website_hostname, local.app_hostname, local.demo_hostname, local.api_hostname])
  tailscale_hostname     = var.deployment_tier
  tunnel_cname           = module.tunnel.tunnel_cname
  tunnel_http_service    = "http://localhost:80"
  website_hostname       = var.deployment_tier == "staging" ? "website-staging.${var.domain}" : var.domain
}

data "hcloud_ssh_key" "main" {
  name = var.ssh_key_name
}

module "server" {
  source = "../../../modules/hetzner-server"

  name        = "${var.deployment_tier}-${var.domain}"
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
    environment = var.deployment_tier
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

moved {
  from = module.website_cache
  to   = module.website_cache[0]
}

module "website_cache" {
  count  = var.manage_website_cache ? 1 : 0
  source = "../../../modules/cloudflare-website-cache"

  zone_id              = data.cloudflare_zone.production.id
  hostname             = local.website_hostname
  additional_hostnames = var.website_cache_additional_hostnames
}

module "tunnel" {
  source = "../../../modules/cloudflare-tunnel"

  account_id          = var.cloudflare_account_id
  zone_id             = data.cloudflare_zone.production.id
  lookup_zone_by_name = false
  tunnel_name         = var.deployment_tier
  create_dns_records  = false

  ingress_rules = concat(
    [
      {
        hostname = local.website_hostname
        service  = local.tunnel_http_service
      },
      {
        hostname = local.app_hostname
        service  = local.tunnel_http_service
      },
      {
        hostname = local.api_hostname
        service  = local.tunnel_http_service
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
  name    = local.extra_demo_hostnames[each.key]
  type    = "CNAME"
  content = local.tunnel_cname
  proxied = true
  ttl     = 1

  lifecycle {
    precondition {
      # primary_zone_tunnel already publishes this tier's own demo host.
      condition     = !contains(var.extra_demo_domains, var.domain)
      error_message = "extra_demo_domains must not repeat this tier's own domain."
    }
  }
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
