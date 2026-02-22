/**
 * Hetzner Cloud pricing scraper using hcloud CLI
 *
 * Uses the hcloud CLI to fetch current server type information.
 * Note: hcloud doesn't expose pricing directly, but we can get server specs
 * and cross-reference with known pricing.
 */

import { execSync } from 'node:child_process';

interface HetznerServerType {
  id: number;
  name: string;
  description: string;
  cores: number;
  cpuType: 'shared' | 'dedicated';
  architecture: 'x86' | 'arm';
  memory: number; // GB
  disk: number; // GB
  storageType: 'local' | 'network';
  deprecation: string | null;
}

interface HetznerLocation {
  id: number;
  name: string;
  description: string;
  country: string;
  city: string;
  networkZone: string;
}

/**
 * Check if hcloud CLI is available
 */
export function isHcloudAvailable(): boolean {
  try {
    execSync('hcloud version', { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch all server types from Hetzner Cloud
 */
function fetchServerTypes(): HetznerServerType[] {
  if (!isHcloudAvailable()) {
    console.warn('hcloud CLI not available, using cached pricing data');
    return [];
  }

  try {
    const output = execSync('hcloud server-type list -o json', {
      encoding: 'utf-8',
      stdio: 'pipe'
    });

    const serverTypes = JSON.parse(output) as Array<{
      id: number;
      name: string;
      description: string;
      cores: number;
      cpu_type: string;
      architecture: string;
      memory: number;
      disk: number;
      storage_type: string;
      deprecation: { announced: string; unavailable_after: string } | null;
    }>;

    return serverTypes.map((st) => ({
      id: st.id,
      name: st.name,
      description: st.description,
      cores: st.cores,
      cpuType: st.cpu_type as 'shared' | 'dedicated',
      architecture: st.architecture as 'x86' | 'arm',
      memory: st.memory,
      disk: st.disk,
      storageType: st.storage_type as 'local' | 'network',
      deprecation: st.deprecation?.unavailable_after ?? null
    }));
  } catch (error) {
    console.error('Failed to fetch Hetzner server types:', error);
    return [];
  }
}

/**
 * Fetch all locations from Hetzner Cloud
 */
function fetchLocations(): HetznerLocation[] {
  if (!isHcloudAvailable()) {
    return [];
  }

  try {
    const output = execSync('hcloud location list -o json', {
      encoding: 'utf-8',
      stdio: 'pipe'
    });

    const locations = JSON.parse(output) as Array<{
      id: number;
      name: string;
      description: string;
      country: string;
      city: string;
      network_zone: string;
    }>;

    return locations.map((loc) => ({
      id: loc.id,
      name: loc.name,
      description: loc.description,
      country: loc.country,
      city: loc.city,
      networkZone: loc.network_zone
    }));
  } catch (error) {
    console.error('Failed to fetch Hetzner locations:', error);
    return [];
  }
}

/**
 * Get currently provisioned servers
 */
export function fetchServers(): Array<{
  id: number;
  name: string;
  serverType: string;
  location: string;
  status: string;
  publicIpv4: string | null;
  publicIpv6: string | null;
  created: string;
}> {
  if (!isHcloudAvailable()) {
    return [];
  }

  try {
    const output = execSync('hcloud server list -o json', {
      encoding: 'utf-8',
      stdio: 'pipe'
    });

    const servers = JSON.parse(output) as Array<{
      id: number;
      name: string;
      server_type: { name: string };
      datacenter: { location: { name: string } };
      status: string;
      public_net: {
        ipv4: { ip: string } | null;
        ipv6: { ip: string } | null;
      };
      created: string;
    }>;

    return servers.map((srv) => ({
      id: srv.id,
      name: srv.name,
      serverType: srv.server_type.name,
      location: srv.datacenter.location.name,
      status: srv.status,
      publicIpv4: srv.public_net.ipv4?.ip ?? null,
      publicIpv6: srv.public_net.ipv6?.ip ?? null,
      created: srv.created
    }));
  } catch (error) {
    console.error('Failed to fetch Hetzner servers:', error);
    return [];
  }
}

/**
 * Scrape and display Hetzner infrastructure info
 */
export function scrapeHetznerInfo(): void {
  console.log('\nScraping Hetzner Cloud...\n');

  const serverTypes = fetchServerTypes();
  const locations = fetchLocations();
  const servers = fetchServers();

  console.log(`Found ${serverTypes.length} server types`);
  console.log(`Found ${locations.length} locations`);
  console.log(`Found ${servers.length} active servers\n`);

  if (servers.length > 0) {
    console.log('Active Servers:');
    for (const srv of servers) {
      console.log(
        `  ${srv.name}: ${srv.serverType} @ ${srv.location} (${srv.status})`
      );
    }
  }
}
