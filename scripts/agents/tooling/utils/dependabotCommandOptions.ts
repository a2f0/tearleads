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

function parseDirection(value: string): string {
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

function parseCodeScanningState(value: string): string {
  if (value === 'open' || value === 'dismissed' || value === 'fixed') {
    return value;
  }
  throw new InvalidArgumentError(
    '--state must be one of "open", "dismissed", or "fixed"'
  );
}

function parseCodeScanningUpdateState(value: string): string {
  if (value === 'open' || value === 'dismissed') {
    return value;
  }
  throw new InvalidArgumentError('--state must be "open" or "dismissed"');
}

function parseCodeScanningSort(value: string): string {
  if (value === 'created' || value === 'updated') {
    return value;
  }
  throw new InvalidArgumentError('--sort must be "created" or "updated"');
}

function parseCodeScanningDismissedReason(value: string): string {
  if (
    value === 'false_positive' ||
    value === 'wont_fix' ||
    value === 'used_in_tests'
  ) {
    return value;
  }
  throw new InvalidArgumentError(
    '--dismissed-reason must be one of "false_positive", "wont_fix", "used_in_tests"'
  );
}

function parseSecretScanningState(value: string): string {
  if (value === 'open' || value === 'resolved') {
    return value;
  }
  throw new InvalidArgumentError('--state must be "open" or "resolved"');
}

function parseSecretScanningSort(value: string): string {
  if (value === 'created' || value === 'updated') {
    return value;
  }
  throw new InvalidArgumentError('--sort must be "created" or "updated"');
}

function parseSecretScanningResolution(value: string): string {
  if (
    value === 'false_positive' ||
    value === 'wont_fix' ||
    value === 'revoked' ||
    value === 'used_in_tests' ||
    value === 'pattern_edited' ||
    value === 'pattern_deleted'
  ) {
    return value;
  }
  throw new InvalidArgumentError(
    '--resolution must be one of "false_positive", "wont_fix", "revoked", "used_in_tests", "pattern_edited", "pattern_deleted"'
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
        .option('--direction <direction>', 'Sort direction', parseDirection)
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
    case 'listCodeScanningAlerts':
      cmd
        .option('--state <state>', 'Alert state', parseCodeScanningState)
        .option('--severity <severity>', 'Alert severity')
        .option('--tool-name <name>', 'Tool name filter')
        .option('--ref <ref>', 'Git ref to filter by')
        .option('--sort <sort>', 'Sort field', parseCodeScanningSort)
        .option('--direction <direction>', 'Sort direction', parseDirection)
        .option('--per-page <n>', 'Results per page', (v) =>
          parsePositiveInt(v, '--per-page')
        );
      return true;
    case 'getCodeScanningAlert':
      cmd.requiredOption(
        '--alert-number <n>',
        'Code scanning alert number',
        (v) => parsePositiveInt(v, '--alert-number')
      );
      return true;
    case 'updateCodeScanningAlert':
      cmd
        .requiredOption(
          '--alert-number <n>',
          'Code scanning alert number',
          (v) => parsePositiveInt(v, '--alert-number')
        )
        .requiredOption(
          '--state <state>',
          'Target alert state',
          parseCodeScanningUpdateState
        )
        .option(
          '--dismissed-reason <reason>',
          'Dismissed reason',
          parseCodeScanningDismissedReason
        )
        .option('--dismissed-comment <comment>', 'Dismissed comment')
        .hook('preAction', (thisCommand) => {
          const opts = thisCommand.opts();
          if (opts.state === 'dismissed' && !opts.dismissedReason) {
            throw new InvalidArgumentError(
              'updateCodeScanningAlert requires --dismissed-reason when --state dismissed'
            );
          }
          if (opts.state === 'open' && opts.dismissedReason) {
            throw new InvalidArgumentError(
              'updateCodeScanningAlert does not accept --dismissed-reason when --state open'
            );
          }
          if (opts.state === 'open' && opts.dismissedComment) {
            throw new InvalidArgumentError(
              'updateCodeScanningAlert does not accept --dismissed-comment when --state open'
            );
          }
        });
      return true;
    case 'listSecretScanningAlerts':
      cmd
        .option('--state <state>', 'Alert state', parseSecretScanningState)
        .option('--secret-type <type>', 'Secret type filter')
        .option(
          '--resolution <resolution>',
          'Resolution filter',
          parseSecretScanningResolution
        )
        .option('--sort <sort>', 'Sort field', parseSecretScanningSort)
        .option('--direction <direction>', 'Sort direction', parseDirection)
        .option('--per-page <n>', 'Results per page', (v) =>
          parsePositiveInt(v, '--per-page')
        );
      return true;
    case 'getSecretScanningAlert':
      cmd.requiredOption(
        '--alert-number <n>',
        'Secret scanning alert number',
        (v) => parsePositiveInt(v, '--alert-number')
      );
      return true;
    case 'updateSecretScanningAlert':
      cmd
        .requiredOption(
          '--alert-number <n>',
          'Secret scanning alert number',
          (v) => parsePositiveInt(v, '--alert-number')
        )
        .requiredOption(
          '--state <state>',
          'Target alert state',
          parseSecretScanningState
        )
        .option(
          '--resolution <resolution>',
          'Resolution value',
          parseSecretScanningResolution
        )
        .option('--resolution-comment <comment>', 'Resolution comment')
        .hook('preAction', (thisCommand) => {
          const opts = thisCommand.opts();
          if (opts.state === 'resolved' && !opts.resolution) {
            throw new InvalidArgumentError(
              'updateSecretScanningAlert requires --resolution when --state resolved'
            );
          }
          if (opts.state === 'open' && opts.resolution) {
            throw new InvalidArgumentError(
              'updateSecretScanningAlert does not accept --resolution when --state open'
            );
          }
          if (opts.state === 'open' && opts.resolutionComment) {
            throw new InvalidArgumentError(
              'updateSecretScanningAlert does not accept --resolution-comment when --state open'
            );
          }
        });
      return true;
    default:
      return false;
  }
}
