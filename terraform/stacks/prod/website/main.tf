module "website" {
  source                = "../../../modules/cloudflare-website"
  cloudflare_account_id = var.cloudflare_account_id
  domain                = var.domain
  hostname              = var.domain
  worker_name           = "tearleads-website-prod"
}

# Assets are built and published by a2f0/continuity with Wrangler.
module "continuity" {
  source                = "../../../modules/cloudflare-website"
  cloudflare_account_id = var.cloudflare_account_id
  domain                = var.domain
  hostname              = "continuity.${var.domain}"
  worker_name           = "tearleads-continuity"
}
