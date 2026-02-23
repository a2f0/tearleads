import { type Command, InvalidArgumentError } from 'commander';
import { parsePositiveInt } from '../../../tooling/lib/cliShared.ts';
import type { ActionName } from '../types.ts';

function parseDependabotState(value: string): string {
  const values = value.split(',');
  for (const item of values) {
    const candidate = item.trim();
    if (
      candidate !== 'open' &&
      candidate !== 'dismissed' &&
      candidate !== 'fixed' &&
      candidate !== 'auto_dismissed'
    ) {
      throw new InvalidArgumentError(
        '--state must be one of "open", "dismissed", "fixed", or "auto_dismissed" (comma-separated allowed)'
      );
    }
  }
  return value;
}

function parseDependabotScope(value: string): string {
  if (value === 'development' || value === 'runtime') {
    return value;
  }
  throw new InvalidArgumentError('--scope must be "development" or "runtime"');
}

function parseDependabotSort(value: string): string {
  if (
    value === 'created' ||
    value === 'updated' ||
    value === 'epss_percentage'
  ) {
    return value;
  }
  throw new InvalidArgumentError(
    '--sort must be "created", "updated", or "epss_percentage"'
  );
}

function parseDependabotDirection(value: string): string {
  if (value === 'asc' || value === 'desc') {
    return value;
  }
  throw new InvalidArgumentError('--direction must be "asc" or "desc"');
}

function parseDismissedReason(value: string): string {
  if (
    value === 'fix_started' ||
    value === 'inaccurate' ||
    value === 'no_bandwidth' ||
    value === 'not_used' ||
    value === 'tolerable_risk'
  ) {
    return value;
  }
  throw new InvalidArgumentError(
    '--dismissed-reason must be one of "fix_started", "inaccurate", "no_bandwidth", "not_used", "tolerable_risk"'
  );
}

export function applyDependabotCommandOptions(
  actionName: ActionName,
  cmd: Command
): boolean {
  switch (actionName) {
    case 'listDependabotAlerts':
      cmd
        .option(
          '--state <state>',
          'Alert states (comma-separated)',
          parseDependabotState
        )
        .option('--severity <severity>', 'Severities (comma-separated)')
        .option('--ecosystem <ecosystem>', 'Ecosystems (comma-separated)')
        .option('--package <name>', 'Package names (comma-separated)')
        .option('--manifest <path>', 'Manifest paths (comma-separated)')
        .option('--scope <scope>', 'Dependency scope', parseDependabotScope)
        .option('--sort <sort>', 'Sort field', parseDependabotSort)
        .option(
          '--direction <direction>',
          'Sort direction',
          parseDependabotDirection
        )
        .option('--per-page <n>', 'Results per page', (v) =>
          parsePositiveInt(v, '--per-page')
        );
      return true;
    case 'getDependabotAlert':
      cmd.requiredOption('--alert-number <n>', 'Dependabot alert number', (v) =>
        parsePositiveInt(v, '--alert-number')
      );
      return true;
    case 'updateDependabotAlert':
      cmd
        .requiredOption('--alert-number <n>', 'Dependabot alert number', (v) =>
          parsePositiveInt(v, '--alert-number')
        )
        .requiredOption('--state <state>', 'Target alert state', (v) => {
          if (v !== 'open' && v !== 'dismissed') {
            throw new InvalidArgumentError(
              '--state must be "open" or "dismissed"'
            );
          }
          return v;
        })
        .option(
          '--dismissed-reason <reason>',
          'Dismissed reason',
          parseDismissedReason
        )
        .option('--dismissed-comment <comment>', 'Dismissed comment')
        .hook('preAction', (thisCommand) => {
          const opts = thisCommand.opts();
          if (opts.state === 'dismissed' && !opts.dismissedReason) {
            throw new InvalidArgumentError(
              'updateDependabotAlert requires --dismissed-reason when --state dismissed'
            );
          }
          if (opts.state === 'open' && opts.dismissedReason) {
            throw new InvalidArgumentError(
              'updateDependabotAlert does not accept --dismissed-reason when --state open'
            );
          }
          if (opts.state === 'open' && opts.dismissedComment) {
            throw new InvalidArgumentError(
              'updateDependabotAlert does not accept --dismissed-comment when --state open'
            );
          }
        });
      return true;
    default:
      return false;
  }
}
