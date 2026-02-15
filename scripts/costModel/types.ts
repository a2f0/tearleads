/**
 * Cost model type definitions
 */

export type Provider = 'hetzner' | 'azure';

export type ResourceType =
  | 'compute'
  | 'storage'
  | 'network'
  | 'dns'
  | 'firewall'
  | 'kms'
  | 'identity';

export interface ResourceCost {
  /** Resource identifier from terraform */
  resourceId: string;
  /** Provider (hetzner, azure) */
  provider: Provider;
  /** Resource category */
  type: ResourceType;
  /** Specific resource details (e.g., "cx23", "Standard_DC2as_v5") */
  sku: string;
  /** Deployment region/location */
  location: string;
  /** Estimated monthly cost in USD */
  monthlyCostUsd: number;
  /** Breakdown of cost components */
  breakdown: CostBreakdown;
}

export interface CostBreakdown {
  /** Base compute/instance cost */
  compute?: number;
  /** Storage costs (disk, snapshots) */
  storage?: number;
  /** Network/bandwidth costs */
  bandwidth?: number;
  /** DNS query costs */
  dns?: number;
  /** Key management costs */
  kms?: number;
  /** Other/miscellaneous */
  other?: number;
}

export interface CostSnapshot {
  /** ISO timestamp when snapshot was taken */
  timestamp: string;
  /** Git commit hash at snapshot time */
  gitCommit: string;
  /** Total estimated monthly cost */
  totalMonthlyCostUsd: number;
  /** Per-provider totals */
  providerTotals: Record<Provider, number>;
  /** Individual resource costs */
  resources: ResourceCost[];
}

export interface ProviderPricing {
  /** Provider name */
  provider: Provider;
  /** Last updated timestamp */
  lastUpdated: string;
  /** Compute instance pricing by SKU and region */
  compute: Record<string, RegionalPricing>;
  /** Storage pricing per GB by type and region */
  storage: Record<string, RegionalPricing>;
  /** Bandwidth pricing per GB (egress) by region */
  bandwidth: Record<string, number>;
}

export interface RegionalPricing {
  /** Price by region/location code */
  [region: string]: number;
}

export interface TerraformResource {
  /** Resource type (e.g., "hcloud_server", "azurerm_linux_virtual_machine") */
  type: string;
  /** Resource name in terraform */
  name: string;
  /** Extracted attributes relevant to pricing */
  attributes: Record<string, unknown>;
  /** Source file path */
  sourceFile: string;
}
