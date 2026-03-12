output "vault_namespace" {
  description = "Namespace for vault"
  value       = helm_release.vault.namespace
}

output "grafana_k8s_monitoring_namespace" {
  description = "Namespace for Grafana k8s-monitoring components"
  value       = helm_release.grafana_k8s_monitoring.namespace
}

output "loki_push_url" {
  description = "Loki push URL used by Grafana k8s-monitoring"
  value       = local.loki_push_url
}
