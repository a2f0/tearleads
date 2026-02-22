/**
 * Hetzner Cloud pricing data
 *
 * Pricing source: https://www.hetzner.com/cloud
 * Last verified: 2025-02 (update this when scraping new data)
 *
 * Note: Hetzner does NOT charge for bandwidth/egress
 */

import type { ProviderPricing, RegionalPricing } from '../types';

// Hetzner locations and their display names
const HETZNER_LOCATIONS = {
  fsn1: 'Falkenstein, DE',
  nbg1: 'Nuremberg, DE',
  hel1: 'Helsinki, FI',
  ash: 'Ashburn, US',
  hil: 'Hillsboro, US',
  sin: 'Singapore'
} as const;

// Shared ARM instances (CX series) - monthly pricing in EUR
// Prices are the same across all locations
// Note: cx*1 is legacy naming, cx*2 is current, cx*3 exists for some tiers
const CX_SERIES_MONTHLY_EUR: Record<string, number> = {
  cx11: 3.29, // 1 vCPU, 2 GB RAM, 20 GB disk
  cx21: 5.39, // 2 vCPU, 4 GB RAM, 40 GB disk
  cx22: 5.39, // 2 vCPU, 4 GB RAM, 40 GB disk (current naming)
  cx23: 5.39, // 2 vCPU, 4 GB RAM, 40 GB disk (alias)
  cx31: 10.59, // 2 vCPU, 8 GB RAM, 80 GB disk
  cx32: 10.59, // 2 vCPU, 8 GB RAM, 80 GB disk (current naming)
  cx41: 18.59, // 4 vCPU, 16 GB RAM, 160 GB disk
  cx42: 18.59, // 4 vCPU, 16 GB RAM, 160 GB disk (current naming)
  cx51: 35.59, // 8 vCPU, 32 GB RAM, 240 GB disk
  cx52: 35.59 // 8 vCPU, 32 GB RAM, 240 GB disk (current naming)
};

// Dedicated vCPU instances (CCX series) - monthly pricing in EUR
const CCX_SERIES_MONTHLY_EUR: Record<string, number> = {
  ccx13: 12.99, // 2 vCPU, 8 GB RAM, 80 GB disk
  ccx23: 24.99, // 4 vCPU, 16 GB RAM, 160 GB disk
  ccx33: 49.99, // 8 vCPU, 32 GB RAM, 240 GB disk
  ccx43: 99.99, // 16 vCPU, 64 GB RAM, 360 GB disk
  ccx53: 189.99, // 32 vCPU, 128 GB RAM, 600 GB disk
  ccx63: 359.99 // 48 vCPU, 192 GB RAM, 960 GB disk
};

// Standard instances (CPX series - AMD) - monthly pricing in EUR
const CPX_SERIES_MONTHLY_EUR: Record<string, number> = {
  cpx11: 4.49, // 2 vCPU, 2 GB RAM, 40 GB disk
  cpx21: 7.49, // 3 vCPU, 4 GB RAM, 80 GB disk
  cpx31: 13.49, // 4 vCPU, 8 GB RAM, 160 GB disk
  cpx41: 25.49, // 8 vCPU, 16 GB RAM, 240 GB disk
  cpx51: 48.99 // 16 vCPU, 32 GB RAM, 360 GB disk
};

// CAX ARM64 instances - monthly pricing in EUR
const CAX_SERIES_MONTHLY_EUR: Record<string, number> = {
  cax11: 3.79, // 2 vCPU, 4 GB RAM, 40 GB disk
  cax21: 6.49, // 4 vCPU, 8 GB RAM, 80 GB disk
  cax31: 12.49, // 8 vCPU, 16 GB RAM, 160 GB disk
  cax41: 23.99 // 16 vCPU, 32 GB RAM, 320 GB disk
};

// EUR to USD conversion (approximate, should be fetched dynamically)
const EUR_TO_USD = 1.08;

function eurToUsd(eurPrices: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(eurPrices).map(([sku, eur]) => [
      sku,
      Math.round(eur * EUR_TO_USD * 100) / 100
    ])
  );
}

// Combine all server types and convert to USD
const ALL_SERVER_TYPES_USD = {
  ...eurToUsd(CX_SERIES_MONTHLY_EUR),
  ...eurToUsd(CCX_SERIES_MONTHLY_EUR),
  ...eurToUsd(CPX_SERIES_MONTHLY_EUR),
  ...eurToUsd(CAX_SERIES_MONTHLY_EUR)
};

// Convert flat pricing to regional pricing (same price for all regions)
function toRegionalPricing(
  prices: Record<string, number>
): Record<string, RegionalPricing> {
  const result: Record<string, RegionalPricing> = {};
  for (const [sku, price] of Object.entries(prices)) {
    result[sku] = Object.fromEntries(
      Object.keys(HETZNER_LOCATIONS).map((loc) => [loc, price])
    );
  }
  return result;
}

// Volume storage pricing (EUR/GB/month)
const VOLUME_STORAGE_EUR_PER_GB = 0.052;

const hetznerPricing: ProviderPricing = {
  provider: 'hetzner',
  lastUpdated: '2025-02-15',
  compute: toRegionalPricing(ALL_SERVER_TYPES_USD),
  storage: toRegionalPricing({
    volume: Math.round(VOLUME_STORAGE_EUR_PER_GB * EUR_TO_USD * 1000) / 1000
  }),
  // Hetzner does not charge for bandwidth
  bandwidth: Object.fromEntries(
    Object.keys(HETZNER_LOCATIONS).map((loc) => [loc, 0])
  )
};

export function getHetznerServerCost(
  serverType: string,
  location: string
): number | null {
  const pricing = hetznerPricing.compute[serverType.toLowerCase()];
  if (!pricing) return null;
  return pricing[location] ?? pricing['fsn1'] ?? null;
}
