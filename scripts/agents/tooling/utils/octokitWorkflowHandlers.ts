import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GitHubClientContext } from './githubClient.ts';

interface WorkflowJobSummary {
  name: string;
  status: string;
  conclusion: string | null;
}

function toRunId(runId: string): number {
  const parsed = Number(runId);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid --run-id: ${runId}`);
  }
  return parsed;
}

async function listWorkflowJobs(
  context: GitHubClientContext,
  runId: number
): Promise<WorkflowJobSummary[]> {
  const jobs: WorkflowJobSummary[] = [];
  let page = 1;
  while (true) {
    const response = await context.octokit.rest.actions.listJobsForWorkflowRun({
      owner: context.owner,
      repo: context.repo,
      run_id: runId,
      per_page: 100,
      page
    });
    for (const job of response.data.jobs) {
      jobs.push({
        name: job.name,
        status: job.status,
        conclusion: job.conclusion
      });
    }
    if (response.data.jobs.length < 100) {
      break;
    }
    page += 1;
  }
  return jobs;
}

function toZipBuffer(data: unknown): Buffer {
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new Error('Unexpected artifact download response type');
}

export async function getCiStatusWithOctokit(
  context: GitHubClientContext,
  runId: string | undefined,
  commit: string | undefined
): Promise<string> {
  if (runId) {
    const numericRunId = toRunId(runId);
    const run = await context.octokit.rest.actions.getWorkflowRun({
      owner: context.owner,
      repo: context.repo,
      run_id: numericRunId
    });
    const jobs = await listWorkflowJobs(context, numericRunId);
    return JSON.stringify(
      {
        status: run.data.status,
        conclusion: run.data.conclusion,
        jobs
      },
      null,
      2
    );
  }

  if (!commit) {
    throw new Error('getCiStatus requires --commit or --run-id');
  }

  const runs = await context.octokit.rest.actions.listWorkflowRunsForRepo({
    owner: context.owner,
    repo: context.repo,
    head_sha: commit,
    per_page: 1
  });
  const run = runs.data.workflow_runs[0];
  if (!run) {
    throw new Error('No workflow run found for commit');
  }

  const jobs = await listWorkflowJobs(context, run.id);
  return JSON.stringify(
    {
      run_id: run.id,
      status: run.status,
      conclusion: run.conclusion,
      jobs
    },
    null,
    2
  );
}

export async function cancelWorkflowWithOctokit(
  context: GitHubClientContext,
  runId: string
): Promise<string> {
  const numericRunId = toRunId(runId);
  await context.octokit.rest.actions.cancelWorkflowRun({
    owner: context.owner,
    repo: context.repo,
    run_id: numericRunId
  });
  return JSON.stringify({ status: 'cancelled', run_id: runId });
}

export async function rerunWorkflowWithOctokit(
  context: GitHubClientContext,
  runId: string
): Promise<string> {
  const numericRunId = toRunId(runId);
  await context.octokit.rest.actions.reRunWorkflow({
    owner: context.owner,
    repo: context.repo,
    run_id: numericRunId
  });
  return JSON.stringify({
    status: 'rerun_triggered',
    run_id: runId
  });
}

export async function downloadArtifactWithOctokit(
  context: GitHubClientContext,
  runId: string,
  artifactName: string,
  destination: string
): Promise<string> {
  const numericRunId = toRunId(runId);
  const artifacts = await context.octokit.rest.actions.listWorkflowRunArtifacts(
    {
      owner: context.owner,
      repo: context.repo,
      run_id: numericRunId,
      per_page: 100
    }
  );
  const targetArtifact = artifacts.data.artifacts.find(
    (artifact) => artifact.name === artifactName
  );
  if (!targetArtifact) {
    throw new Error(`Artifact not found in run ${runId}: ${artifactName}`);
  }

  const downloadResponse = await context.octokit.rest.actions.downloadArtifact({
    owner: context.owner,
    repo: context.repo,
    artifact_id: targetArtifact.id,
    archive_format: 'zip'
  });

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agenttool-artifact-'));
  try {
    mkdirSync(destination, { recursive: true });
    const zipPath = path.join(tempDir, 'artifact.zip');
    writeFileSync(zipPath, toZipBuffer(downloadResponse.data));
    execFileSync('unzip', ['-o', zipPath, '-d', destination], {
      stdio: ['ignore', 'ignore', 'pipe']
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  return JSON.stringify({
    status: 'downloaded',
    run_id: runId,
    artifact: artifactName,
    dest: destination
  });
}
