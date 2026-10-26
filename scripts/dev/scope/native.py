"""Start the checkout's native Scope services; state and logs stay in .scope."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import urllib.request

tooling = Path(__file__).resolve().parent
root = tooling.parents[2]
runtime = root / '.scope/runtime'
runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
pins = json.loads((tooling / 'pins.json').read_text())
source = Path(os.environ.get('SCOPE_SOURCE_DIR', Path.home() / '.local/share/scope/source'))
pid_file = runtime / 'pids.json'
ports = pins['ports']
api = f"http://127.0.0.1:{ports['api']}"
state = json.loads(pid_file.read_text()) if pid_file.exists() else {}
judge_only = sys.argv[1:] == ['judge']

def owns_process(name, pid):
    command = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True).stdout
    redis_title = f"redis-server 127.0.0.1:{ports['redis']}"
    return (str(runtime) in command or str(tooling) in command or
            (name == 'redis' and redis_title in command))


if sys.argv[1:] == ['stop']:
    stopped = []
    for name, pid in reversed(list(state.items())):
        if owns_process(name, pid):
            try:
                os.killpg(pid, signal.SIGTERM)
                stopped.append((name, pid))
            except ProcessLookupError:
                pass
    deadline = time.monotonic() + 5
    while any(owns_process(name, pid) for name, pid in stopped) and time.monotonic() < deadline:
        time.sleep(0.2)
    for name, pid in stopped:
        if owns_process(name, pid):
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        print(f'Stopped {name} ({pid})')
    pid_file.unlink(missing_ok=True)
    raise SystemExit(0)

if sys.argv[1:] not in ([], ['start'], ['judge']):
    raise SystemExit('Usage: native.py [start|stop|judge]')
if state and not judge_only:
    raise SystemExit('Existing native service PIDs found. Run this script with stop before restarting.')
if not judge_only and Path('/tmp/workspaces').exists() and any(Path('/tmp/workspaces').iterdir()):
    raise SystemExit('Scope uses /tmp/workspaces; refusing to replace an existing directory.')

for port in ([pins['ports']['judge']] if judge_only else
             [value for key, value in pins['ports'].items() if key != 'portal']):
    with socket.socket() as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(('127.0.0.1', port))

from native_config import environment
from native_network import verify_listeners, wait_tcp

env, claude_version, credentials = environment(runtime, pins)
node = ['node', '--require', str(tooling / 'loopback.cjs'), '--import', 'tsx',
        '--import', str(tooling / 'browser-guard.ts')]

def start(name, command, cwd=source, overrides=None):
    with (runtime / f'{name}.log').open('ab') as log:
        process = subprocess.Popen(command, cwd=cwd, env={**env, **(overrides or {})},
            stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    state[name] = process.pid
    pid_file.write_text(json.dumps(state, indent=2) + '\n')
    print(f'Started {name}: {process.pid}', flush=True)

def wait_http(url, expected=200):
    for _ in range(60):
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == expected:
                    return
        except OSError:
            pass
        time.sleep(1)
    raise RuntimeError(f'Not ready: {url}; inspect {runtime}/*.log')

def start_judge():
    start('judge', ['bun', str(tooling / 'judge/server.ts')], cwd=root)
    wait_http(f"http://127.0.0.1:{ports['judge']}/health")

if judge_only:
    start_judge()
    verify_listeners({'judge': ports['judge']})
    raise SystemExit(0)

for folder in ['mongodb', 'redis', 'azurite']:
    (runtime / folder).mkdir(exist_ok=True)
mongo = runtime / f"mongodb-macos-aarch64-{pins['mongodb']['version']}/bin/mongod"
start('mongodb', [str(mongo), '--bind_ip', '127.0.0.1', '--port', str(ports['mongo']),
    '--dbpath', str(runtime / 'mongodb'), '--quiet'])
start('redis', ['redis-server', '--bind', '127.0.0.1', '--port', str(ports['redis']),
    '--dir', str(runtime / 'redis'), '--save', '', '--appendonly', 'no'])
start('azurite', node + [str(runtime / 'tools/node_modules/azurite/dist/src/azurite.js'),
    '--blobHost', '127.0.0.1', '--blobPort', str(ports['blob']), '--queueHost', '127.0.0.1',
    '--queuePort', str(ports['queue']), '--tableHost', '127.0.0.1', '--tablePort', str(ports['table']),
    '--location', str(runtime / 'azurite'), '--skipApiVersionCheck', '--loose', '--silent'])
for name in ['mongo', 'redis', 'blob', 'queue', 'table']:
    wait_tcp(ports[name])
subprocess.run(node + ['packages/db-migrations/src/migrate.ts', 'up'], cwd=source, env=env, check=True)
start('api', node + ['apps/api/src/index.ts'], overrides={'PORT': str(ports['api'])})
wait_http(api + '/health')
agent = {
    '_id': 'coder-acp-claude-code', 'name': 'Claude Code CLI',
    'description': 'Local native Claude Code worker via ACP', 'modelProvider': 'anthropic',
    'available': True,
    'capabilities': {'supportsReasoningEffort': True, 'supportsMcpServers': True,
        'supportsSkills': True, 'supportsExtensions': False, 'supportsResources': False},
}
request = urllib.request.Request(api + '/api/v1/agents', data=json.dumps(agent).encode(),
    headers={'Content-Type': 'application/json'}, method='POST')
with urllib.request.urlopen(request, timeout=10) as response:
    assert response.status in [200, 201]
version = {
    'agentVersion': env['SCOPE_AGENT_VERSION'], 'workerVersion': 'scope-native',
    'components': {'CLAUDE_CODE_ACP_VERSION': env['CLAUDE_CODE_ACP_VERSION'], 'CLAUDE_AGENT_SDK_VERSION': env['CLAUDE_AGENT_SDK_VERSION'], 'CLAUDE_CODE_VERSION': claude_version},
    'gitCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip(),
    'buildTime': 'local', 'imageTag': 'native', 'queueName': 'queue-coder-acp-claude-code',
}
request = urllib.request.Request(api + '/api/v1/agents/coder-acp-claude-code/versions',
    data=json.dumps(version).encode(), headers={'Content-Type': 'application/json'}, method='POST')
with urllib.request.urlopen(request, timeout=10) as response:
    assert response.status in [200, 201]
start('scheduler', node + ['apps/scheduler/src/index.ts'], overrides={'PORT': str(ports['scheduler'])})
start('post-processor', node + ['apps/workers/post-processor/src/index.ts'])
start_judge()
start('worker', node + ['apps/workers/coder-acp-claude-code/src/index.ts'], overrides={
    'CLAUDE_CODE_OAUTH_TOKEN': credentials['accessToken'],
    'WORKER_NAME': 'coder-acp-claude-code', 'QUEUE_NAME': 'queue-coder-acp-claude-code',
})
try:
    # The coding worker and post-processor poll queues; they expose no HTTP listener.
    verify_listeners({name: port for name, port in ports.items() if name != 'portal'})
except RuntimeError:
    for name, pid in state.items():
        if owns_process(name, pid):
            os.killpg(pid, signal.SIGTERM)
    raise
print(f'Native Scope API: {api}. All service listeners verified on loopback.')
