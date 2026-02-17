#!/usr/bin/env -S pnpm exec tsx
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const NC = '\x1b[0m';

const runnerDir = process.env['RUNNER_DIR'] || path.join(os.homedir(), 'actions-runner');
const runnerVersion = process.env['RUNNER_VERSION'] || '2.331.0';
const runnerGitconfig =
  process.env['RUNNER_GITCONFIG'] || path.join(runnerDir, '.gitconfig.runner');

function logInfo(message: string): void {
  process.stdout.write(`${GREEN}[INFO]${NC} ${message}\n`);
}

function logWarn(message: string): void {
  process.stdout.write(`${YELLOW}[WARN]${NC} ${message}\n`);
}

function logError(message: string): void {
  process.stderr.write(`${RED}[ERROR]${NC} ${message}\n`);
}

function run(command: string, args: string[], cwd?: string): string {
  return execFileSync(command, args, {
    encoding: 'utf8',
    cwd,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function runStreaming(command: string, args: string[], cwd?: string): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed`);
  }
}

function tryRun(command: string, args: string[], cwd?: string): string | null {
  try {
    return run(command, args, cwd);
  } catch {
    return null;
  }
}

function tryRunStreaming(command: string, args: string[], cwd?: string): void {
  spawnSync(command, args, {
    cwd,
    stdio: 'inherit'
  });
}

function getRepo(): string {
  return (
    tryRun('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']) ||
    ''
  );
}

function checkRepo(repo: string): void {
  if (repo.length === 0) {
    throw new Error(
      "Could not determine repository. Ensure you're in a git repo with a GitHub remote."
    );
  }
  logInfo(`Repository: ${repo}`);
}

function ensureNvmScriptPath(): string {
  const nvmDir = process.env['NVM_DIR'] || path.join(os.homedir(), '.nvm');
  const nvmScript = path.join(nvmDir, 'nvm.sh');
  if (!existsSync(nvmScript)) {
    throw new Error(
      'nvm is required for Node.js management but was not found. Install nvm and ensure $NVM_DIR/nvm.sh is available, then rerun.'
    );
  }
  return nvmScript;
}

function upsertEnvVar(filePath: string, key: string, value: string): void {
  const lines = existsSync(filePath)
    ? readFileSync(filePath, 'utf8').split('\n')
    : [];

  const nextLines: string[] = [];
  let written = false;
  for (const line of lines) {
    if (line.startsWith(`${key}=`)) {
      if (!written) {
        nextLines.push(`${key}=${value}`);
        written = true;
      }
      continue;
    }
    nextLines.push(line);
  }

  if (!written) {
    nextLines.push(`${key}=${value}`);
  }

  const normalized = nextLines.join('\n').replace(/\n*$/, '\n');
  writeFileSync(filePath, normalized);
}

function ensureRunnerGitconfig(): void {
  const includePath = path.join(os.homedir(), '.gitconfig');
  mkdirSync(path.dirname(runnerGitconfig), { recursive: true });
  if (!existsSync(runnerGitconfig)) {
    writeFileSync(runnerGitconfig, '');
  }

  if (runnerGitconfig === includePath) {
    return;
  }

  const existing = tryRun('git', ['config', '--file', runnerGitconfig, '--get-all', 'include.path']);
  const hasInclude =
    existing !== null &&
    existing
      .split('\n')
      .map((line) => line.trim())
      .includes(includePath);

  if (!hasInclude) {
    run('git', ['config', '--file', runnerGitconfig, '--add', 'include.path', includePath]);
  }
}

function cleanupUserGitconfigSafeDirectories(): void {
  const userGitconfig = path.join(os.homedir(), '.gitconfig');
  if (!existsSync(userGitconfig)) {
    return;
  }

  const entries = tryRun('git', ['config', '--file', userGitconfig, '--get-all', 'safe.directory']);
  if (!entries) {
    return;
  }

  const runnerWorkPrefix = `${runnerDir}/_work/`;
  const filtered = entries
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith(runnerWorkPrefix));

  tryRun('git', ['config', '--file', userGitconfig, '--unset-all', 'safe.directory']);
  for (const safeDir of filtered) {
    run('git', ['config', '--file', userGitconfig, '--add', 'safe.directory', safeDir]);
  }
}

function configureRunnerGitBehavior(): void {
  if (!existsSync(runnerDir)) {
    return;
  }

  ensureRunnerGitconfig();
  const runnerEnvPath = path.join(runnerDir, '.env');
  upsertEnvVar(runnerEnvPath, 'GIT_CONFIG_GLOBAL', runnerGitconfig);
  cleanupUserGitconfigSafeDirectories();
}

function askYesNo(prompt: string): boolean {
  process.stdout.write(prompt);
  const buffer = Buffer.alloc(1024);
  const bytesRead = readSync(0, buffer, 0, buffer.length, null);
  const answer = buffer.toString('utf8', 0, bytesRead).trim();
  return answer.toLowerCase() === 'y';
}

function commandPrereqs(): void {
  const nvmScript = ensureNvmScriptPath();

  logInfo('Installing Node.js from .nvmrc via nvm...');
  runStreaming('bash', ['-lc', `source "${nvmScript}" && nvm install && nvm use`]);

  if (!tryRun('corepack', ['--version'])) {
    throw new Error('corepack was not found after activating Node via nvm.');
  }

  logInfo('Enabling pnpm via corepack...');
  runStreaming('corepack', ['enable']);

  if (!tryRun('pnpm', ['--version'])) {
    throw new Error('pnpm is not available after corepack enable.');
  }

  logInfo('Installing non-Node prerequisites via Homebrew...');
  if (!tryRun('brew', ['--version'])) {
    throw new Error('Homebrew not found. Install from https://brew.sh');
  }

  runStreaming('brew', ['install', 'ruby', 'python', 'imagemagick']);

  logInfo('Installing Ansible via pip...');
  runStreaming('pip3', ['install', '--user', 'ansible', 'ansible-lint', 'passlib']);

  logInfo('Prerequisites installed. You may need to:');
  process.stdout.write('  - Install Xcode from the App Store (for iOS builds)\n');
  process.stdout.write("  - Run 'xcode-select --install' for command line tools\n");
  process.stdout.write('  - Configure Ruby version manager if needed (rbenv/rvm)\n');
}

function detectRunnerArch(): { runnerArch: string; archLabel: string } {
  const arch = run('uname', ['-m']);
  if (arch === 'arm64') {
    return { runnerArch: 'osx-arm64', archLabel: 'ARM64' };
  }
  if (arch === 'x86_64') {
    return { runnerArch: 'osx-x64', archLabel: 'X64' };
  }
  throw new Error(`Unsupported architecture: ${arch}`);
}

function commandInstall(repo: string): void {
  checkRepo(repo);

  if (existsSync(runnerDir)) {
    logWarn(`Runner directory already exists at ${runnerDir}`);
    const shouldRemove = askYesNo('Remove and reinstall? [y/N] ');
    if (!shouldRemove) {
      process.exit(1);
    }
    rmSync(runnerDir, { recursive: true, force: true });
  }

  logInfo(`Creating runner directory at ${runnerDir}`);
  mkdirSync(runnerDir, { recursive: true });

  const arch = detectRunnerArch();
  const runnerUrl = `https://github.com/actions/runner/releases/download/v${runnerVersion}/actions-runner-${arch.runnerArch}-${runnerVersion}.tar.gz`;
  const archivePath = path.join(runnerDir, 'actions-runner.tar.gz');

  logInfo(`Downloading runner v${runnerVersion} for ${arch.runnerArch}...`);
  runStreaming('curl', ['-o', archivePath, '-L', runnerUrl], runnerDir);

  logInfo('Extracting runner...');
  runStreaming('tar', ['xzf', 'actions-runner.tar.gz'], runnerDir);
  rmSync(archivePath, { force: true });

  logInfo('Fetching registration token...');
  const token = run('gh', ['api', '--method', 'POST', `repos/${repo}/actions/runners/registration-token`, '-q', '.token']);

  logInfo('Configuring runner...');
  runStreaming(
    './config.sh',
    [
      '--url',
      `https://github.com/${repo}`,
      '--token',
      token,
      '--name',
      `${os.hostname()}-self-hosted`,
      '--labels',
      `self-hosted,macOS,${arch.archLabel}`,
      '--work',
      '_work'
    ],
    runnerDir
  );

  configureRunnerGitBehavior();
  logInfo('Runner installed successfully!');
  process.stdout.write('\nNext steps:\n');
  process.stdout.write('  ./scripts/selfHostedRunner.ts start    # Run interactively\n');
  process.stdout.write('  ./scripts/selfHostedRunner.ts service  # Install as background service\n');
}

function commandStart(): void {
  if (!existsSync(runnerDir)) {
    throw new Error('Runner not installed. Run: ./scripts/selfHostedRunner.ts install');
  }

  configureRunnerGitBehavior();
  process.env['GIT_CONFIG_GLOBAL'] = runnerGitconfig;

  logInfo('Starting runner in foreground (Ctrl+C to stop)...');
  runStreaming('./run.sh', [], runnerDir);
}

function commandService(): void {
  if (!existsSync(runnerDir)) {
    throw new Error('Runner not installed. Run: ./scripts/selfHostedRunner.ts install');
  }

  configureRunnerGitBehavior();
  logInfo('Installing runner as launchd service...');
  runStreaming('./svc.sh', ['install'], runnerDir);

  logInfo('Starting service...');
  runStreaming('./svc.sh', ['start'], runnerDir);

  logInfo('Service installed and started!');
  runStreaming('./svc.sh', ['status'], runnerDir);
}

function commandStop(): void {
  if (!existsSync(runnerDir)) {
    throw new Error('Runner not installed.');
  }

  const svcPath = path.join(runnerDir, 'svc.sh');
  if (existsSync(svcPath)) {
    logInfo('Stopping runner service...');
    tryRunStreaming('./svc.sh', ['stop'], runnerDir);
    return;
  }
  logWarn('Service script not found. Runner may be running in foreground.');
}

function commandStatus(repo: string): void {
  checkRepo(repo);

  process.stdout.write('\n');
  logInfo('=== Repository Variable ===');
  const varValue = tryRun('gh', ['variable', 'get', 'USE_SELF_HOSTED']) || 'not set';
  if (varValue === 'true') {
    process.stdout.write(`USE_SELF_HOSTED: ${GREEN}true${NC} (self-hosted mode ENABLED)\n`);
  } else {
    process.stdout.write(
      `USE_SELF_HOSTED: ${YELLOW}${varValue}${NC} (using GitHub-hosted runners)\n`
    );
  }

  process.stdout.write('\n');
  logInfo('=== Local Runner ===');
  if (existsSync(runnerDir)) {
    process.stdout.write(`Runner directory: ${runnerDir}\n`);
    const svcPath = path.join(runnerDir, 'svc.sh');
    if (existsSync(svcPath)) {
      const status = tryRun('./svc.sh', ['status'], runnerDir);
      process.stdout.write(`${status || 'Service not installed'}\n`);
    }
  } else {
    process.stdout.write('Runner not installed locally\n');
  }

  process.stdout.write('\n');
  logInfo('=== Registered Runners ===');
  const out = tryRun('gh', [
    'api',
    `repos/${repo}/actions/runners`,
    '--jq',
    '.runners[] | "\\(.name): \\(.status) (\\(.labels | map(.name) | join(", ")))"'
  ]);
  process.stdout.write(`${out || 'No runners registered or insufficient permissions'}\n`);
}

function commandEnable(repo: string): void {
  checkRepo(repo);
  logInfo('Enabling self-hosted mode...');
  runStreaming('gh', ['variable', 'set', 'USE_SELF_HOSTED', '--body', 'true']);
  logInfo('Self-hosted mode ENABLED. New workflow runs will use self-hosted runners.');
}

function commandDisable(repo: string): void {
  checkRepo(repo);
  logInfo('Disabling self-hosted mode...');
  tryRunStreaming('gh', ['variable', 'delete', 'USE_SELF_HOSTED']);
  logInfo('Self-hosted mode DISABLED. New workflow runs will use GitHub-hosted runners.');
}

function commandUninstall(repo: string): void {
  checkRepo(repo);

  if (!existsSync(runnerDir)) {
    logWarn(`Runner directory not found at ${runnerDir}`);
    return;
  }

  const svcPath = path.join(runnerDir, 'svc.sh');
  if (existsSync(svcPath)) {
    logInfo('Stopping and uninstalling service...');
    tryRunStreaming('./svc.sh', ['stop'], runnerDir);
    tryRunStreaming('./svc.sh', ['uninstall'], runnerDir);
  }

  logInfo('Fetching removal token...');
  const token = tryRun('gh', [
    'api',
    '--method',
    'POST',
    `repos/${repo}/actions/runners/remove-token`,
    '-q',
    '.token'
  ]);

  if (token && token.length > 0) {
    logInfo('Removing runner from GitHub...');
    tryRunStreaming('./config.sh', ['remove', '--token', token], runnerDir);
  }

  logInfo('Removing runner directory...');
  rmSync(runnerDir, { recursive: true, force: true });
  logInfo('Runner uninstalled.');
}

function commandHelp(scriptPath: string): void {
  process.stdout.write('Self-hosted GitHub Actions runner management\n\n');
  process.stdout.write(`Usage: ${scriptPath} <command>\n\n`);
  process.stdout.write('Commands:\n');
  process.stdout.write('  install     Download and configure the runner\n');
  process.stdout.write('  start       Start runner in foreground\n');
  process.stdout.write('  service     Install and start as launchd service\n');
  process.stdout.write('  stop        Stop the launchd service\n');
  process.stdout.write('  status      Check runner and variable status\n');
  process.stdout.write('  enable      Enable self-hosted mode (set USE_SELF_HOSTED=true)\n');
  process.stdout.write('  disable     Disable self-hosted mode (delete USE_SELF_HOSTED)\n');
  process.stdout.write('  uninstall   Remove runner and service\n');
  process.stdout.write('  prereqs     Install prerequisites (nvm + Homebrew)\n\n');
  process.stdout.write('Environment variables:\n');
  process.stdout.write(`  RUNNER_DIR      Runner installation directory (default: ${path.join(os.homedir(), 'actions-runner')})\n`);
  process.stdout.write('  RUNNER_VERSION  Runner version to install (default: 2.331.0)\n');
  process.stdout.write(
    `  RUNNER_GITCONFIG  Runner-specific global git config path (default: ${path.join(
      os.homedir(),
      'actions-runner/.gitconfig.runner'
    )})\n`
  );
}

function main(): void {
  const repo = getRepo();
  const command = process.argv[2] || 'help';

  switch (command) {
    case 'install':
      commandInstall(repo);
      break;
    case 'start':
      commandStart();
      break;
    case 'service':
      commandService();
      break;
    case 'stop':
      commandStop();
      break;
    case 'status':
      commandStatus(repo);
      break;
    case 'enable':
      commandEnable(repo);
      break;
    case 'disable':
      commandDisable(repo);
      break;
    case 'uninstall':
      commandUninstall(repo);
      break;
    case 'prereqs':
      commandPrereqs();
      break;
    case 'help':
    case '--help':
    case '-h':
      commandHelp(process.argv[1] || './scripts/selfHostedRunner.ts');
      break;
    default:
      logError(`Unknown command: ${command}`);
      commandHelp(process.argv[1] || './scripts/selfHostedRunner.ts');
      process.exit(1);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  logError(message);
  process.exit(1);
}
