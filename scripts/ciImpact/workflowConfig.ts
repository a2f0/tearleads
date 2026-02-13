export type JobName =
  | 'build'
  | 'web-e2e'
  | 'website-e2e'
  | 'electron-e2e'
  | 'android'
  | 'android-maestro-release'
  | 'ios-maestro-release';

export const ALL_JOB_NAMES: ReadonlyArray<JobName> = [
  'build',
  'web-e2e',
  'website-e2e',
  'electron-e2e',
  'android',
  'android-maestro-release',
  'ios-maestro-release'
];

export const WORKFLOW_BY_JOB: Readonly<Record<JobName, string>> = {
  build: 'build',
  'web-e2e': 'Web E2E Tests (Release)',
  'website-e2e': 'Website E2E Tests (Release)',
  'electron-e2e': 'Electron E2E Tests (Release)',
  android: 'Android Instrumented Tests',
  'android-maestro-release': 'Android Maestro Tests (Release)',
  'ios-maestro-release': 'iOS Maestro Tests (Release)'
};

export const WORKFLOW_FILE_BY_JOB: Readonly<Record<JobName, string>> = {
  build: '.github/workflows/build.yml',
  'web-e2e': '.github/workflows/web-e2e.yml',
  'website-e2e': '.github/workflows/website-e2e.yml',
  'electron-e2e': '.github/workflows/electron-e2e.yml',
  android: '.github/workflows/android.yml',
  'android-maestro-release': '.github/workflows/android-maestro-release.yml',
  'ios-maestro-release': '.github/workflows/ios-maestro-release.yml'
};

export const CI_GATE_WORKFLOW_NAME = 'CI Gate';
export const CI_GATE_WORKFLOW_FILE = '.github/workflows/ci-gate.yml';
