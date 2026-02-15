#!/usr/bin/env npx tsx
/**
 * Cost Model - Infrastructure cost estimation tool
 *
 * Usage:
 *   npx tsx scripts/costModel/index.ts estimate    # Estimate current costs
 *   npx tsx scripts/costModel/index.ts snapshot    # Save a cost snapshot
 *   npx tsx scripts/costModel/index.ts list        # List saved snapshots
 *   npx tsx scripts/costModel/index.ts scrape      # Scrape live pricing from providers
 *   npx tsx scripts/costModel/index.ts servers     # List active Hetzner servers
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import type {
  CostBreakdown,
  CostSnapshot,
  Provider,
  ResourceCost,
  ResourceType,
} from './types';
import { parseAllTerraform } from './parsers/terraform';
import {
  getHetznerServerCost,
  getAzureVmCost,
  getAzureStorageCost,
} from './providers';
import {
  scrapeHetznerInfo,
  fetchServers,
  isHcloudAvailable,
} from './scrapers/hetzner';
import { scrapeAzurePricing } from './scrapers/azure';

// Database modules are dynamically imported to avoid loading pg when not needed
type DbModule = typeof import('./db/postgres');
type QueriesModule = typeof import('./db/queries');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SNAPSHOTS_DIR = path.join(__dirname, 'snapshots');

// Default values for variables (should be configurable)
const DEFAULTS = {
  hetzner: {
    server_type: 'cx22',
    server_location: 'hel1',
  },
  azure: {
    vm_size: 'Standard_DC2as_v5',
    azure_location: 'eastus',
    disk_size_gb: 30,
  },
};

/**
 * Calculate cost for a single resource
 */
function calculateResourceCost(
  resourceType: string,
  attributes: Record<string, unknown>,
  sourceFile: string,
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

    // Resolve variable references to defaults
    const rawServerType = attributes.server_type as string;
    const rawLocation = attributes.location as string;

    sku =
      rawServerType?.startsWith('var.')
        ? DEFAULTS.hetzner.server_type
        : rawServerType || DEFAULTS.hetzner.server_type;

    location =
      rawLocation?.startsWith('var.')
        ? DEFAULTS.hetzner.server_location
        : rawLocation || DEFAULTS.hetzner.server_location;

    const computeCost = getHetznerServerCost(sku, location);
    if (computeCost !== null) {
      breakdown.compute = computeCost;
      monthlyCostUsd = computeCost;
    }
  } else if (resourceType === 'azurerm_linux_virtual_machine') {
    provider = 'azure';
    type = 'compute';

    const rawSize = attributes.size as string;
    const rawLocation = attributes.location as string;
    const diskSizeGb =
      (attributes.disk_size_gb as number) || DEFAULTS.azure.disk_size_gb;

    sku =
      rawSize?.startsWith('var.')
        ? DEFAULTS.azure.vm_size
        : rawSize || DEFAULTS.azure.vm_size;

    location =
      rawLocation?.startsWith('var.')
        ? DEFAULTS.azure.azure_location
        : rawLocation || DEFAULTS.azure.azure_location;

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
    resourceId: `${resourceType}.${path.basename(sourceFile, '.tf')}`,
    provider,
    type,
    sku,
    location,
    monthlyCostUsd: Math.round(monthlyCostUsd * 100) / 100,
    breakdown,
  };
}

/**
 * Estimate costs for all infrastructure
 */
function estimateCosts(): {
  resources: ResourceCost[];
  totalMonthlyCostUsd: number;
  providerTotals: Record<Provider, number>;
} {
  const tfResources = parseAllTerraform(PROJECT_ROOT);
  const resources: ResourceCost[] = [];
  const providerTotals: Record<Provider, number> = {
    hetzner: 0,
    azure: 0,
  };

  // Process Hetzner resources (terraform/ directory)
  for (const tf of tfResources.hetzner) {
    const cost = calculateResourceCost(tf.type, tf.attributes, tf.sourceFile);
    if (cost) {
      resources.push(cost);
      providerTotals[cost.provider] += cost.monthlyCostUsd;
    }
  }

  // Process Tuxedo resources (also Hetzner)
  for (const tf of tfResources.tuxedo) {
    const cost = calculateResourceCost(tf.type, tf.attributes, tf.sourceFile);
    if (cost) {
      resources.push(cost);
      providerTotals[cost.provider] += cost.monthlyCostUsd;
    }
  }

  // Process Azure resources (tee/ directory)
  for (const tf of tfResources.azure) {
    const cost = calculateResourceCost(tf.type, tf.attributes, tf.sourceFile);
    if (cost) {
      resources.push(cost);
      providerTotals[cost.provider] += cost.monthlyCostUsd;
    }
  }

  const totalMonthlyCostUsd = Object.values(providerTotals).reduce(
    (sum, v) => sum + v,
    0,
  );

  return {
    resources,
    totalMonthlyCostUsd: Math.round(totalMonthlyCostUsd * 100) / 100,
    providerTotals: {
      hetzner: Math.round(providerTotals.hetzner * 100) / 100,
      azure: Math.round(providerTotals.azure * 100) / 100,
    },
  };
}

/**
 * Get current git commit hash
 */
function getGitCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Save a cost snapshot
 */
function saveSnapshot(): string {
  const estimate = estimateCosts();
  const snapshot: CostSnapshot = {
    timestamp: new Date().toISOString(),
    gitCommit: getGitCommit(),
    totalMonthlyCostUsd: estimate.totalMonthlyCostUsd,
    providerTotals: estimate.providerTotals,
    resources: estimate.resources,
  };

  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }

  const filename = `snapshot-${snapshot.timestamp.replace(/[:.]/g, '-')}.json`;
  const filepath = path.join(SNAPSHOTS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2));

  return filepath;
}

/**
 * List saved snapshots
 */
function listSnapshots(): string[] {
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    return [];
  }
  return fs
    .readdirSync(SNAPSHOTS_DIR)
    .filter((f) => f.startsWith('snapshot-') && f.endsWith('.json'))
    .sort()
    .reverse();
}

/**
 * Check database credentials before running db-dependent commands
 */
function checkDbEnvVars(): { valid: boolean; missing: string[] } {
  const required = ['POSTGRES_READ_ONLY_PASSWORD', 'POSTGRES_DATABASE'];
  const missing = required.filter((key) => !process.env[key]);
  return { valid: missing.length === 0, missing };
}

function requireDbCredentials(): void {
  const { valid, missing } = checkDbEnvVars();
  if (!valid) {
    console.error('Missing required environment variables:');
    for (const key of missing) {
      console.error(`   - ${key}`);
    }
    console.error('\nSet these variables before running database commands:');
    console.error('  export POSTGRES_READ_ONLY_USER=costmodel_ro');
    console.error('  export POSTGRES_READ_ONLY_PASSWORD=<password>');
    console.error('  export POSTGRES_DATABASE=<database>');
    console.error('  export POSTGRES_HOST=<host>  # optional, default: localhost');
    console.error('  export POSTGRES_PORT=<port>  # optional, default: 5432');
    process.exit(1);
  }
}

/**
 * Main CLI handler
 */
async function main(): Promise<void> {
  const command = process.argv[2] || 'estimate';

  switch (command) {
    case 'estimate': {
      const estimate = estimateCosts();
      console.log('\nInfrastructure Cost Estimate (USD)\n');
      console.log('Provider Totals (monthly):');
      console.log(`  Hetzner:  $${estimate.providerTotals.hetzner.toFixed(2)} USD`);
      console.log(`  Azure:    $${estimate.providerTotals.azure.toFixed(2)} USD`);
      console.log(`  ────────────────────────`);
      console.log(`  Total:    $${estimate.totalMonthlyCostUsd.toFixed(2)} USD\n`);

      console.log('Resources:');
      for (const r of estimate.resources) {
        console.log(
          `  [${r.provider}] ${r.resourceId}: ${r.sku} @ ${r.location} = $${r.monthlyCostUsd.toFixed(2)}/mo`,
        );
        if (r.breakdown.compute)
          console.log(`           └─ compute: $${r.breakdown.compute.toFixed(2)}`);
        if (r.breakdown.storage)
          console.log(`           └─ storage: $${r.breakdown.storage.toFixed(2)}`);
        if (r.breakdown.bandwidth && r.breakdown.bandwidth > 0)
          console.log(`           └─ bandwidth: $${r.breakdown.bandwidth.toFixed(2)}`);
      }
      console.log();
      break;
    }

    case 'snapshot': {
      const filepath = saveSnapshot();
      console.log(`Snapshot saved: ${filepath}`);
      break;
    }

    case 'list': {
      const snapshots = listSnapshots();
      if (snapshots.length === 0) {
        console.log('No snapshots found.');
      } else {
        console.log('Saved snapshots:');
        for (const s of snapshots) {
          console.log(`  ${s}`);
        }
      }
      break;
    }

    case 'scrape': {
      console.log('Scraping live pricing data from providers...\n');
      scrapeHetznerInfo();
      // Azure scraping is async, run it
      scrapeAzurePricing().catch(console.error);
      break;
    }

    case 'servers': {
      if (!isHcloudAvailable()) {
        console.log('hcloud CLI not available');
        process.exit(1);
      }
      const servers = fetchServers();
      if (servers.length === 0) {
        console.log('No active Hetzner servers found.');
      } else {
        console.log('\nActive Hetzner Servers:\n');
        for (const srv of servers) {
          console.log(`  ${srv.name}`);
          console.log(`    Type:     ${srv.serverType}`);
          console.log(`    Location: ${srv.location}`);
          console.log(`    Status:   ${srv.status}`);
          console.log(`    IPv4:     ${srv.publicIpv4 ?? 'none'}`);
          console.log(`    Created:  ${srv.created}`);
          console.log();
        }
      }
      break;
    }

    case 'live': {
      // Estimate costs from actual live servers (not terraform definitions)
      console.log('\nLive Infrastructure Cost Estimate (USD)\n');

      let hetznerTotal = 0;
      const hetznerServers: Array<{
        name: string;
        type: string;
        location: string;
        cost: number;
      }> = [];

      if (isHcloudAvailable()) {
        const servers = fetchServers();
        for (const srv of servers) {
          const cost = getHetznerServerCost(srv.serverType, srv.location);
          if (cost !== null) {
            hetznerTotal += cost;
            hetznerServers.push({
              name: srv.name,
              type: srv.serverType,
              location: srv.location,
              cost,
            });
          }
        }
      }

      // Azure would need az CLI - for now use terraform estimate
      const tfEstimate = estimateCosts();
      const azureTotal = tfEstimate.providerTotals.azure;

      console.log('Provider Totals (monthly):');
      console.log(`  Hetzner (live):  $${hetznerTotal.toFixed(2)} USD`);
      console.log(`  Azure (tf est):  $${azureTotal.toFixed(2)} USD`);
      console.log(`  ──────────────────────────`);
      console.log(`  Total:           $${(hetznerTotal + azureTotal).toFixed(2)} USD\n`);

      if (hetznerServers.length > 0) {
        console.log('Hetzner Servers (live):');
        for (const srv of hetznerServers) {
          console.log(
            `  ${srv.name}: ${srv.type} @ ${srv.location} = $${srv.cost.toFixed(2)}/mo`,
          );
        }
        console.log();
      }

      if (tfEstimate.resources.filter((r) => r.provider === 'azure').length > 0) {
        console.log('Azure Resources (terraform estimate):');
        for (const r of tfEstimate.resources.filter((r) => r.provider === 'azure')) {
          console.log(
            `  ${r.resourceId}: ${r.sku} @ ${r.location} = $${r.monthlyCostUsd.toFixed(2)}/mo`,
          );
        }
        console.log();
      }
      break;
    }

    case 'billing': {
      requireDbCredentials();

      // Dynamic import to avoid loading pg when not needed
      const db = (await import('./db/postgres')) as DbModule;
      const queries = (await import('./db/queries')) as QueriesModule;

      console.log('\nConnecting to database...');
      const connected = await db.testConnection();
      if (!connected) {
        console.error('Failed to connect to database');
        process.exit(1);
      }

      console.log('\nUser Accounting Summary\n');

      // User counts
      const userCounts = await queries.getUserCountSummary();
      console.log('Users:');
      console.log(`  Total:    ${userCounts.totalUsers}`);
      console.log(`  Active:   ${userCounts.activeUsers}`);
      console.log(`  Disabled: ${userCounts.disabledUsers}`);

      // Billing status
      const billing = await queries.getOrganizationBilling();
      console.log(`\nOrganization Billing (${billing.length} accounts):`);
      const statusCounts: Record<string, number> = {};
      for (const b of billing) {
        statusCounts[b.entitlementStatus] =
          (statusCounts[b.entitlementStatus] ?? 0) + 1;
      }
      for (const [status, count] of Object.entries(statusCounts)) {
        console.log(`  ${status}: ${count}`);
      }

      // Subscriptions by product
      const subs = await queries.getSubscriptionsByProduct();
      if (subs.length > 0) {
        console.log('\nSubscriptions by Product:');
        for (const s of subs) {
          console.log(`  ${s.productId ?? 'none'} (${s.status}): ${s.count}`);
        }
      }

      // AI usage for current month
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const aiUsage = await queries.getAiUsageSummary(startOfMonth, endOfMonth);

      if (aiUsage.length > 0) {
        const totalTokens = aiUsage.reduce(
          (sum, u) => sum + Number(u.totalTokens),
          0,
        );
        const totalRequests = aiUsage.reduce(
          (sum, u) => sum + Number(u.requestCount),
          0,
        );
        console.log(`\nAI Usage (${now.toLocaleString('default', { month: 'long' })}):`);
        console.log(`  Total tokens:   ${totalTokens.toLocaleString()}`);
        console.log(`  Total requests: ${totalRequests.toLocaleString()}`);
        console.log(`  Organizations:  ${aiUsage.length}`);
      }

      await db.closePool();
      break;
    }

    default:
      console.log(`Unknown command: ${command}`);
      console.log('Usage: costModel estimate|live|snapshot|list|scrape|servers|billing');
      console.log('\nCommands:');
      console.log('  estimate  - Estimate costs from terraform definitions');
      console.log('  live      - Estimate costs from live provisioned servers');
      console.log('  snapshot  - Save a cost snapshot');
      console.log('  list      - List saved snapshots');
      console.log('  scrape    - Scrape live pricing from providers');
      console.log('  servers   - List active Hetzner servers');
      console.log('  billing   - Query postgres for user accounting (requires DB credentials)');
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
