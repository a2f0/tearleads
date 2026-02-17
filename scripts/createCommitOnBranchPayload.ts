#!/usr/bin/env -S pnpm exec tsx
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

type CliArgs = {
  repo?: string;
  branch?: string;
  expectedHeadOid?: string;
  headline?: string;
  body?: string;
  output?: string;
};

type FileAddition = {
  path: string;
  contents: string;
};

type FileDeletion = {
  path: string;
};

type CommitPayload = {
  query: string;
  variables: {
    input: {
      branch: {
        repositoryNameWithOwner: string;
        branchName: string;
      };
      message: {
        headline: string;
        body: string;
      };
      expectedHeadOid: string;
      fileChanges: {
        additions: FileAddition[];
        deletions: FileDeletion[];
      };
    };
  };
};

type ArgKey = keyof CliArgs;

const keyMap: Record<string, ArgKey> = {
  '--repo': 'repo',
  '--branch': 'branch',
  '--expected-head-oid': 'expectedHeadOid',
  '--headline': 'headline',
  '--body': 'body',
  '--output': 'output'
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};

  for (let index = 2; index < argv.length; index += 1) {
    const rawKey = argv[index];
    if (rawKey === undefined) {
      continue;
    }
    const mappedKey = keyMap[rawKey];
    if (!mappedKey) {
      continue;
    }

    const value = argv[index + 1];
    if (value === undefined) {
      console.error(`Missing value for argument: ${rawKey}`);
      process.exit(1);
    }

    switch (mappedKey) {
      case 'repo':
        args.repo = value;
        break;
      case 'branch':
        args.branch = value;
        break;
      case 'expectedHeadOid':
        args.expectedHeadOid = value;
        break;
      case 'headline':
        args.headline = value;
        break;
      case 'body':
        args.body = value;
        break;
      case 'output':
        args.output = value;
        break;
    }
    index += 1;
  }

  return args;
}

function getFlagName(key: ArgKey): string {
  for (const [flag, mappedKey] of Object.entries(keyMap)) {
    if (mappedKey === key) {
      return flag;
    }
  }
  return `--${key}`;
}

function requireArg(args: CliArgs, key: ArgKey): string {
  const value = args[key];
  if (!value) {
    console.error(`Missing required argument: ${getFlagName(key)}`);
    process.exit(1);
  }
  return value;
}

function getDiffOutput(): string {
  return execSync('git diff --name-status', { encoding: 'utf-8' }).trim();
}

function collectFileChanges(diffOutput: string): {
  additions: FileAddition[];
  deletions: FileDeletion[];
} {
  const additions: FileAddition[] = [];
  const deletions: FileDeletion[] = [];

  if (diffOutput.length === 0) {
    return { additions, deletions };
  }

  for (const line of diffOutput.split('\n')) {
    const parts = line.split('\t');
    const status = parts[0];

    if (status?.startsWith('R')) {
      const oldPath = parts[1];
      const newPath = parts[2];
      if (!oldPath || !newPath) {
        console.error(`Invalid rename status line: ${line}`);
        process.exit(1);
      }
      deletions.push({ path: oldPath });
      additions.push({
        path: newPath,
        contents: readFileSync(newPath).toString('base64')
      });
      continue;
    }

    if (status?.startsWith('D')) {
      const deletedPath = parts[1];
      if (!deletedPath) {
        console.error(`Invalid delete status line: ${line}`);
        process.exit(1);
      }
      deletions.push({ path: deletedPath });
      continue;
    }

    const path = parts[parts.length - 1];
    if (!path) {
      console.error(`Invalid status line: ${line}`);
      process.exit(1);
    }
    additions.push({ path, contents: readFileSync(path).toString('base64') });
  }

  return { additions, deletions };
}

const args = parseArgs(process.argv);

const repo = requireArg(args, 'repo');
const branch = requireArg(args, 'branch');
const expectedHeadOid = requireArg(args, 'expectedHeadOid');
const headline = requireArg(args, 'headline');
const body = requireArg(args, 'body');
const output = requireArg(args, 'output');

const { additions, deletions } = collectFileChanges(getDiffOutput());

const query =
  'mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid url } } }';

const payload: CommitPayload = {
  query,
  variables: {
    input: {
      branch: {
        repositoryNameWithOwner: repo,
        branchName: branch
      },
      message: {
        headline,
        body
      },
      expectedHeadOid,
      fileChanges: {
        additions,
        deletions
      }
    }
  }
};

writeFileSync(output, JSON.stringify(payload));
