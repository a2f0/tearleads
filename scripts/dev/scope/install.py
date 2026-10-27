"""Install the pinned native macOS arm64 Scope stack without changing tracked source."""
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile
import urllib.request

tooling = Path(__file__).resolve().parent
root = tooling.parents[2]
runtime = root / '.scope/runtime'
pins = json.loads((tooling / 'pins.json').read_text())
source = Path(os.environ.get('SCOPE_SOURCE_DIR', Path.home() / '.local/share/scope/source'))


def run(*args, cwd=root):
    subprocess.run(args, cwd=cwd, check=True)


if (platform.system(), platform.machine()) != ('Darwin', 'arm64'):
    raise SystemExit('This native installer supports macOS arm64. See docs/developer/scope.md.')
if sys.version_info < (3, 12):
    raise SystemExit('Python 3.12 or newer is required for filtered archive extraction.')
for executable in ['bun', 'node', 'npm', 'pnpm', 'git', 'redis-server', 'claude', 'codex', 'lsof']:
    if not shutil.which(executable):
        raise SystemExit(f'Missing prerequisite: {executable}')
runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
if not source.exists():
    source.parent.mkdir(parents=True, exist_ok=True)
    run('git', 'clone', '--no-checkout', pins['source']['url'], str(source))
    run('git', 'checkout', '--detach', pins['source']['commit'], cwd=source)
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()
dirty = subprocess.check_output(['git', 'status', '--porcelain'], cwd=source, text=True).strip()
if head != pins['source']['commit'] or dirty:
    raise SystemExit('Scope checkout differs from the pin; set SCOPE_SOURCE_DIR to a new directory.')
if subprocess.check_output(['pnpm', '--version'], cwd=source, text=True).strip() != pins['source']['pnpm']:
    raise SystemExit(f"Use pnpm {pins['source']['pnpm']} for the pinned Scope checkout.")
filters = ['api...', 'scheduler...', 'post-processor...', 'coder-acp-claude-code...',
           'portal...', 'cli...', 'db-migrations...']
run('pnpm', *[arg for name in filters for arg in ['--filter', name]],
    'install', '--frozen-lockfile', cwd=source)
run('pnpm', '--filter', 'telemetry', 'build', cwd=source)
run('pnpm', 'build:cli', cwd=source)

tools = runtime / 'tools'
tools.mkdir(exist_ok=True)
(tools / 'package.json').write_text(json.dumps({'private': True, **pins['tools']}, indent=2) + '\n')
run('npm', 'install', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund', cwd=tools)
mongo = pins['mongodb']
binary = runtime / f"mongodb-macos-aarch64-{mongo['version']}/bin/mongod"
if not binary.exists():
    archive = runtime / f"mongodb-{mongo['version']}.tgz"
    if not archive.exists():
        print(f"Downloading MongoDB {mongo['version']}", flush=True)
        urllib.request.urlretrieve(mongo['url'], archive)
    with archive.open('rb') as downloaded:
        digest = hashlib.file_digest(downloaded, 'sha256').hexdigest()
    if digest != mongo['sha256']:
        raise SystemExit(f'MongoDB checksum mismatch: remove {archive} and retry.')
    with tarfile.open(archive) as downloaded:
        downloaded.extractall(runtime, filter='data')
print('Installed. Run bun run scope start, then bun run scope:register.')
