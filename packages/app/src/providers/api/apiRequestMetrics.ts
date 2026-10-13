import { ApiRequestMetrics } from "@tearleads/client-sdk";

// Page-lifetime ownership keeps counts through workspace/provider remounts.
// Explicit host namespaces isolate stores; hosts without one share a store
// per API, with counts still separated by identity.
const metricsByHost = new Map<string, ApiRequestMetrics>();

export function getApiRequestMetrics(
  apiBaseUrl: string,
  localIdentityNamespace: string | undefined,
): ApiRequestMetrics {
  const key = JSON.stringify([apiBaseUrl, localIdentityNamespace]);
  let metrics = metricsByHost.get(key);
  if (!metrics) {
    metrics = new ApiRequestMetrics();
    metricsByHost.set(key, metrics);
  }
  return metrics;
}
