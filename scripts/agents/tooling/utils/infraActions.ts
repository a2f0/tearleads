import path from 'node:path';
import { runWithTimeout } from '../../../tooling/lib/cliShared.ts';
import type { GlobalOptions } from '../types.ts';
import { requireDefined } from './helpers.ts';

const TERRAFORM_STACK_SCRIPTS: Record<string, ReadonlyArray<string>> = {
  'staging/k8s': ['apply', 'apply01', 'apply02', 'apply03', 'destroy'],
  'prod/k8s': ['apply', 'apply01', 'apply02', 'apply03', 'destroy'],
  'prod/vpn': ['apply', 'apply01', 'apply02', 'destroy']
};

const ANSIBLE_BOOTSTRAP_SCRIPTS: Record<string, string> = {
  'staging-k8s': 'ansible/scripts/run-k8s-staging.sh',
  'prod-k8s': 'ansible/scripts/run-k8s-prod.sh',
  'prod-vpn': 'ansible/scripts/run-vpn-prod.sh'
};

export function listTerraformStacks(): string[] {
  return Object.keys(TERRAFORM_STACK_SCRIPTS).sort();
}

export function isTerraformStack(stack: string): boolean {
  return Object.hasOwn(TERRAFORM_STACK_SCRIPTS, stack);
}

export function listTerraformScripts(stack: string): string[] {
  const scripts = TERRAFORM_STACK_SCRIPTS[stack];
  if (scripts === undefined) {
    return [];
  }
  return [...scripts];
}

export function isTerraformScriptForStack(
  stack: string,
  script: string
): boolean {
  const scripts = TERRAFORM_STACK_SCRIPTS[stack];
  if (scripts === undefined) {
    return false;
  }
  return scripts.includes(script);
}

export function resolveTerraformScriptPath(
  repoRoot: string,
  stack: string,
  script: string
): string {
  if (!isTerraformStack(stack)) {
    throw new Error(
      `Unknown terraform stack "${stack}". Allowed: ${listTerraformStacks().join(', ')}`
    );
  }
  if (!isTerraformScriptForStack(stack, script)) {
    throw new Error(
      `Unknown script "${script}" for stack "${stack}". Allowed: ${listTerraformScripts(stack).join(', ')}`
    );
  }
  return path.join(
    repoRoot,
    'terraform',
    'stacks',
    stack,
    'scripts',
    `${script}.sh`
  );
}

export function listAnsibleBootstrapTargets(): string[] {
  return Object.keys(ANSIBLE_BOOTSTRAP_SCRIPTS).sort();
}

export function isAnsibleBootstrapTarget(target: string): boolean {
  return Object.hasOwn(ANSIBLE_BOOTSTRAP_SCRIPTS, target);
}

export function resolveAnsibleBootstrapScriptPath(
  repoRoot: string,
  target: string
): string {
  const relativePath = ANSIBLE_BOOTSTRAP_SCRIPTS[target];
  if (relativePath === undefined) {
    throw new Error(
      `Unknown ansible target "${target}". Allowed: ${listAnsibleBootstrapTargets().join(', ')}`
    );
  }
  return path.join(repoRoot, relativePath);
}

export function handleRunTerraformStackScript(
  options: GlobalOptions,
  timeoutMs: number,
  repoRoot: string
): string {
  const stack = requireDefined(options.stack, '--stack');
  const script = requireDefined(options.script, '--script');
  const scriptPath = resolveTerraformScriptPath(repoRoot, stack, script);
  const args = options.yes ? ['-auto-approve'] : [];
  const result = runWithTimeout(scriptPath, args, timeoutMs, repoRoot);
  const output = result.stdout + result.stderr;
  if (result.exitCode !== 0) {
    throw new Error(
      output ||
        `runTerraformStackScript failed with exit code ${result.exitCode}`
    );
  }
  return output;
}

export function handleRunAnsibleBootstrap(
  options: GlobalOptions,
  timeoutMs: number,
  repoRoot: string
): string {
  const target = requireDefined(options.target, '--target');
  const scriptPath = resolveAnsibleBootstrapScriptPath(repoRoot, target);
  const result = runWithTimeout(scriptPath, [], timeoutMs, repoRoot);
  const output = result.stdout + result.stderr;
  if (result.exitCode !== 0) {
    throw new Error(
      output || `runAnsibleBootstrap failed with exit code ${result.exitCode}`
    );
  }
  return output;
}

export function handleEnsureDeps(timeoutMs: number, repoRoot: string): string {
  const result = runWithTimeout('pnpm', ['install'], timeoutMs, repoRoot);
  if (result.exitCode !== 0) {
    const output = result.stdout + result.stderr;
    throw new Error(
      output || `pnpm install failed with exit code ${result.exitCode}`
    );
  }
  return 'Dependencies installed successfully.';
}
