#!/usr/bin/env -S npx tsx

/**
 * Cost Model - Infrastructure cost estimation tool
 *
 * Usage:
 *   ./scripts/costModel/index.ts estimate
 *   ./scripts/costModel/index.ts snapshot
 *   ./scripts/costModel/index.ts list
 *   ./scripts/costModel/index.ts scrape
 *   ./scripts/costModel/index.ts servers
 *   ./scripts/costModel/index.ts orphans [region]
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBillingSummary } from './commands/billing';
import { runLiveCostEstimate } from './commands/live';
import { runOrphanedResourcesScan } from './commands/orphans';
import { requireDbCredentials } from './dbCredentials';
import { estimateCosts } from './estimators';
import { scrapeAzurePricing } from './scrapers/azure';
import {
  fetchServers,
  isHcloudAvailable,
  scrapeHetznerInfo
} from './scrapers/hetzner';
import { listSnapshots, saveSnapshot } from './snapshotStore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SNAPSHOTS_DIR = path.join(__dirname, 'snapshots');

function printEstimate(): void {
  const estimate = estimateCosts(PROJECT_ROOT);
  console.log('\nInfrastructure Cost Estimate (USD)\n');
  console.log('Provider Totals (monthly):');
  console.log(`  Hetzner:  $${estimate.providerTotals.hetzner.toFixed(2)} USD`);
  console.log(`  Azure:    $${estimate.providerTotals.azure.toFixed(2)} USD`);
  console.log(`  ────────────────────────`);
  console.log(`  Total:    $${estimate.totalMonthlyCostUsd.toFixed(2)} USD\n`);

  console.log('Resources:');
  for (const r of estimate.resources) {
    console.log(
      `  [${r.provider}] ${r.resourceId}: ${r.sku} @ ${r.location} = $${r.monthlyCostUsd.toFixed(2)}/mo`
    );
    if (r.breakdown.compute) {
      console.log(`           └─ compute: $${r.breakdown.compute.toFixed(2)}`);
    }
    if (r.breakdown.storage) {
      console.log(`           └─ storage: $${r.breakdown.storage.toFixed(2)}`);
    }
    if (r.breakdown.bandwidth && r.breakdown.bandwidth > 0) {
      console.log(
        `           └─ bandwidth: $${r.breakdown.bandwidth.toFixed(2)}`
      );
    }
  }
  console.log();
}

function printSnapshots(): void {
  const snapshots = listSnapshots(SNAPSHOTS_DIR);
  if (snapshots.length === 0) {
    console.log('No snapshots found.');
    return;
  }

  console.log('Saved snapshots:');
  for (const snapshot of snapshots) {
    console.log(`  ${snapshot}`);
  }
}

function printServers(): void {
  if (!isHcloudAvailable()) {
    console.log('hcloud CLI not available');
    process.exit(1);
  }

  const servers = fetchServers();
  if (servers.length === 0) {
    console.log('No active Hetzner servers found.');
    return;
  }

  console.log('\nActive Hetzner Servers:\n');
  for (const server of servers) {
    console.log(`  ${server.name}`);
    console.log(`    Type:     ${server.serverType}`);
    console.log(`    Location: ${server.location}`);
    console.log(`    Status:   ${server.status}`);
    console.log(`    IPv4:     ${server.publicIpv4 ?? 'none'}`);
    console.log(`    Created:  ${server.created}`);
    console.log();
  }
}

function printUsage(command: string): void {
  console.log(`Unknown command: ${command}`);
  console.log(
    'Usage: costModel estimate|live|snapshot|list|scrape|servers|billing|orphans'
  );
  console.log('\nCommands:');
  console.log('  estimate  - Estimate costs from terraform definitions');
  console.log('  live      - Estimate costs from live provisioned servers');
  console.log('  snapshot  - Save a cost snapshot');
  console.log('  list      - List saved snapshots');
  console.log('  scrape    - Scrape live pricing from providers');
  console.log('  servers   - List active Hetzner servers');
  console.log(
    '  billing   - Query postgres for user accounting (requires DB credentials)'
  );
  console.log('  orphans   - Find AWS resources not managed by Terraform');
}

/**
 * Main CLI handler.
 */
async function main(): Promise<void> {
  const command = process.argv[2] || 'estimate';

  switch (command) {
    case 'estimate': {
      printEstimate();
      break;
    }
    case 'snapshot': {
      const filepath = saveSnapshot(PROJECT_ROOT, SNAPSHOTS_DIR);
      console.log(`Snapshot saved: ${filepath}`);
      break;
    }
    case 'list': {
      printSnapshots();
      break;
    }
    case 'scrape': {
      console.log('Scraping live pricing data from providers...\n');
      scrapeHetznerInfo();
      scrapeAzurePricing().catch(console.error);
      break;
    }
    case 'servers': {
      printServers();
      break;
    }
    case 'live': {
      runLiveCostEstimate(PROJECT_ROOT);
      break;
    }
    case 'billing': {
      await requireDbCredentials();
      await runBillingSummary();
      break;
    }
    case 'orphans': {
      const region = process.argv[3] ?? 'us-east-1';
      await runOrphanedResourcesScan(region);
      break;
    }
    default:
      printUsage(command);
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error('Error:', error.message);
  } else {
    console.error('Error:', String(error));
  }
  process.exit(1);
});
