
variable "kubeconfig_path" {
  description = "Path to the kubeconfig file"
  type        = string
  default     = "~/.kube/config-staging-k8s"
}


variable "letsencrypt_email" {
  description = "The email address to use for Let's Encrypt registration"
  type        = string
}
