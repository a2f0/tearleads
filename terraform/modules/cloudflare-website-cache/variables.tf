variable "zone_id" {
  description = "Cloudflare zone id containing the website hostname."
  type        = string
}

variable "hostname" {
  description = <<-EOT
    Exact hostname the cache rule applies to (e.g. tearleads.com). Matched with
    `http.host eq`, so it never widens to the api./app./demo. hosts sharing the
    zone.
  EOT
  type        = string
}
