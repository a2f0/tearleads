import { type Command, InvalidArgumentError } from 'commander';
import { parsePositiveInt } from '../../../tooling/lib/cliShared.ts';
import type { ActionName } from '../types.ts';

export function applyPrWorkflowCommandOptions(
  actionName: ActionName,
  cmd: Command
): boolean {
  switch (actionName) {
    case 'verifyBranchPush':
      cmd.option('--branch <name>', 'Branch name (defaults to current branch)');
      return true;

    case 'sanitizePrBody':
      cmd.requiredOption('--number <n>', 'PR number', (v) =>
        parsePositiveInt(v, '--number')
      );
      return true;

    case 'createDeferredFixIssue':
      cmd
        .requiredOption('--number <n>', 'Source PR number', (v) =>
          parsePositiveInt(v, '--number')
        )
        .requiredOption('--pr-url <url>', 'Source PR URL')
        .requiredOption(
          '--deferred-items-json <json>',
          'Deferred item list as JSON array'
        );
      return true;

    case 'updatePrBody':
      cmd
        .requiredOption('--number <n>', 'PR number', (v) =>
          parsePositiveInt(v, '--number')
        )
        .option('--body <text>', 'PR body content')
        .option('--body-file <path>', 'Read PR body content from file')
        .hook('preAction', (thisCommand) => {
          const opts = thisCommand.opts();
          if (!opts.body && !opts.bodyFile) {
            console.error('error: updatePrBody requires --body or --body-file');
            process.exit(1);
          }
          if (opts.body && opts.bodyFile) {
            throw new InvalidArgumentError(
              'updatePrBody accepts either --body or --body-file'
            );
          }
        });
      return true;

    default:
      return false;
  }
}
