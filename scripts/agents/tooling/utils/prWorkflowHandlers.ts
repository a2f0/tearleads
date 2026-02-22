import { execFileSync, execSync } from 'node:child_process';

import type { GlobalOptions } from '../types.ts';
import { resolveCurrentBranchName } from './helpers.ts';

function resolveBranchName(branch: string | undefined): string {
  if (branch) return branch;
  return resolveCurrentBranchName();
}

function validateBranchName(branch: string): void {
  if (!/^[0-9A-Za-z._/-]+$/.test(branch)) {
    throw new Error(`Invalid branch name: ${branch}`);
  }
}

export function handleVerifyBranchPush(options: GlobalOptions): string {
  const branch = resolveBranchName(options.branch);
  validateBranchName(branch);

  execFileSync('git', ['fetch', 'origin', branch], {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe']
  });

  const localHead = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  const remoteHead = execFileSync('git', ['rev-parse', `origin/${branch}`], {
    encoding: 'utf8'
  }).trim();
  const synced = localHead === remoteHead;

  return JSON.stringify(
    {
      status: synced ? 'synced' : 'not_synced',
      branch,
      synced,
      local_head: localHead,
      remote_head: remoteHead
    },
    null,
    2
  );
}
