variable "zone_id" {
  description = "Cloudflare zone id containing the website hostname."
  type        = string
}

variable "hostname" {
  description = <<-EOT
    Exact hostname the cache rule applies to (e.g. tearleads.com). Matched with
    `http.host eq`, so it never widens to the API or app hosts sharing the zone.
  EOT
  type        = string
}

variable "additional_hostnames" {
  description = "Additional website hostnames in the same Cloudflare zone."
  type        = list(string)
  default     = []
}
