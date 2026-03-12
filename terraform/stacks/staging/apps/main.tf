
# COMPLIANCE_SENTINEL: TL-SEC-003 | control=secrets-management
resource "helm_release" "vault" {
  name             = "vault"
  repository       = "https://helm.releases.hashicorp.com"
  chart            = "vault"
  version          = "0.27.0"
  namespace        = "vault"
  create_namespace = true

  set {
    name  = "server.dev.enabled"
    value = "false"
  }

  set {
    name  = "server.standalone.enabled"
    value = "true"
  }
}

locals {
  loki_url_normalized = trimsuffix(var.loki_url, "/")
  loki_push_url       = can(regex("/loki/api/v1/push$", local.loki_url_normalized)) ? local.loki_url_normalized : "${local.loki_url_normalized}/loki/api/v1/push"
}

# COMPLIANCE_SENTINEL: TL-OBS-001 | control=centralized-logging
resource "helm_release" "grafana_k8s_monitoring" {
  name             = "grafana-k8s-monitoring"
  repository       = "https://grafana.github.io/helm-charts"
  chart            = "k8s-monitoring"
  namespace        = "monitoring"
  create_namespace = true

  set {
    name  = "cluster.name"
    value = var.cluster_name
  }

  set {
    name  = "destinations[0].name"
    value = var.loki_destination_name
  }

  set {
    name  = "destinations[0].type"
    value = "loki"
  }

  set {
    name  = "destinations[0].url"
    value = local.loki_push_url
  }

  set {
    name  = "destinations[0].auth.type"
    value = "basic"
  }

  set {
    name  = "destinations[0].auth.username"
    value = var.loki_username
  }

  set_sensitive {
    name  = "destinations[0].auth.password"
    value = var.loki_api_token
  }

  set {
    name  = "clusterEvents.enabled"
    value = "true"
  }

  set {
    name  = "alloy-singleton.enabled"
    value = "true"
  }

  set {
    name  = "podLogs.enabled"
    value = "true"
  }

  set {
    name  = "alloy-logs.enabled"
    value = "true"
  }

  set {
    name  = "clusterMetrics.enabled"
    value = "false"
  }

  set {
    name  = "applicationObservability.enabled"
    value = "false"
  }
}
