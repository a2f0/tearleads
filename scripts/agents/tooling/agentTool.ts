#!/usr/bin/env -S pnpm exec tsx
/**
 * Agent tooling CLI - TypeScript wrapper for agent scripts and GitHub API actions.
 *
 * Usage: tsx scripts/agents/tooling/agentTool.ts <action> [options]
 *
 * Actions are documented in --help output and README.md.
 */
import { program } from 'commander';
import { ACTION_NAMES, createActionCommand } from './utils/commandFactory.ts';

program
  .name('agentTool.ts')
  .description(
    'Agent tooling CLI for environment setup, GitHub API actions, and script execution'
  )
  .version('1.0.0');

for (const actionName of ACTION_NAMES) {
  program.addCommand(createActionCommand(actionName));
}

program.parse();
