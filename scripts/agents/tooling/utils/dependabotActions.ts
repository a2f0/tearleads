import type { ActionName, GlobalOptions } from '../types.ts';
import { createGitHubClientContext } from './githubClient.ts';
import {
  getDependabotAlertWithOctokit,
  listDependabotAlertsWithOctokit,
  updateDependabotAlertWithOctokit
} from './octokitDependabotHandlers.ts';

export async function runDependabotAction(
  action: ActionName,
  repo: string,
  options: GlobalOptions
): Promise<string | null> {
  const context = createGitHubClientContext(repo);

  if (action === 'listDependabotAlerts') {
    const input: Parameters<typeof listDependabotAlertsWithOctokit>[1] = {};
    if (options.state !== undefined) {
      input.state = options.state;
    }
    if (options.severity !== undefined) {
      input.severity = options.severity;
    }
    if (options.ecosystem !== undefined) {
      input.ecosystem = options.ecosystem;
    }
    if (options.package !== undefined) {
      input.packageName = options.package;
    }
    if (options.manifest !== undefined) {
      input.manifest = options.manifest;
    }
    if (options.scope !== undefined) {
      input.scope = options.scope;
    }
    if (options.sort !== undefined) {
      input.sort = options.sort;
    }
    if (options.direction !== undefined) {
      input.direction = options.direction;
    }
    if (options.perPage !== undefined) {
      input.perPage = options.perPage;
    }
    return listDependabotAlertsWithOctokit(context, input);
  }

  if (action === 'getDependabotAlert') {
    if (options.alertNumber === undefined) {
      throw new Error('getDependabotAlert requires --alert-number');
    }
    return getDependabotAlertWithOctokit(context, options.alertNumber);
  }

  if (action === 'updateDependabotAlert') {
    if (options.alertNumber === undefined) {
      throw new Error('updateDependabotAlert requires --alert-number');
    }
    if (options.state === undefined) {
      throw new Error('updateDependabotAlert requires --state');
    }
    const input: Parameters<typeof updateDependabotAlertWithOctokit>[1] = {
      alertNumber: options.alertNumber,
      state: options.state
    };
    if (options.dismissedReason !== undefined) {
      input.dismissedReason = options.dismissedReason;
    }
    if (options.dismissedComment !== undefined) {
      input.dismissedComment = options.dismissedComment;
    }
    return updateDependabotAlertWithOctokit(context, input);
  }

  return null;
}
