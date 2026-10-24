module "website" {
  source                = "../../../modules/cloudflare-website"
  cloudflare_account_id = var.cloudflare_account_id
  domain                = var.domain
  hostname              = var.domain
  worker_name           = "tearleads-website-prod"
}

# Zone-wide: Cloudflare answers http:// on every proxied host in the zone,
# staging and continuity included, with a 301 to https:// before any Worker
# runs. Only this stack may own it; the staging stack shares the zone. The
# provider's destroy only forgets the setting, so a teardown leaves it on.
resource "cloudflare_zone_setting" "always_use_https" {
  zone_id    = module.website.zone_id
  setting_id = "always_use_https"
  value      = "on"
}
