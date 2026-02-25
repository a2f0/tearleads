#!/usr/bin/env -S pnpm exec tsx
import { execSync } from 'node:child_process';
import {
  ALL_JOB_NAMES,
  type JobName,
  WORKFLOW_BY_JOB
} from './workflowConfig.ts';

interface CliArgs {
  base?: string;
  head?: string;
  files?: string;
}

interface JobState {
  run: boolean;
  reasons: string[];
}

interface CiImpactOutput {
  base: string;
  head: string;
  jobs: Record<JobName, JobState>;
}

interface RequiredWorkflowsOutput {
  base: string;
  head: string;
  requiredWorkflows: string[];
  reasons: Record<string, string[]>;
}

const DEFAULT_BASE = 'origin/main';
const DEFAULT_HEAD = 'HEAD';

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) {
      continue;
    }
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      continue;
    }

    if (key === 'base') {
      args.base = next;
    } else if (key === 'head') {
      args.head = next;
    } else if (key === 'files') {
      args.files = next;
    }
    i += 1;
  }
  return args;
}

function readStringArray(obj: object, key: string): string[] {
  const raw = Reflect.get(obj, key);
  if (!Array.isArray(raw)) {
    return [];
  }

  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      out.push(item);
    }
  }
  return out;
}

function parseJobState(obj: object, key: string): JobState {
  const raw = Reflect.get(obj, key);
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Invalid ciImpact output.jobs.${key}`);
  }

  const runRaw = Reflect.get(raw, 'run');
  if (typeof runRaw !== 'boolean') {
    throw new Error(`Invalid ciImpact output.jobs.${key}.run`);
  }

  return {
    run: runRaw,
    reasons: readStringArray(raw, 'reasons')
  };
}

function parseCiImpact(raw: string): CiImpactOutput {
  const parsed = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid ciImpact output');
  }

  const baseRaw = Reflect.get(parsed, 'base');
  const headRaw = Reflect.get(parsed, 'head');
  if (typeof baseRaw !== 'string' || typeof headRaw !== 'string') {
    throw new Error('Invalid ciImpact output base/head');
  }

  const jobsRaw = Reflect.get(parsed, 'jobs');
  if (typeof jobsRaw !== 'object' || jobsRaw === null) {
    throw new Error('Invalid ciImpact output.jobs');
  }

  return {
    base: baseRaw,
    head: headRaw,
    jobs: {
      build: parseJobState(jobsRaw, 'build'),
      'web-e2e': parseJobState(jobsRaw, 'web-e2e'),
      'website-e2e': parseJobState(jobsRaw, 'website-e2e'),
      'electron-e2e': parseJobState(jobsRaw, 'electron-e2e'),
      android: parseJobState(jobsRaw, 'android'),
      'android-maestro-release': parseJobState(
        jobsRaw,
        'android-maestro-release'
      ),
      'ios-maestro-release': parseJobState(jobsRaw, 'ios-maestro-release')
    }
  };
}

function runCiImpact(args: CliArgs): CiImpactOutput {
  const base = args.base || DEFAULT_BASE;
  const head = args.head || DEFAULT_HEAD;

  const cmdParts = [
    'pnpm exec tsx scripts/ciImpact/ciImpact.ts',
    `--base ${base}`,
    `--head ${head}`
  ];
  if (args.files !== undefined) {
    cmdParts.push(`--files "${args.files}"`);
  }

  const output = execSync(cmdParts.join(' '), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return parseCiImpact(output);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function main(): void {
  const args = parseArgs(process.argv);
  const impact = runCiImpact(args);

  const requiredWorkflows: string[] = [];
  const reasons: Record<string, string[]> = {};

  for (const jobName of ALL_JOB_NAMES) {
    const jobState = impact.jobs[jobName];
    if (!jobState.run) {
      continue;
    }

    const workflowName = WORKFLOW_BY_JOB[jobName];
    requiredWorkflows.push(workflowName);
    reasons[workflowName] = [...jobState.reasons];
  }

  const out: RequiredWorkflowsOutput = {
    base: impact.base,
    head: impact.head,
    requiredWorkflows: unique(requiredWorkflows),
    reasons
  };

  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

main();
