import { type Command, InvalidArgumentError } from 'commander';
import { parsePositiveInt } from '../../../tooling/lib/cliShared.ts';
import type { ActionName, GlobalOptions } from '../types.ts';

export function applyIssueCommandOptions(
  actionName: ActionName,
  cmd: Command
): boolean {
  switch (actionName) {
    case 'checkGeminiQuota':
      cmd
        .requiredOption('--number <n>', 'PR number', (v) =>
          parsePositiveInt(v, '--number')
        )
        .option('--quota-message <text>', 'Quota exhaustion message to match');
      return true;
    case 'listDeferredFixIssues':
      cmd
        .option('--state <state>', 'Issue state', (v) => {
          if (v !== 'open' && v !== 'closed' && v !== 'all') {
            throw new InvalidArgumentError(
              '--state must be "open", "closed", or "all"'
            );
          }
          return v;
        })
        .option('--limit <n>', 'Max issues to return', (v) =>
          parsePositiveInt(v, '--limit')
        );
      return true;
    case 'getIssue':
      cmd.requiredOption('--number <n>', 'Issue number', (v) =>
        parsePositiveInt(v, '--number')
      );
      return true;
    case 'issueTemplate':
      cmd.requiredOption('--type <type>', 'Template type', (v) => {
        const allowed = ['user-requested', 'deferred-fix'];
        if (!allowed.includes(v)) {
          throw new InvalidArgumentError(
            `--type must be one of ${allowed.join(', ')}`
          );
        }
        return v as GlobalOptions['type'];
      });
      return true;
    case 'createIssue':
      cmd
        .requiredOption('--type <type>', 'Issue type', (v) => {
          const allowed = ['user-requested', 'deferred-fix'];
          if (!allowed.includes(v)) {
            throw new InvalidArgumentError(
              `--type must be one of ${allowed.join(', ')}`
            );
          }
          return v as GlobalOptions['type'];
        })
        .requiredOption('--title <text>', 'Issue title')
        .option('--search <query>', 'Search query used to dedupe open issues')
        .option('--source-pr <n>', 'Source PR number for deferred fixes', (v) =>
          parsePositiveInt(v, '--source-pr')
        )
        .option('--review-thread-url <url>', 'Review thread URL for deferred fixes')
        .option('--label <name>', 'Additional label to apply')
        .option(
          '--force',
          'Skip duplicate-issue detection and always create a new issue'
        )
        .hook('preAction', (thisCommand) => {
          const opts = thisCommand.opts();
          if (opts.type === 'deferred-fix' && opts.sourcePr === undefined) {
            console.error(
              'error: createIssue --type deferred-fix requires --source-pr'
            );
            process.exit(1);
          }
        });
      return true;
    default:
      return false;
  }
}
