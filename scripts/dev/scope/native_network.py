"""Confirm actual sockets before declaring the native stack ready."""
import subprocess
import socket
import time


def wait_tcp(port):
    for _ in range(60):
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=1):
                return
        except OSError:
            time.sleep(1)
    raise RuntimeError(f'Service on port {port} did not become ready')


def verify_listeners(ports):
    for _ in range(20):
        missing = []
        for name, port in ports.items():
            result = subprocess.run(['lsof', '-nP', f'-iTCP:{port}', '-sTCP:LISTEN', '-Fn'],
                                    capture_output=True, text=True, check=False)
            addresses = [line[1:] for line in result.stdout.splitlines() if line.startswith('n')]
            if not addresses:
                missing.append(name)
            elif any(address not in (f'127.0.0.1:{port}', f'[::1]:{port}') for address in addresses):
                raise RuntimeError(f'{name} has a non-loopback listener: {addresses}')
        if not missing:
            return
        time.sleep(0.5)
    raise RuntimeError(f'Services did not open their expected local ports: {missing}')
