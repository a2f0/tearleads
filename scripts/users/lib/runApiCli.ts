import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PM_SCRIPT_PATH = fileURLToPath(
  new URL('../../tooling/pm.sh', import.meta.url)
);
const API_CLI_PATH = fileURLToPath(
  new URL('../../../packages/api/src/apiCli.ts', import.meta.url)
);

function buildApiCliCommand(args: readonly string[]): string[] {
  return [PM_SCRIPT_PATH, 'exec', 'tsx', API_CLI_PATH, ...args];
}

export function runApiCli(args: readonly string[]): void {
  execFileSync('sh', buildApiCliCommand(args), { stdio: 'inherit' });
}

export function runApiCliForOutput(args: readonly string[]): string {
  return execFileSync('sh', buildApiCliCommand(args), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}
