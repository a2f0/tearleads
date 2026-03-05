module "ses" {
  source = "../../../modules/aws-ses"

  domain        = var.domain
  environment   = "staging"
  iam_user_name = "tearleads-staging-ses-smtp"

  tags = {
    Project = "tearleads"
    Stack   = "ses"
  }
}

# DNS verification records via Cloudflare

data "cloudflare_zone" "this" {
  account_id = var.cloudflare_account_id
  name       = var.dns_domain
}

# SES domain verification TXT record
resource "cloudflare_record" "ses_verification" {
  zone_id = data.cloudflare_zone.this.id
  name    = "_amazonses.${var.domain}"
  type    = "TXT"
  content = module.ses.domain_verification_token
  ttl     = 300
}

# DKIM CNAME records (3 tokens)
resource "cloudflare_record" "ses_dkim" {
  for_each = toset(module.ses.dkim_tokens)

  zone_id = data.cloudflare_zone.this.id
  name    = "${each.value}._domainkey.${var.domain}"
  type    = "CNAME"
  content = "${each.value}.dkim.amazonses.com"
  ttl     = 300
}
