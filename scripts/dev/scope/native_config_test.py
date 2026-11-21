"""Environment isolation checks without reading real host credentials."""
import json
import os
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from native_config import claude_credentials, environment
from native_network import verify_listeners


def write_login(config_dir, token):
    config_dir.mkdir(parents=True, exist_ok=True)
    login = {'claudeAiOauth': {'accessToken': token, 'expiresAt': (time.time() + 3600) * 1000}}
    (config_dir / '.credentials.json').write_text(json.dumps(login))


class NativeEnvironmentTests(unittest.TestCase):
    def test_only_worker_receives_explicit_token_and_host_secrets_are_excluded(self):
        pins = {'ports': dict(api=3101, mongo=27001, redis=6301, queue=10201,
                             blob=10101, judge=3201), 'judgeModel': 'fixture',
                'tools': {'dependencies': {'@agentclientprotocol/claude-agent-acp': '1',
                                          '@anthropic-ai/claude-agent-sdk': '1'}}}
        with patch.dict(os.environ, {'HOME': '/fixture', 'PATH': '/usr/bin',
                                     'HOST_SECRET': 'must-not-inherit',
                                     'CLAUDE_CONFIG_DIR': '/fixture/claude2',
                                     'CLAUDE_CODE_OAUTH_TOKEN': 'fixture-token'}, clear=True), \
                patch('native_config.shutil.which', return_value='/usr/bin/claude'), \
                patch('native_config.subprocess.check_output', return_value='2.1.0 fixture'):
            env, _, credentials = environment(Path('/fixture/runtime'), pins)
        self.assertNotIn('HOST_SECRET', env)
        self.assertNotIn('CLAUDE_CODE_OAUTH_TOKEN', env)
        # The worker keeps sessions under ~/.claude/projects, where the Judge reads them.
        self.assertNotIn('CLAUDE_CONFIG_DIR', env)
        self.assertEqual(credentials['accessToken'], 'fixture-token')

    def test_missing_login_explains_explicit_token_option(self):
        with patch.dict(os.environ, {}, clear=True), \
                patch('native_config.Path.read_text', side_effect=FileNotFoundError):
            with self.assertRaisesRegex(RuntimeError, 'CLAUDE_CODE_OAUTH_TOKEN'):
                claude_credentials()

    def test_login_file_follows_claude_config_dir(self):
        with tempfile.TemporaryDirectory() as root:
            home, config = Path(root, 'home'), Path(root, 'claude2')
            write_login(home / '.claude', 'default-token')
            write_login(config, 'config-dir-token')
            for value, expected in [(None, 'default-token'), ('', 'default-token'),
                                    (str(config), 'config-dir-token')]:
                variables = {'HOME': str(home)}
                if value is not None:
                    variables['CLAUDE_CONFIG_DIR'] = value
                with self.subTest(CLAUDE_CONFIG_DIR=value), \
                        patch.dict(os.environ, variables, clear=True):
                    self.assertEqual(claude_credentials()['accessToken'], expected)

    def test_config_dir_without_login_does_not_fall_back_to_home(self):
        with tempfile.TemporaryDirectory() as root:
            home = Path(root, 'home')
            write_login(home / '.claude', 'default-token')
            Path(root, 'claude2').mkdir()
            with patch.dict(os.environ, {'HOME': str(home),
                                         'CLAUDE_CONFIG_DIR': str(Path(root, 'claude2'))}, clear=True):
                with self.assertRaisesRegex(RuntimeError, 'CLAUDE_CODE_OAUTH_TOKEN'):
                    claude_credentials()

    def test_explicit_token_precedes_config_dir_login(self):
        with tempfile.TemporaryDirectory() as root:
            write_login(Path(root), 'config-dir-token')
            with patch.dict(os.environ, {'CLAUDE_CONFIG_DIR': root,
                                         'CLAUDE_CODE_OAUTH_TOKEN': 'explicit-token'}, clear=True):
                self.assertEqual(claude_credentials(), {'accessToken': 'explicit-token'})

    def test_listener_verification_rejects_wildcards_and_missing_ports(self):
        for output, message in [('n*:3101\n', 'non-loopback'), ('', 'expected local ports')]:
            with patch('native_network.subprocess.run', return_value=SimpleNamespace(stdout=output)), \
                    patch('native_network.time.sleep'):
                with self.assertRaisesRegex(RuntimeError, message):
                    verify_listeners({'api': 3101})


if __name__ == '__main__':
    unittest.main()
