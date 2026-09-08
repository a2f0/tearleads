module "website" {
  source                = "../../../modules/cloudflare-website"
  cloudflare_account_id = var.cloudflare_account_id
  domain                = var.domain
  hostname              = var.domain
  worker_name           = "tearleads-website-prod"
}
