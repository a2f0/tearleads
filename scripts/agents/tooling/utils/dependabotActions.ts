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
    return listDependabotAlertsWithOctokit(context, {
      state: options.state,
      severity: options.severity,
      ecosystem: options.ecosystem,
      packageName: options.package,
      manifest: options.manifest,
      scope: options.scope,
      sort: options.sort,
      direction: options.direction,
      perPage: options.perPage
    });
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
    return updateDependabotAlertWithOctokit(context, {
      alertNumber: options.alertNumber,
      state: options.state,
      dismissedReason: options.dismissedReason,
      dismissedComment: options.dismissedComment
    });
  }

  return null;
}
