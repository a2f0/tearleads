
# COMPLIANCE_SENTINEL: TL-K8S-001 | control=ingress-controller
resource "helm_release" "ingress_nginx" {
  name             = "ingress-nginx"
  repository       = "https://kubernetes.github.io/ingress-nginx"
  chart            = "ingress-nginx"
  version          = "4.10.0"
  namespace        = "ingress-nginx"
  create_namespace = true

  set {
    name  = "controller.service.externalTrafficPolicy"
    value = "Local"
  }
}

# COMPLIANCE_SENTINEL: TL-K8S-002 | control=cert-manager
resource "helm_release" "cert_manager" {
  name             = "cert-manager"
  repository       = "https://charts.jetstack.io"
  chart            = "cert-manager"
  version          = "v1.14.4"
  namespace        = "cert-manager"
  create_namespace = true

  set {
    name  = "installCRDs"
    value = "true"
  }
}

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


# COMPLIANCE_SENTINEL: TL-K8S-003 | control=letsencrypt-issuer
resource "kubernetes_manifest" "letsencrypt_issuer" {
  manifest = {
    "apiVersion" = "cert-manager.io/v1"
    "kind"       = "ClusterIssuer"
    "metadata" = {
      "name" = "letsencrypt-staging"
    }
    "spec" = {
      "acme" = {
        "server" = "https://acme-staging-v02.api.letsencrypt.org/directory"
        "email"  = var.letsencrypt_email
        "privateKeySecretRef" = {
          "name" = "letsencrypt-staging-key"
        }
        "solvers" = [
          {
            "http01" = {
              "ingress" = {
                "class" = "nginx"
              }
            }
          }
        ]
      }
    }
  }

  depends_on = [helm_release.cert_manager]
}

resource "kubernetes_manifest" "letsencrypt_prod_issuer" {
  manifest = {
    "apiVersion" = "cert-manager.io/v1"
    "kind"       = "ClusterIssuer"
    "metadata" = {
      "name" = "letsencrypt-prod"
    }
    "spec" = {
      "acme" = {
        "server" = "https://acme-v02.api.letsencrypt.org/directory"
        "email"  = var.letsencrypt_email
        "privateKeySecretRef" = {
          "name" = "letsencrypt-prod-key"
        }
        "solvers" = [
          {
            "http01" = {
              "ingress" = {
                "class" = "nginx"
              }
            }
          }
        ]
      }
    }
  }

  depends_on = [helm_release.cert_manager]
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
    value = "tearleads-staging"
  }

  set {
    name  = "destinations[0].name"
    value = "grafana-cloud-logs"
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
