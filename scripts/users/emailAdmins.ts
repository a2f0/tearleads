#!/usr/bin/env -S pnpm exec tsx
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { deliverMail } from './deliverMail.ts';

type AdminRow = {
  id: string;
  email: string;
};

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  ./scripts/users/emailAdmins.ts',
      '  SMTP_HOST=smtp-listener SMTP_PORT=25 SMTP_TO_DOMAIN=smoke.local ./scripts/users/emailAdmins.ts',
      '',
      'Options:',
      '  --help, -h            Show this help message.',
      '',
      'Sends a test email to every admin user.',
      '',
      'Environment:',
      '  SMTP_HOST             SMTP server host (default: localhost)',
      '  SMTP_PORT             SMTP server port (default: 25)',
      '  SMTP_TO_DOMAIN        Recipient domain appended to user ID (default: localhost)',
      '  SMTP_FROM             Sender address (default: test@example.com)',
      '  SMTP_SUBJECT          Email subject line override',
      '  SMTP_BODY             Email body text override',
      '  SMTP_MARKER           Optional marker included in subject and body',
      '',
      'Database:',
      '  DATABASE_URL or POSTGRES_URL take precedence.',
      '  Otherwise PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE are used.'
    ].join('\n')
  );
}

function getAdminUsers(): AdminRow[] {
  const raw = execFileSync(
    'pnpm',
    ['--filter', '@tearleads/api', 'cli', 'list-admins', '--json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const lines = raw.trim().split('\n');
  const jsonLine = lines.at(-1) ?? '[]';
  return JSON.parse(jsonLine) as AdminRow[];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const host = process.env.SMTP_HOST || 'localhost';
  const port = Number.parseInt(process.env.SMTP_PORT || '25', 10);
  const domain = process.env.SMTP_TO_DOMAIN || 'localhost';
  const from = process.env.SMTP_FROM || 'test@example.com';
  const marker = process.env.SMTP_MARKER || '';
  const timestamp = new Date().toUTCString();

  const admins = getAdminUsers();
  if (admins.length === 0) {
    console.log('No admin users found.');
    return;
  }

  console.log(`Found ${admins.length} admin(s). Sending test emails via ${host}:${port}...`);

  for (const admin of admins) {
    const to = `${admin.id}@${domain}`;

    const defaultSubject = marker
      ? `Test email from emailAdmins.ts [${marker}]`
      : 'Test email from emailAdmins.ts';
    const subject = process.env.SMTP_SUBJECT || defaultSubject;

    const defaultBody = marker
      ? `SMTP marker: ${marker}\nThis is a test message for ${admin.email} sent at ${timestamp}`
      : `This is a test message for ${admin.email} sent at ${timestamp}`;
    const body = process.env.SMTP_BODY || defaultBody;

    console.log(`  Sending to ${admin.email} (${to})...`);
    await deliverMail({ host, port, to, from, subject, body });
  }

  console.log('All emails sent successfully.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error('Failed to email admins:', error);
    process.exitCode = 1;
  });
}
