#!/usr/bin/env -S pnpm exec tsx
import fs from 'node:fs';
import path from 'node:path';
import {
  ALL_JOB_NAMES,
  CI_GATE_WORKFLOW_FILE,
  CI_GATE_WORKFLOW_NAME,
  WORKFLOW_BY_JOB,
  WORKFLOW_FILE_BY_JOB
} from './workflowConfig.ts';

interface CiImpactConfig {
  jobNames?: string[];
}

const ROOT = process.cwd();

// Escape literal job keys before interpolation into a RegExp pattern.
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readConfig(): CiImpactConfig {
  const raw = readFile('scripts/ciImpact/job-groups.json');
  const parsed = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(
      'scripts/ciImpact/job-groups.json must contain a JSON object'
    );
  }
  return parsed;
}

function parseWorkflowName(rawWorkflow: string): string | null {
  const line = rawWorkflow
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('name: '));

  if (line === undefined) {
    return null;
  }

  return line.slice('name: '.length).trim();
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseJobName(rawWorkflow: string, jobId: string): string | null {
  const lines = rawWorkflow.split('\n');
  let inJobs = false;
  let inTargetJob = false;

  for (const line of lines) {
    if (!inJobs) {
      if (/^jobs:\s*$/.test(line)) {
        inJobs = true;
      }
      continue;
    }

    if (/^[^\s].*:\s*$/.test(line) && !/^jobs:\s*$/.test(line)) {
      break;
    }

    const jobHeader = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (jobHeader !== null) {
      if (inTargetJob) {
        break;
      }
      inTargetJob = jobHeader[1] === jobId;
      continue;
    }

    if (!inTargetJob) {
      continue;
    }

    const jobNameMatch = line.match(/^ {4}name:\s*(.+?)\s*$/);
    if (jobNameMatch !== null) {
      const rawJobName = jobNameMatch[1];
      if (rawJobName !== undefined) {
        return stripQuotes(rawJobName);
      }
    }
  }

  return null;
}

function sorted(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function hasCiImpactLookup(workflowRaw: string, jobName: string): boolean {
  const escapedJobName = escapeRegex(jobName);
  const pattern = new RegExp(
    `\\.jobs\\s*\\[\\s*['"]${escapedJobName}['"]\\s*\\]\\s*\\.\\s*run`
  );
  return pattern.test(workflowRaw);
}

function main(): void {
  const errors: string[] = [];

  const config = readConfig();
  const configuredJobNames = Array.isArray(config.jobNames)
    ? config.jobNames.filter((value) => typeof value === 'string')
    : [];

  const expectedJobNames = [...ALL_JOB_NAMES];
  if (
    sorted(configuredJobNames).join('|') !== sorted(expectedJobNames).join('|')
  ) {
    errors.push(
      `job-groups.json jobNames drift detected: expected [${expectedJobNames.join(', ')}], got [${configuredJobNames.join(', ')}]`
    );
  }

  const mappedWorkflowNames = Object.values(WORKFLOW_BY_JOB);
  const uniqueMappedWorkflowNames = new Set(mappedWorkflowNames);
  if (mappedWorkflowNames.length !== uniqueMappedWorkflowNames.size) {
    errors.push('WORKFLOW_BY_JOB contains duplicate workflow names');
  }

  if (uniqueMappedWorkflowNames.has(CI_GATE_WORKFLOW_NAME)) {
    errors.push('CI Gate workflow must not be listed in WORKFLOW_BY_JOB');
  }

  for (const jobName of ALL_JOB_NAMES) {
    const expectedWorkflowName = WORKFLOW_BY_JOB[jobName];
    const workflowFile = WORKFLOW_FILE_BY_JOB[jobName];
    const absoluteWorkflowPath = path.join(ROOT, workflowFile);

    if (!fs.existsSync(absoluteWorkflowPath)) {
      errors.push(
        `Missing workflow file for job "${jobName}": ${workflowFile}`
      );
      continue;
    }

    const workflowRaw = readFile(workflowFile);
    const actualWorkflowName = parseWorkflowName(workflowRaw);
    if (actualWorkflowName === null) {
      errors.push(`Workflow file ${workflowFile} is missing a top-level name`);
    } else if (actualWorkflowName !== expectedWorkflowName) {
      errors.push(
        `Workflow name drift for job "${jobName}": expected "${expectedWorkflowName}" in ${workflowFile}, found "${actualWorkflowName}"`
      );
    }

    const expectedImpactLookup = `.jobs["${jobName}"].run or .jobs['${jobName}'].run`;
    if (!hasCiImpactLookup(workflowRaw, jobName)) {
      errors.push(
        `Workflow ${workflowFile} is missing ciImpact lookup ${expectedImpactLookup} (job-key drift)`
      );
    }
  }

  const ciGatePath = path.join(ROOT, CI_GATE_WORKFLOW_FILE);
  if (!fs.existsSync(ciGatePath)) {
    errors.push(`Missing required workflow file: ${CI_GATE_WORKFLOW_FILE}`);
  } else {
    const ciGateRaw = readFile(CI_GATE_WORKFLOW_FILE);
    const ciGateName = parseWorkflowName(ciGateRaw);

    if (ciGateName !== CI_GATE_WORKFLOW_NAME) {
      errors.push(
        `CI Gate workflow name drift: expected "${CI_GATE_WORKFLOW_NAME}", found "${ciGateName ?? '(missing)'}"`
      );
    }

    if (!ciGateRaw.includes('scripts/ciImpact/requiredWorkflows.ts')) {
      errors.push(
        `${CI_GATE_WORKFLOW_FILE} must invoke scripts/ciImpact/requiredWorkflows.ts`
      );
    }

    const ciGateJobName = parseJobName(ciGateRaw, 'ci-gate');
    if (ciGateJobName !== CI_GATE_WORKFLOW_NAME) {
      errors.push(
        `${CI_GATE_WORKFLOW_FILE} must include a ci-gate job named "${CI_GATE_WORKFLOW_NAME}" (found "${ciGateJobName ?? '(missing)'}")`
      );
    }
  }

  if (errors.length > 0) {
    process.stderr.write('ciImpact workflow drift detected:\n');
    for (const error of errors) {
      process.stderr.write(`- ${error}\n`);
    }
    process.exit(1);
  }

  process.stdout.write('ciImpact workflow drift check passed.\n');
}

main();
