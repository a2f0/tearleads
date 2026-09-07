terraform {
  required_version = ">= 1.16, < 2.0"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = ">= 1.68"
    }
  }
}
