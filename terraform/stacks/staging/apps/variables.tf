
variable "kubeconfig_path" {
  description = "Path to the kubeconfig file"
  type        = string
  default     = "~/.kube/config-staging-k8s"
}


variable "letsencrypt_email" {
  description = "The email address to use for Let's Encrypt registration"
  type        = string
}

variable "loki_url" {
  description = "Grafana Cloud Loki base URL or full push URL"
  type        = string
}

variable "loki_username" {
  description = "Grafana Cloud Loki username/tenant ID"
  type        = string
}

variable "loki_api_token" {
  description = "Grafana Cloud Loki API token"
  type        = string
  sensitive   = true
}
