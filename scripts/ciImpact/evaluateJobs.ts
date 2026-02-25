import { ALL_JOB_NAMES, type JobName } from './workflowConfig.ts';

interface Config {
  ignoredPrefixes: string[];
  ignoredExact: string[];
  ignoredSuffixes: string[];
  workflowCriticalPrefixes: string[];
  clientRuntimePackages: string[];
  jobNames: JobName[];
}

interface JobState {
  run: boolean;
  reasons: string[];
}

type JobDecision = Record<JobName, JobState>;

interface EvaluateInput {
  changedFiles: string[];
  materialFiles: string[];
  affectedPackages: Set<string>;
  config: Config;
}

function startsWithOneOf(file: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => file.startsWith(prefix));
}

function isAndroidNativePath(file: string): boolean {
  return (
    file.startsWith('packages/client/android/') || file.startsWith('android/')
  );
}

function isIosNativePath(file: string): boolean {
  return file.startsWith('packages/client/ios/') || file.startsWith('ios/');
}

function isSharedMobileReleasePath(file: string): boolean {
  return (
    file.startsWith('packages/client/fastlane/') ||
    file.startsWith('fastlane/') ||
    file === 'packages/client/capacitor.config.ts'
  );
}

function isMaestroPath(file: string): boolean {
  return file.startsWith('packages/client/.maestro/');
}

function blankJobs(jobNames: JobName[]): JobDecision {
  const jobs: Partial<JobDecision> = {};
  for (const name of jobNames) {
    jobs[name] = { run: false, reasons: [] };
  }

  for (const name of ALL_JOB_NAMES) {
    if (jobs[name] === undefined) {
      throw new Error(`Config missing one or more required jobs: ${name}`);
    }
  }

  function mustGet(name: JobName): JobState {
    const state = jobs[name];
    if (state === undefined) {
      throw new Error(`Config missing one or more required jobs: ${name}`);
    }
    return state;
  }

  return {
    build: mustGet('build'),
    'web-e2e': mustGet('web-e2e'),
    'website-e2e': mustGet('website-e2e'),
    'electron-e2e': mustGet('electron-e2e'),
    android: mustGet('android'),
    'android-maestro-release': mustGet('android-maestro-release'),
    'ios-maestro-release': mustGet('ios-maestro-release')
  };
}

export function evaluateJobs(input: EvaluateInput): JobDecision {
  const { changedFiles, materialFiles, affectedPackages, config } = input;
  const jobs = blankJobs(config.jobNames);

  if (materialFiles.length === 0) {
    return jobs;
  }

  jobs.build.run = true;
  jobs.build.reasons.push('material file changes detected');

  const workflowCriticalChanged = changedFiles.some((file) =>
    startsWithOneOf(file, config.workflowCriticalPrefixes)
  );
  if (workflowCriticalChanged) {
    for (const name of config.jobNames) {
      jobs[name].run = true;
      jobs[name].reasons.push(
        'workflow/config changed: run full integration matrix'
      );
    }
    return jobs;
  }

  const hasClientRuntimePackageImpact = [...affectedPackages].some((pkgName) =>
    config.clientRuntimePackages.includes(pkgName)
  );
  const hasWebsiteImpact = affectedPackages.has('@tearleads/website');
  const hasApiImpact = affectedPackages.has('@tearleads/api');
  const hasClientImpact = affectedPackages.has('@tearleads/client');

  const hasWebE2ETestFiles = changedFiles.some(
    (file) =>
      file === 'packages/client/playwright.config.ts' ||
      /^packages\/client\/tests\/.*\.spec\.ts$/.test(file)
  );
  const hasElectronSpecific = changedFiles.some(
    (file) =>
      file.startsWith('packages/client/electron/') ||
      file.startsWith('packages/client/tests/electron/') ||
      file === 'packages/client/playwright.electron.config.ts'
  );
  const hasWebsiteFiles = changedFiles.some((file) =>
    file.startsWith('packages/website/')
  );
  const hasAndroidNativeSpecific = changedFiles.some((file) =>
    isAndroidNativePath(file)
  );
  const hasIosNativeSpecific = changedFiles.some((file) =>
    isIosNativePath(file)
  );
  const hasSharedMobileReleaseSpecific = changedFiles.some((file) =>
    isSharedMobileReleasePath(file)
  );
  const hasMaestroSpecific = changedFiles.some((file) => isMaestroPath(file));
  const hasAndroidSpecific =
    hasAndroidNativeSpecific || hasSharedMobileReleaseSpecific;
  const hasIosSpecific = hasIosNativeSpecific || hasSharedMobileReleaseSpecific;
  const hasMobileSpecific =
    hasAndroidSpecific || hasIosSpecific || hasMaestroSpecific;
  const mobilePlatformIsolatedChange =
    materialFiles.length > 0 &&
    materialFiles.every(
      (file) => isAndroidNativePath(file) || isIosNativePath(file)
    );
  const hasSharedClientRuntimeImpact =
    hasClientRuntimePackageImpact && !mobilePlatformIsolatedChange;

  if (
    hasWebE2ETestFiles ||
    hasClientImpact ||
    hasApiImpact ||
    hasSharedClientRuntimeImpact
  ) {
    jobs['web-e2e'].run = true;
    jobs['web-e2e'].reasons.push(
      'client/web runtime or e2e test surface impacted'
    );
  }

  if (hasWebsiteFiles || hasWebsiteImpact || hasApiImpact) {
    jobs['website-e2e'].run = true;
    jobs['website-e2e'].reasons.push('website or API surface impacted');
  }

  if (hasElectronSpecific || hasClientImpact || hasSharedClientRuntimeImpact) {
    jobs['electron-e2e'].run = true;
    jobs['electron-e2e'].reasons.push(
      'electron/client runtime surface impacted'
    );
  }

  if (hasMobileSpecific || hasSharedClientRuntimeImpact) {
    if (
      hasAndroidSpecific ||
      hasSharedClientRuntimeImpact ||
      hasMaestroSpecific
    ) {
      jobs.android.run = true;
      jobs.android.reasons.push(
        hasAndroidNativeSpecific
          ? 'android-specific files changed'
          : hasSharedMobileReleaseSpecific
            ? 'shared mobile release config changed'
            : hasMaestroSpecific
              ? 'maestro files changed'
              : 'shared client runtime surface impacted'
      );
      jobs['android-maestro-release'].run = true;
      jobs['android-maestro-release'].reasons.push(
        hasAndroidNativeSpecific
          ? 'android files changed'
          : hasSharedMobileReleaseSpecific
            ? 'shared mobile release config changed'
            : hasMaestroSpecific
              ? 'maestro files changed'
              : 'shared client runtime surface impacted'
      );
    }

    if (hasIosSpecific || hasSharedClientRuntimeImpact || hasMaestroSpecific) {
      jobs['ios-maestro-release'].run = true;
      jobs['ios-maestro-release'].reasons.push(
        hasIosNativeSpecific
          ? 'ios files changed'
          : hasSharedMobileReleaseSpecific
            ? 'shared mobile release config changed'
            : hasMaestroSpecific
              ? 'maestro files changed'
              : 'shared client runtime surface impacted'
      );
    }
  }

  const tuxedoOnly =
    materialFiles.length > 0 &&
    materialFiles.every(
      (file) =>
        file.startsWith('tuxedo/') ||
        file.startsWith('ansible/') ||
        file.startsWith('scripts/tuxedo') ||
        file === 'tuxedo/tuxedo.sh'
    );

  if (tuxedoOnly) {
    jobs.android.run = false;
    jobs.android.reasons = [];
    jobs['android-maestro-release'].run = false;
    jobs['android-maestro-release'].reasons = [];
    jobs['ios-maestro-release'].run = false;
    jobs['ios-maestro-release'].reasons = [];
  }

  return jobs;
}
