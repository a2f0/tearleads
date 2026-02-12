#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) {
      continue;
    }
    const value = argv[i + 1];
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

const args = parseArgs(process.argv);
const required = [
  'repo',
  'branch',
  'expected-head-oid',
  'headline',
  'body',
  'output',
];

for (const key of required) {
  if (!args[key]) {
    console.error(`Missing required argument: --${key}`);
    process.exit(1);
  }
}

const diffOutput = execSync('git diff --name-status', { encoding: 'utf-8' }).trim();
const additions = [];
const deletions = [];

if (diffOutput.length > 0) {
  for (const line of diffOutput.split('\n')) {
    const parts = line.split('\t');
    const status = parts[0];

    if (status.startsWith('R')) {
      const oldPath = parts[1];
      const newPath = parts[2];
      deletions.push({ path: oldPath });
      const contents = readFileSync(newPath).toString('base64');
      additions.push({ path: newPath, contents });
      continue;
    }

    if (status.startsWith('D')) {
      deletions.push({ path: parts[1] });
      continue;
    }

    const path = parts[parts.length - 1];
    const contents = readFileSync(path).toString('base64');
    additions.push({ path, contents });
  }
}

const query = 'mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid url } } }';

const payload = {
  query,
  variables: {
    input: {
      branch: {
        repositoryNameWithOwner: args.repo,
        branchName: args.branch,
      },
      message: {
        headline: args.headline,
        body: args.body,
      },
      expectedHeadOid: args['expected-head-oid'],
      fileChanges: {
        additions,
        deletions,
      },
    },
  },
};

writeFileSync(args.output, JSON.stringify(payload));
