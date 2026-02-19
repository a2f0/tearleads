import { estimateCosts } from '../estimators';
import { getHetznerServerCost } from '../providers';
import { fetchServers, isHcloudAvailable } from '../scrapers/hetzner';

export function runLiveCostEstimate(projectRoot: string): void {
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
          cost
        });
      }
    }
  }

  const tfEstimate = estimateCosts(projectRoot);
  const azureTotal = tfEstimate.providerTotals.azure;

  console.log('Provider Totals (monthly):');
  console.log(`  Hetzner (live):  $${hetznerTotal.toFixed(2)} USD`);
  console.log(`  Azure (tf est):  $${azureTotal.toFixed(2)} USD`);
  console.log(`  ──────────────────────────`);
  console.log(
    `  Total:           $${(hetznerTotal + azureTotal).toFixed(2)} USD\n`
  );

  if (hetznerServers.length > 0) {
    console.log('Hetzner Servers (live):');
    for (const srv of hetznerServers) {
      console.log(
        `  ${srv.name}: ${srv.type} @ ${srv.location} = $${srv.cost.toFixed(2)}/mo`
      );
    }
    console.log();
  }

  const azureResources = tfEstimate.resources.filter(
    (r) => r.provider === 'azure'
  );
  if (azureResources.length > 0) {
    console.log('Azure Resources (terraform estimate):');
    for (const r of azureResources) {
      console.log(
        `  ${r.resourceId}: ${r.sku} @ ${r.location} = $${r.monthlyCostUsd.toFixed(2)}/mo`
      );
    }
    console.log();
  }
}
