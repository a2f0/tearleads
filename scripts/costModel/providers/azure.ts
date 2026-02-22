/**
 * Azure pricing data (focused on Confidential VMs)
 *
 * Pricing source: https://azure.microsoft.com/en-us/pricing/details/virtual-machines/linux/
 * Last verified: 2025-02 (update this when scraping new data)
 *
 * Azure DOES charge for bandwidth (egress)
 */

import type { ProviderPricing, RegionalPricing } from '../types';

// DCasv5-series (AMD SEV-SNP Confidential VMs) - monthly pricing in USD
// These are Linux pay-as-you-go prices, 730 hours/month
const DCASV5_SERIES_MONTHLY_USD: Record<string, RegionalPricing> = {
  standard_dc2as_v5: {
    // 2 vCPU, 8 GB RAM
    eastus: 88.33,
    eastus2: 88.33,
    westus2: 88.33,
    westus3: 88.33,
    westeurope: 97.82,
    northeurope: 93.44
  },
  standard_dc4as_v5: {
    // 4 vCPU, 16 GB RAM
    eastus: 176.66,
    eastus2: 176.66,
    westus2: 176.66,
    westus3: 176.66,
    westeurope: 195.64,
    northeurope: 186.88
  },
  standard_dc8as_v5: {
    // 8 vCPU, 32 GB RAM
    eastus: 353.32,
    eastus2: 353.32,
    westus2: 353.32,
    westus3: 353.32,
    westeurope: 391.28,
    northeurope: 373.76
  },
  standard_dc16as_v5: {
    // 16 vCPU, 64 GB RAM
    eastus: 706.64,
    eastus2: 706.64,
    westus2: 706.64,
    westus3: 706.64,
    westeurope: 782.56,
    northeurope: 747.52
  },
  standard_dc32as_v5: {
    // 32 vCPU, 128 GB RAM
    eastus: 1413.28,
    eastus2: 1413.28,
    westus2: 1413.28,
    westus3: 1413.28,
    westeurope: 1565.12,
    northeurope: 1495.04
  }
};

// Premium SSD managed disk pricing (USD/month)
const PREMIUM_SSD_MONTHLY_USD: Record<string, RegionalPricing> = {
  p4: {
    // 32 GB
    eastus: 5.28,
    eastus2: 5.28,
    westus2: 5.28,
    westus3: 5.28,
    westeurope: 5.86,
    northeurope: 5.57
  },
  p6: {
    // 64 GB
    eastus: 10.21,
    eastus2: 10.21,
    westus2: 10.21,
    westus3: 10.21,
    westeurope: 11.33,
    northeurope: 10.77
  },
  p10: {
    // 128 GB
    eastus: 19.71,
    eastus2: 19.71,
    westus2: 19.71,
    westus3: 19.71,
    westeurope: 21.87,
    northeurope: 20.78
  },
  p15: {
    // 256 GB
    eastus: 38.02,
    eastus2: 38.02,
    westus2: 38.02,
    westus3: 38.02,
    westeurope: 42.18,
    northeurope: 40.09
  },
  p20: {
    // 512 GB
    eastus: 73.22,
    eastus2: 73.22,
    westus2: 73.22,
    westus3: 73.22,
    westeurope: 81.23,
    northeurope: 77.21
  }
};

// Azure bandwidth/egress pricing (USD per GB after free tier)
// First 100 GB/month is free, then tiered pricing
const AZURE_BANDWIDTH_USD_PER_GB: Record<string, number> = {
  eastus: 0.087, // Zone 1
  eastus2: 0.087,
  westus2: 0.087,
  westus3: 0.087,
  westeurope: 0.087,
  northeurope: 0.087
};

const azurePricing: ProviderPricing = {
  provider: 'azure',
  lastUpdated: '2025-02-15',
  compute: DCASV5_SERIES_MONTHLY_USD,
  storage: PREMIUM_SSD_MONTHLY_USD,
  bandwidth: AZURE_BANDWIDTH_USD_PER_GB
};

export function getAzureVmCost(vmSize: string, region: string): number | null {
  const normalizedSize = vmSize.toLowerCase().replace(/-/g, '_');
  const pricing = azurePricing.compute[normalizedSize];
  if (!pricing) return null;
  return pricing[region] ?? pricing['eastus'] ?? null;
}

export function getAzureStorageCost(
  diskSizeGb: number,
  region: string
): number {
  // Map disk size to Premium SSD tier
  let tier: string;
  if (diskSizeGb <= 32) tier = 'p4';
  else if (diskSizeGb <= 64) tier = 'p6';
  else if (diskSizeGb <= 128) tier = 'p10';
  else if (diskSizeGb <= 256) tier = 'p15';
  else tier = 'p20';

  const pricing = azurePricing.storage[tier];
  return pricing?.[region] ?? pricing?.['eastus'] ?? 0;
}
