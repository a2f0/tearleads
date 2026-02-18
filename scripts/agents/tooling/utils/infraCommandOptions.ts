import { Command, InvalidArgumentError } from 'commander';
import type { ActionName } from '../types.ts';
import {
  isAnsibleBootstrapTarget,
  isTerraformScriptForStack,
  isTerraformStack,
  listAnsibleBootstrapTargets,
  listTerraformScripts,
  listTerraformStacks
} from './infraActions.ts';

export function applyInfraCommandOptions(
  actionName: ActionName,
  cmd: Command
): boolean {
  switch (actionName) {
    case 'runTerraformStackScript':
      cmd
        .requiredOption(
          '--stack <name>',
          'Terraform stack',
          (value: string): string => {
            if (!isTerraformStack(value)) {
              throw new InvalidArgumentError(
                `--stack must be one of: ${listTerraformStacks().join(', ')}`
              );
            }
            return value;
          }
        )
        .requiredOption('--script <name>', 'Terraform script name')
        .option('--yes', 'Confirm execution')
        .hook('preAction', (thisCommand) => {
          const opts = thisCommand.opts();
          if (!isTerraformScriptForStack(opts.stack, opts.script)) {
            console.error(
              `error: --script must be one of: ${listTerraformScripts(opts.stack).join(', ')}`
            );
            process.exit(1);
          }
          if (!opts.dryRun && !opts.yes) {
            console.error(
              'error: runTerraformStackScript requires --yes unless --dry-run is set'
            );
            process.exit(1);
          }
        });
      return true;

    case 'runAnsibleBootstrap':
      cmd
        .requiredOption(
          '--target <name>',
          'Ansible bootstrap target',
          (value: string): string => {
            if (!isAnsibleBootstrapTarget(value)) {
              throw new InvalidArgumentError(
                `--target must be one of: ${listAnsibleBootstrapTargets().join(', ')}`
              );
            }
            return value;
          }
        )
        .option('--yes', 'Confirm execution')
        .hook('preAction', (thisCommand) => {
          const opts = thisCommand.opts();
          if (!opts.dryRun && !opts.yes) {
            console.error(
              'error: runAnsibleBootstrap requires --yes unless --dry-run is set'
            );
            process.exit(1);
          }
        });
      return true;

    default:
      return false;
  }
}
