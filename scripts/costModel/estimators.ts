import { parseAllTerraform } from './parsers/terraform';
import {
  getAzureStorageCost,
  getAzureVmCost,
  getHetznerServerCost
} from './providers';
import type {
  CostBreakdown,
  Provider,
  ResourceCost,
  ResourceType
} from './types';

const DEFAULTS = {
  hetzner: {
    server_type: 'cx22',
    server_location: 'hel1'
  },
  azure: {
    vm_size: 'Standard_DC2as_v5',
    azure_location: 'eastus',
    disk_size_gb: 30
  }
};

function toStringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toDiskSizeGb(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return DEFAULTS.azure.disk_size_gb;
}

function getValueOrDefault(
  rawValue: string | undefined,
  defaultValue: string
): string {
  return rawValue?.startsWith('var.') ? defaultValue : rawValue || defaultValue;
}

/**
 * Calculate cost for a single resource
 */
function calculateResourceCost(
  resourceType: string,
  resourceName: string,
  attributes: Record<string, unknown>
): ResourceCost | null {
  const breakdown: CostBreakdown = {};
  let provider: Provider;
  let type: ResourceType;
  let sku: string;
  let location: string;
  let monthlyCostUsd = 0;

  if (resourceType === 'hcloud_server') {
    provider = 'hetzner';
    type = 'compute';

    const rawServerType = toStringValue(attributes.server_type);
    const rawLocation = toStringValue(attributes.location);

    sku = getValueOrDefault(rawServerType, DEFAULTS.hetzner.server_type);
    location = getValueOrDefault(rawLocation, DEFAULTS.hetzner.server_location);

    const computeCost = getHetznerServerCost(sku, location);
    if (computeCost !== null) {
      breakdown.compute = computeCost;
      monthlyCostUsd += computeCost;
    }
  } else if (resourceType === 'azurerm_linux_virtual_machine') {
    provider = 'azure';
    type = 'compute';

    const rawSize = toStringValue(attributes.size);
    const rawLocation = toStringValue(attributes.location);
    const diskSizeGb = toDiskSizeGb(attributes.disk_size_gb);

    sku = getValueOrDefault(rawSize, DEFAULTS.azure.vm_size);
    location = getValueOrDefault(rawLocation, DEFAULTS.azure.azure_location);

    const computeCost = getAzureVmCost(sku, location);
    if (computeCost !== null) {
      breakdown.compute = computeCost;
      monthlyCostUsd += computeCost;
    }

    // Add storage cost for OS disk
    const storageCost = getAzureStorageCost(diskSizeGb, location);
    breakdown.storage = storageCost;
    monthlyCostUsd += storageCost;

    // Note: bandwidth costs would need usage data
    breakdown.bandwidth = 0;
  } else {
    return null;
  }

  return {
    resourceId: `${resourceType}.${resourceName}`,
    provider,
    type,
    sku,
    location,
    monthlyCostUsd: Math.round(monthlyCostUsd * 100) / 100,
    breakdown
  };
}

export interface EstimateResult {
  resources: ResourceCost[];
  totalMonthlyCostUsd: number;
  providerTotals: Record<Provider, number>;
}

/**
 * Estimate costs for all infrastructure
 */
export function estimateCosts(projectRoot: string): EstimateResult {
  const tfResources = parseAllTerraform(projectRoot);
  const resources: ResourceCost[] = [];
  const providerTotals: Record<Provider, number> = {
    hetzner: 0,
    azure: 0
  };

  for (const tfResourceList of Object.values(tfResources)) {
    for (const tf of tfResourceList) {
      const cost = calculateResourceCost(tf.type, tf.name, tf.attributes);
      if (cost) {
        resources.push(cost);
        providerTotals[cost.provider] += cost.monthlyCostUsd;
      }
    }
  }

  const totalMonthlyCostUsd = Object.values(providerTotals).reduce(
    (sum, v) => sum + v,
    0
  );

  return {
    resources,
    totalMonthlyCostUsd: Math.round(totalMonthlyCostUsd * 100) / 100,
    providerTotals: {
      hetzner: Math.round(providerTotals.hetzner * 100) / 100,
      azure: Math.round(providerTotals.azure * 100) / 100
    }
  };
}
