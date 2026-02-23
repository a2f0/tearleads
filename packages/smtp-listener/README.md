# @tearleads/smtp-listener

SMTP listener for receiving and storing inbound emails. Uses the [smtp-server](https://nodemailer.com/extras/smtp-server/) library under the hood.

## Configuration

The listener is configured via environment variables:

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `SMTP_PORT` | `25` | Port to listen on |
| `SMTP_HOST` | `0.0.0.0` | Host/interface to bind to |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL for email storage |
| `SMTP_RECIPIENT_DOMAINS` | _none_ | Comma-separated list of domains that map local parts to user IDs (e.g. `email.example.com`) |
| `SMTP_RECIPIENT_ADDRESSING` | `uuid-local-part` | Recipient local-part mode: `uuid-local-part` (canonical `users.id`) or `legacy-local-part` |

By default, recipients are resolved only when local-part is a canonical UUID. This enforces `uuid@host` addressing for inbound routing.

## Local Development

```bash
# Start in development mode (watches for changes)
pnpm dev

# Build for production
pnpm build
pnpm build:bundle  # Creates bundled dist/server.cjs

# Run tests
pnpm test
pnpm test:coverage
```

Note: Binding to port 25 locally requires root privileges. For local testing, use a high port:

```bash
SMTP_PORT=2525 pnpm dev
```

## Production Deployment

The listener runs as a systemd service named `tearleads-smtp-listener`. The service configuration is managed via Ansible (see [`tearleads-smtp-listener.service.j2`](../../ansible/playbooks/templates/tearleads-smtp-listener.service.j2)).

Key service features:

- Runs as `www-data` user (not root)
- Uses `CAP_NET_BIND_SERVICE` capability to bind to port 25
- Auto-restarts on failure (10 second delay)
- Logs to systemd journal

### Viewing Logs

```bash
# Follow logs in real-time (like tail -f)
sudo journalctl -u tearleads-smtp-listener -f

# View last 100 lines
sudo journalctl -u tearleads-smtp-listener -n 100

# View logs since a specific time
sudo journalctl -u tearleads-smtp-listener --since "1 hour ago"
sudo journalctl -u tearleads-smtp-listener --since "2025-01-17 10:00:00"

# View logs with full output (no truncation)
sudo journalctl -u tearleads-smtp-listener -n 100 --no-pager

# View only error-level logs
sudo journalctl -u tearleads-smtp-listener -p err
```

For more options, see the [journalctl man page](https://www.freedesktop.org/software/systemd/man/journalctl.html).

### Service Management

```bash
# Check service status
sudo systemctl status tearleads-smtp-listener

# Restart the service
sudo systemctl restart tearleads-smtp-listener

# Stop/start the service
sudo systemctl stop tearleads-smtp-listener
sudo systemctl start tearleads-smtp-listener

# View service configuration
sudo systemctl cat tearleads-smtp-listener
```

## Testing Inbound Email

For local development, you can send a message directly to your workstation's listener:

```bash
SMTP_TO=test@localhost ./scripts/deliverMail.sh
```

```bash
# Install swaks (Swiss Army Knife for SMTP)
# macOS: brew install swaks
# Ubuntu: apt install swaks

# Send a test email
swaks --to test@yourdomain.com --from sender@example.com \
  --server email.yourdomain.com --port 25 \
  --header "Subject: Test email" \
  --body "This is a test message"
```

## Architecture

```text
┌─────────────────────────────────────────────────────────┐
│                    SMTP Listener                        │
│                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐ │
│  │ smtp-server │───▶│   parser    │───▶│   storage   │ │
│  │  (port 25)  │    │  (parsing)  │    │   (Redis)   │ │
│  └─────────────┘    └─────────────┘    └─────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

- **smtp-server**: Handles SMTP protocol, accepts incoming connections
- **parser**: Parses raw email data into structured format
- **storage**: Stores parsed emails in Redis for later processing

## Limitations

- **Inbound only**: This package only receives emails. Outbound SMTP is not supported (Hetzner blocks port 25 outbound by default).
- **No TLS**: STARTTLS is disabled. For production, TLS termination should be handled at the network level or via a reverse proxy.
- **No authentication required**: The server accepts emails without authentication (standard for public MX servers).
