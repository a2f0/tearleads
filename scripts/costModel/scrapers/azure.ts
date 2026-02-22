/**
 * Azure pricing scraper
 *
 * Uses Azure CLI (az) or Azure Retail Prices API to fetch pricing.
 * Note: Azure pricing is complex with region-specific rates.
 *
 * API Docs: https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices
 */

interface AzureRetailPrice {
  currencyCode: string;
  tierMinimumUnits: number;
  retailPrice: number;
  unitPrice: number;
  armRegionName: string;
  location: string;
  effectiveStartDate: string;
  meterId: string;
  meterName: string;
  productId: string;
  skuId: string;
  productName: string;
  skuName: string;
  serviceName: string;
  serviceId: string;
  serviceFamily: string;
  unitOfMeasure: string;
  type: string;
  isPrimaryMeterRegion: boolean;
  armSkuName: string;
}

/**
 * Fetch retail prices from Azure Pricing API (no auth required)
 *
 * Filters for:
 * - DCasv5 series VMs (Confidential VMs)
 * - Linux pricing
 * - Pay-as-you-go
 */
async function fetchRetailPrices(
  armSkuName: string,
  armRegionName: string = 'eastus'
): Promise<AzureRetailPrice[]> {
  const baseUrl = 'https://prices.azure.com/api/retail/prices';

  // Build OData filter for Confidential VMs
  const filter = [
    `armSkuName eq '${armSkuName}'`,
    `armRegionName eq '${armRegionName}'`,
    `priceType eq 'Consumption'`,
    `contains(meterName, 'Spot') eq false`
  ].join(' and ');

  const url = `${baseUrl}?$filter=${encodeURIComponent(filter)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as { Items: AzureRetailPrice[] };
    return data.Items;
  } catch (error) {
    console.error('Failed to fetch Azure retail prices:', error);
    return [];
  }
}

/**
 * Calculate monthly cost from hourly rate
 */
function monthlyFromHourly(hourlyRate: number): number {
  // 730 hours per month average
  return Math.round(hourlyRate * 730 * 100) / 100;
}

/**
 * Scrape Azure pricing for DCasv5 series (Confidential VMs)
 */
export async function scrapeAzurePricing(): Promise<void> {
  console.log('\nScraping Azure Retail Prices API...\n');

  const skus = [
    'Standard_DC2as_v5',
    'Standard_DC4as_v5',
    'Standard_DC8as_v5',
    'Standard_DC16as_v5'
  ];

  const regions = ['eastus', 'westus2', 'westeurope'];

  for (const sku of skus) {
    console.log(`\n${sku}:`);
    for (const region of regions) {
      const prices = await fetchRetailPrices(sku, region);
      const linuxPrice = prices.find(
        (p) =>
          p.productName.includes('Linux') &&
          !p.meterName.includes('Low Priority')
      );
      if (linuxPrice) {
        console.log(
          `  ${region}: $${linuxPrice.retailPrice}/hr ($${monthlyFromHourly(linuxPrice.retailPrice)}/mo)`
        );
      }
    }
  }
}
