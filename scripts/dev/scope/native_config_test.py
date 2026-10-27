"""Environment isolation checks without reading real host credentials."""
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from native_config import claude_credentials, environment
from native_network import verify_listeners


class NativeEnvironmentTests(unittest.TestCase):
    def test_only_worker_receives_explicit_token_and_host_secrets_are_excluded(self):
        pins = {'ports': dict(api=3101, mongo=27001, redis=6301, queue=10201,
                             blob=10101, judge=3201), 'judgeModel': 'fixture',
                'tools': {'dependencies': {'@agentclientprotocol/claude-agent-acp': '1',
                                          '@anthropic-ai/claude-agent-sdk': '1'}}}
        with patch.dict(os.environ, {'HOME': '/fixture', 'PATH': '/usr/bin',
                                     'HOST_SECRET': 'must-not-inherit',
                                     'CLAUDE_CODE_OAUTH_TOKEN': 'fixture-token'}, clear=True), \
                patch('native_config.shutil.which', return_value='/usr/bin/claude'), \
                patch('native_config.subprocess.check_output', return_value='2.1.0 fixture'):
            env, _, credentials = environment(Path('/fixture/runtime'), pins)
        self.assertNotIn('HOST_SECRET', env)
        self.assertNotIn('CLAUDE_CODE_OAUTH_TOKEN', env)
        self.assertEqual(credentials['accessToken'], 'fixture-token')

    def test_missing_login_explains_explicit_token_option(self):
        with patch.dict(os.environ, {}, clear=True), \
                patch('native_config.Path.read_text', side_effect=FileNotFoundError):
            with self.assertRaisesRegex(RuntimeError, 'CLAUDE_CODE_OAUTH_TOKEN'):
                claude_credentials()

    def test_listener_verification_rejects_wildcards_and_missing_ports(self):
        for output, message in [('n*:3101\n', 'non-loopback'), ('', 'expected local ports')]:
            with patch('native_network.subprocess.run', return_value=SimpleNamespace(stdout=output)), \
                    patch('native_network.time.sleep'):
                with self.assertRaisesRegex(RuntimeError, message):
                    verify_listeners({'api': 3101})


if __name__ == '__main__':
    unittest.main()
