import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { estimateCosts } from './estimators';
import type { CostSnapshot } from './types';

function getGitCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Save a cost snapshot.
 */
export function saveSnapshot(
  projectRoot: string,
  snapshotsDir: string
): string {
  const estimate = estimateCosts(projectRoot);
  const snapshot: CostSnapshot = {
    timestamp: new Date().toISOString(),
    gitCommit: getGitCommit(),
    totalMonthlyCostUsd: estimate.totalMonthlyCostUsd,
    providerTotals: estimate.providerTotals,
    resources: estimate.resources
  };

  if (!fs.existsSync(snapshotsDir)) {
    fs.mkdirSync(snapshotsDir, { recursive: true });
  }

  const filename = `snapshot-${snapshot.timestamp.replace(/[:.]/g, '-')}.json`;
  const filepath = path.join(snapshotsDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2));
  return filepath;
}

/**
 * List saved snapshots.
 */
export function listSnapshots(snapshotsDir: string): string[] {
  if (!fs.existsSync(snapshotsDir)) {
    return [];
  }

  return fs
    .readdirSync(snapshotsDir)
    .filter((f) => f.startsWith('snapshot-') && f.endsWith('.json'))
    .sort()
    .reverse();
}
