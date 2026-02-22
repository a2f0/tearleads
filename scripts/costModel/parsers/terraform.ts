/**
 * Terraform file parser
 *
 * Extracts resource definitions from .tf files for cost estimation.
 * This is a basic regex-based parser for common patterns.
 * For production use, consider using HCL2 parser or terraform show -json.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { TerraformResource } from '../types';

// Resource patterns we care about for cost estimation
const RESOURCE_PATTERNS = {
  // Hetzner Cloud
  hcloud_server:
    /resource\s+"hcloud_server"\s+"(\w+)"\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/gs,
  hcloud_volume:
    /resource\s+"hcloud_volume"\s+"(\w+)"\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/gs,

  // Azure
  azurerm_linux_virtual_machine:
    /resource\s+"azurerm_linux_virtual_machine"\s+"(\w+)"\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/gs,
  azurerm_managed_disk:
    /resource\s+"azurerm_managed_disk"\s+"(\w+)"\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/gs,
  azurerm_key_vault:
    /resource\s+"azurerm_key_vault"\s+"(\w+)"\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/gs
} as const;

// Attribute extraction patterns
const ATTR_PATTERNS: Record<string, RegExp> = {
  server_type: /server_type\s*=\s*"([^"]+)"/,
  size: /size\s*=\s*"([^"]+)"/,
  vm_size: /size\s*=\s*(?:var\.vm_size|"([^"]+)")/,
  location:
    /location\s*=\s*(?:var\.(?:server_location|azure_location)|"([^"]+)")/,
  disk_size_gb: /disk_size_gb\s*=\s*(\d+)/,
  storage_account_type: /storage_account_type\s*=\s*"([^"]+)"/,
  image: /image\s*=\s*"([^"]+)"/
};

/**
 * Extract attribute value from resource block
 */
function extractAttribute(block: string, attrName: string): string | undefined {
  const pattern = ATTR_PATTERNS[attrName];
  if (!pattern) return undefined;

  const match = block.match(pattern);
  if (!match) return undefined;

  // Return the captured group (some patterns have var references)
  return match[1] || `var.${attrName}`;
}

/**
 * Parse a single .tf file and extract resources
 */
function parseTerraformFile(filePath: string): TerraformResource[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const resources: TerraformResource[] = [];

  for (const [resourceType, pattern] of Object.entries(RESOURCE_PATTERNS)) {
    // Reset regex lastIndex
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null = pattern.exec(content);
    while (match !== null) {
      const name = match[1];
      const block = match[2];
      if (name === undefined || block === undefined) {
        match = pattern.exec(content);
        continue;
      }
      const attributes: Record<string, unknown> = {};

      // Extract relevant attributes based on resource type
      if (resourceType === 'hcloud_server') {
        attributes.server_type = extractAttribute(block, 'server_type');
        attributes.location = extractAttribute(block, 'location');
        attributes.image = extractAttribute(block, 'image');
      } else if (resourceType === 'hcloud_volume') {
        attributes.size = extractAttribute(block, 'size');
        attributes.location = extractAttribute(block, 'location');
      } else if (resourceType === 'azurerm_linux_virtual_machine') {
        attributes.size = extractAttribute(block, 'vm_size');
        attributes.location = extractAttribute(block, 'location');
        attributes.disk_size_gb = extractAttribute(block, 'disk_size_gb');
        attributes.storage_account_type = extractAttribute(
          block,
          'storage_account_type'
        );
      } else if (resourceType === 'azurerm_managed_disk') {
        attributes.disk_size_gb = extractAttribute(block, 'disk_size_gb');
        attributes.storage_account_type = extractAttribute(
          block,
          'storage_account_type'
        );
        attributes.location = extractAttribute(block, 'location');
      }

      resources.push({
        type: resourceType,
        name: name ?? 'unknown',
        attributes,
        sourceFile: filePath
      });

      match = pattern.exec(content);
    }
  }

  return resources;
}

/**
 * Find and parse all .tf files in a directory
 */
function parseTerraformDirectory(dirPath: string): TerraformResource[] {
  const resources: TerraformResource[] = [];

  if (!fs.existsSync(dirPath)) {
    return resources;
  }

  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    if (file.endsWith('.tf')) {
      const filePath = path.join(dirPath, file);
      resources.push(...parseTerraformFile(filePath));
    }
  }

  return resources;
}

/**
 * Parse all terraform directories in the project
 */
export function parseAllTerraform(projectRoot: string): {
  hetzner: TerraformResource[];
  tuxedo: TerraformResource[];
  azure: TerraformResource[];
} {
  return {
    hetzner: parseTerraformDirectory(path.join(projectRoot, 'terraform')),
    tuxedo: parseTerraformDirectory(
      path.join(projectRoot, 'tuxedo', 'terraform')
    ),
    azure: parseTerraformDirectory(path.join(projectRoot, 'tee'))
  };
}
