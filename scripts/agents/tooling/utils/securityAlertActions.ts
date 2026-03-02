import type { ActionName, GlobalOptions } from '../types.ts';
import { createGitHubClientContext } from './githubClient.ts';
import {
  getCodeScanningAlertWithOctokit,
  listCodeScanningAlertsWithOctokit,
  updateCodeScanningAlertWithOctokit
} from './octokitCodeScanningHandlers.ts';
import {
  getDependabotAlertWithOctokit,
  listDependabotAlertsWithOctokit,
  updateDependabotAlertWithOctokit
} from './octokitDependabotHandlers.ts';
import {
  getSecretScanningAlertWithOctokit,
  listSecretScanningAlertsWithOctokit,
  updateSecretScanningAlertWithOctokit
} from './octokitSecretScanningHandlers.ts';

export async function runSecurityAlertAction(
  action: ActionName,
  repo: string,
  options: GlobalOptions
): Promise<string | null> {
  if (action === 'listDependabotAlerts') {
    const context = createGitHubClientContext(repo);
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
    const context = createGitHubClientContext(repo);
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
    const context = createGitHubClientContext(repo);
    return updateDependabotAlertWithOctokit(context, input);
  }

  if (action === 'listCodeScanningAlerts') {
    const context = createGitHubClientContext(repo);
    const input: Parameters<typeof listCodeScanningAlertsWithOctokit>[1] = {};
    if (options.state !== undefined) {
      input.state = options.state;
    }
    if (options.severity !== undefined) {
      input.severity = options.severity;
    }
    if (options.toolName !== undefined) {
      input.toolName = options.toolName;
    }
    if (options.ref !== undefined) {
      input.ref = options.ref;
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
    return listCodeScanningAlertsWithOctokit(context, input);
  }

  if (action === 'getCodeScanningAlert') {
    if (options.alertNumber === undefined) {
      throw new Error('getCodeScanningAlert requires --alert-number');
    }
    const context = createGitHubClientContext(repo);
    return getCodeScanningAlertWithOctokit(context, options.alertNumber);
  }

  if (action === 'updateCodeScanningAlert') {
    if (options.alertNumber === undefined) {
      throw new Error('updateCodeScanningAlert requires --alert-number');
    }
    if (options.state === undefined) {
      throw new Error('updateCodeScanningAlert requires --state');
    }
    const input: Parameters<typeof updateCodeScanningAlertWithOctokit>[1] = {
      alertNumber: options.alertNumber,
      state: options.state
    };
    if (options.dismissedReason !== undefined) {
      input.dismissedReason = options.dismissedReason;
    }
    if (options.dismissedComment !== undefined) {
      input.dismissedComment = options.dismissedComment;
    }
    const context = createGitHubClientContext(repo);
    return updateCodeScanningAlertWithOctokit(context, input);
  }

  if (action === 'listSecretScanningAlerts') {
    const context = createGitHubClientContext(repo);
    const input: Parameters<typeof listSecretScanningAlertsWithOctokit>[1] = {};
    if (options.state !== undefined) {
      input.state = options.state;
    }
    if (options.secretType !== undefined) {
      input.secretType = options.secretType;
    }
    if (options.resolution !== undefined) {
      input.resolution = options.resolution;
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
    return listSecretScanningAlertsWithOctokit(context, input);
  }

  if (action === 'getSecretScanningAlert') {
    if (options.alertNumber === undefined) {
      throw new Error('getSecretScanningAlert requires --alert-number');
    }
    const context = createGitHubClientContext(repo);
    return getSecretScanningAlertWithOctokit(context, options.alertNumber);
  }

  if (action === 'updateSecretScanningAlert') {
    if (options.alertNumber === undefined) {
      throw new Error('updateSecretScanningAlert requires --alert-number');
    }
    if (options.state === undefined) {
      throw new Error('updateSecretScanningAlert requires --state');
    }
    const input: Parameters<typeof updateSecretScanningAlertWithOctokit>[1] = {
      alertNumber: options.alertNumber,
      state: options.state
    };
    if (options.resolution !== undefined) {
      input.resolution = options.resolution;
    }
    if (options.resolutionComment !== undefined) {
      input.resolutionComment = options.resolutionComment;
    }
    const context = createGitHubClientContext(repo);
    return updateSecretScanningAlertWithOctokit(context, input);
  }

  return null;
}
