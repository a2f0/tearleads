locals {
  hostname_suffix = var.deployment_tier == "staging" ? "-staging" : ""
  api_hostname    = "api${local.hostname_suffix}.${var.domain}"
  app_hostname    = "app${local.hostname_suffix}.${var.domain}"
  demo_hostname   = "demo${local.hostname_suffix}.${var.domain}"
}

# Wrangler publishes each Worker before its domain is attached here. The
# Worker names are fixed in the packages' wrangler configurations.
module "api_domain" {
  source                = "../../../modules/cloudflare-website"
  cloudflare_account_id = var.cloudflare_account_id
  domain                = var.domain
  hostname              = local.api_hostname
  worker_name           = "tearleads-platform-api-${var.deployment_tier}"
}

module "app_domain" {
  source                = "../../../modules/cloudflare-website"
  cloudflare_account_id = var.cloudflare_account_id
  domain                = var.domain
  hostname              = local.app_hostname
  worker_name           = "tearleads-app-${var.deployment_tier}"
}

module "demo_domain" {
  source                = "../../../modules/cloudflare-website"
  cloudflare_account_id = var.cloudflare_account_id
  domain                = var.domain
  hostname              = local.demo_hostname
  worker_name           = "tearleads-demo-${var.deployment_tier}"
}
