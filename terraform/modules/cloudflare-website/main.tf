data "cloudflare_zone" "website" {
  filter = {
    account = { id = var.cloudflare_account_id }
    name    = var.domain
  }
}

# Wrangler publishes the named Worker before this domain is attached.
resource "cloudflare_workers_custom_domain" "website" {
  account_id = var.cloudflare_account_id
  zone_id    = data.cloudflare_zone.website.id
  hostname   = var.hostname
  service    = var.worker_name
}
