import { spawnSync } from 'node:child_process';

interface RunCiImpactScriptArgs {
  base: string;
  head: string;
  files?: string;
  callerName: string;
}

export function runCiImpactScript({
  base,
  head,
  files,
  callerName
}: RunCiImpactScriptArgs): string {
  const ciImpactScript = 'scripts/ciImpact/ciImpact.ts';
  const ciImpactArgs = [ciImpactScript, '--base', base, '--head', head];
  if (files !== undefined) {
    ciImpactArgs.push('--files', files);
  }

  const runners: ReadonlyArray<{
    cmd: string;
    args: string[];
    display: string;
  }> = [
    {
      cmd: process.execPath,
      args: ['--experimental-strip-types', ...ciImpactArgs],
      display: 'node --experimental-strip-types'
    },
    { cmd: 'tsx', args: ciImpactArgs, display: 'tsx' },
    {
      cmd: 'pnpm',
      args: ['exec', 'tsx', ...ciImpactArgs],
      display: 'pnpm exec tsx'
    },
    {
      cmd: process.execPath,
      args: ['--import', 'tsx', ...ciImpactArgs],
      display: 'node --import tsx'
    }
  ];

  let lastError = '';
  for (const runner of runners) {
    const result = spawnSync(runner.cmd, runner.args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });

    const spawnError = result.error;
    if (
      spawnError !== undefined &&
      typeof spawnError === 'object' &&
      'code' in spawnError &&
      spawnError.code === 'ENOENT'
    ) {
      lastError = `${runner.display} not available`;
      continue;
    }

    if (result.status !== 0) {
      const stderr =
        typeof result.stderr === 'string' ? result.stderr.trim() : '';
      lastError = `${runner.display} failed (exit ${result.status ?? 'null'})${stderr ? `: ${stderr}` : ''}`;
      continue;
    }

    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    if (stdout.trim().length === 0) {
      lastError = `${runner.display} produced no output`;
      continue;
    }

    return stdout;
  }

  throw new Error(
    `${callerName}: unable to compute ciImpact output (${lastError || 'no compatible runner available'})`
  );
}
