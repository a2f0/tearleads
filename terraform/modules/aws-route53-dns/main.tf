# Look up existing Route 53 zone (read-only)
data "aws_route53_zone" "main" {
  name         = var.domain
  private_zone = false
}

# Apex A record
resource "aws_route53_record" "apex_a" {
  count = var.create_apex_records ? 1 : 0

  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.domain
  type    = "A"
  ttl     = var.ttl
  records = [var.ipv4_address]
}

# Apex AAAA record
resource "aws_route53_record" "apex_aaaa" {
  count = var.create_apex_records ? 1 : 0

  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.domain
  type    = "AAAA"
  ttl     = var.ttl
  records = [var.ipv6_address]
}

# Subdomain A records
resource "aws_route53_record" "subdomain_a" {
  for_each = var.subdomains

  zone_id = data.aws_route53_zone.main.zone_id
  name    = "${each.key}.${var.domain}"
  type    = "A"
  ttl     = var.ttl
  records = [var.ipv4_address]
}

# Subdomain AAAA records
resource "aws_route53_record" "subdomain_aaaa" {
  for_each = var.subdomains

  zone_id = data.aws_route53_zone.main.zone_id
  name    = "${each.key}.${var.domain}"
  type    = "AAAA"
  ttl     = var.ttl
  records = [var.ipv6_address]
}

# Wildcard A record
resource "aws_route53_record" "wildcard_a" {
  count = var.wildcard_subdomain != "" ? 1 : 0

  zone_id = data.aws_route53_zone.main.zone_id
  name    = "*.${var.wildcard_subdomain}.${var.domain}"
  type    = "A"
  ttl     = var.ttl
  records = [var.ipv4_address]
}

# Wildcard AAAA record
resource "aws_route53_record" "wildcard_aaaa" {
  count = var.wildcard_subdomain != "" ? 1 : 0

  zone_id = data.aws_route53_zone.main.zone_id
  name    = "*.${var.wildcard_subdomain}.${var.domain}"
  type    = "AAAA"
  ttl     = var.ttl
  records = [var.ipv6_address]
}

# MX record
resource "aws_route53_record" "mx" {
  count = var.create_mx_records ? 1 : 0

  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.domain
  type    = "MX"
  ttl     = var.mx_ttl
  records = ["${var.mx_priority} ${var.mx_hostname}.${var.domain}."]
}
