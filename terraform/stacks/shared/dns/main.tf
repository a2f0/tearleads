provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

data "cloudflare_zone" "main" {
  account_id = var.cloudflare_account_id
  name       = var.dns_domain
}

resource "cloudflare_record" "mx" {
  for_each = var.manage_mx_records ? {
    for record in var.mx_records :
    "${record.priority}-${record.target}" => record
  } : {}

  zone_id  = data.cloudflare_zone.main.id
  name     = var.dns_domain
  type     = "MX"
  content  = each.value.target
  priority = each.value.priority
  proxied  = false
  ttl      = var.mx_ttl
}

resource "cloudflare_record" "google_site_verification" {
  for_each = var.manage_google_site_verification_records ? {
    for token in var.google_site_verification_tokens : token => token
  } : {}

  zone_id = data.cloudflare_zone.main.id
  name    = var.dns_domain
  type    = "TXT"
  content = each.value
  proxied = false
  ttl     = var.txt_ttl
}
