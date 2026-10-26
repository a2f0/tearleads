"""Native service environment. Never persist host login tokens to local state."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import time


def claude_credentials():
    token = os.environ.get('CLAUDE_CODE_OAUTH_TOKEN')
    if token:
        return {'accessToken': token}
    try:
        credentials = json.loads((Path.home() / '.claude/.credentials.json').read_text())['claudeAiOauth']
        if credentials['expiresAt'] <= time.time() * 1000:
            raise RuntimeError('Claude login expired. Refresh the host Claude Code login.')
        if not credentials['accessToken']:
            raise ValueError('Empty token')
        return credentials
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise RuntimeError('No usable Claude OAuth login file. Set CLAUDE_CODE_OAUTH_TOKEN '
                           'from claude setup-token, or sign in with a file-backed Claude login.') from error


def environment(runtime, pins):
    env = {key: os.environ[key] for key in
           ['HOME', 'USER', 'LOGNAME', 'PATH', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL',
            'CODEX_HOME', 'SCOPE_SOURCE_DIR'] if key in os.environ}
    ports = pins['ports']
    api = f"http://127.0.0.1:{ports['api']}"
    claude = shutil.which('claude')
    if not claude:
        raise RuntimeError('Install and sign in to Claude Code on the host first.')
    version = subprocess.check_output([claude, '--version'], text=True).split()[0]
    credentials = claude_credentials()
    dependencies = pins['tools']['dependencies']
    acp = dependencies['@agentclientprotocol/claude-agent-acp']
    sdk = dependencies['@anthropic-ai/claude-agent-sdk']
    # Public Azurite development key; this is not a cloud account.
    emulator_key = 'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw=='
    env.update({
        'MONGO_CONNECTION_STRING': f"mongodb://127.0.0.1:{ports['mongo']}",
        'MONGO_DATABASE': 'tearleads-scope', 'MONGO_COLLECTION': 'requests',
        'REDIS_HOST': '127.0.0.1', 'REDIS_PORT': str(ports['redis']), 'REDIS_PASSWORD': '',
        'AZURE_STORAGE_ACCOUNT_NAME': 'devstoreaccount1',
        'STORAGE_CONNECTION_STRING': f'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey={emulator_key};'
            f"QueueEndpoint=http://127.0.0.1:{ports['queue']}/devstoreaccount1;"
            f"BlobEndpoint=http://127.0.0.1:{ports['blob']}/devstoreaccount1;",
        'SCOPE_MT_API_URL': api, 'SCOPE_API_URL': api, 'CRITERIA_API_URL': api,
        'CODEX_JUDGE_MODEL': os.environ.get('CODEX_JUDGE_MODEL', pins['judgeModel']),
        'COPYFILE_DISABLE': '1', 'TOKEN_MANAGER_URL': '',
        'JUDGE_SERVICE_URL': f"http://127.0.0.1:{ports['judge']}",
        'AUTH_PROVIDER': '', 'AUTH_AUTHORITY': '', 'AUTH_API_CLIENT_ID': '',
        'AUTH_SCOPES': '', 'AUTH_JWKS_URI': '', 'AUTH_ISSUER_TEMPLATE': '',
        'APPLICATIONINSIGHTS_CONNECTION_STRING': '', 'DEV_PROXY_ENABLED': '',
        'MCP_GATEWAY_URL': '', 'CLAUDE_CODE_DISABLE_POLICY_SKILLS': '1',
        'CLAUDE_CODE_ACP_VERSION': acp, 'CLAUDE_AGENT_SDK_VERSION': sdk,
        'CLAUDE_CODE_EXECUTABLE': claude,
        'SCOPE_AGENT_VERSION': f'claude-{version}-acp-{acp}-sdk-{sdk}-native',
        'PATH': str(runtime / 'tools/node_modules/.bin') + os.pathsep + os.environ['PATH'],
    })
    return env, version, credentials
