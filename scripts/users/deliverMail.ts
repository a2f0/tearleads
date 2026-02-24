#!/usr/bin/env -S pnpm exec tsx
import net from 'node:net';
import { pathToFileURL } from 'node:url';

export interface DeliverMailOptions {
  host: string;
  port: number;
  to: string;
  from: string;
  subject: string;
  body: string;
}

function smtpExchange(socket: net.Socket, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const onData = (data: Buffer): void => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      const response = data.toString();
      if (response.startsWith('4') || response.startsWith('5')) {
        reject(new Error(`SMTP error after "${command}": ${response.trim()}`));
      } else {
        resolve(response);
      }
    };
    const onError = (err: Error): void => {
      socket.removeListener('data', onData);
      reject(err);
    };
    socket.on('data', onData);
    socket.on('error', onError);
    socket.write(`${command}\r\n`);
  });
}

function waitForGreeting(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    const onData = (data: Buffer): void => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      const response = data.toString();
      if (response.startsWith('2')) {
        resolve(response);
      } else {
        reject(new Error(`Unexpected SMTP greeting: ${response.trim()}`));
      }
    };
    const onError = (err: Error): void => {
      socket.removeListener('data', onData);
      reject(err);
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

export async function deliverMail(opts: DeliverMailOptions): Promise<void> {
  const { host, port, to, from, subject, body } = opts;
  const timestamp = new Date().toUTCString();

  const socket = net.createConnection({ host, port });

  try {
    await waitForGreeting(socket);
    await smtpExchange(socket, `EHLO ${host}`);
    await smtpExchange(socket, `MAIL FROM:<${from}>`);
    await smtpExchange(socket, `RCPT TO:<${to}>`);
    await smtpExchange(socket, 'DATA');

    const message = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Date: ${timestamp}`,
      '',
      body,
      '.',
      ''
    ].join('\r\n');

    await smtpExchange(socket, message.trimEnd());
    await smtpExchange(socket, 'QUIT');
  } finally {
    socket.destroy();
  }
}

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  ./scripts/users/deliverMail.ts',
      '  SMTP_HOST=localhost SMTP_PORT=25 SMTP_TO=test@localhost ./scripts/users/deliverMail.ts',
      '  SMTP_TO_USER_ID=<uuid> SMTP_TO_DOMAIN=smoke.local ./scripts/users/deliverMail.ts',
      '',
      'Options:',
      '  --help, -h            Show this help message.',
      '',
      'Environment:',
      '  SMTP_HOST             SMTP server host (default: localhost)',
      '  SMTP_PORT             SMTP server port (default: 25)',
      '  SMTP_TO               Full recipient address (default: test@localhost)',
      '  SMTP_TO_USER_ID       Recipient user ID (used with SMTP_TO_DOMAIN)',
      '  SMTP_TO_DOMAIN        Recipient domain (default: localhost)',
      '  SMTP_FROM             Sender address (default: test@example.com)',
      '  SMTP_SUBJECT          Email subject line',
      '  SMTP_BODY             Email body text',
      '  SMTP_MARKER           Optional marker included in subject and body'
    ].join('\n')
  );
}

function buildOptions(): DeliverMailOptions {
  const host = process.env.SMTP_HOST || 'localhost';
  const port = Number.parseInt(process.env.SMTP_PORT || '25', 10);
  const toUserId = process.env.SMTP_TO_USER_ID || '';
  const toDomain = process.env.SMTP_TO_DOMAIN || 'localhost';
  const to = toUserId
    ? `${toUserId}@${toDomain}`
    : process.env.SMTP_TO || 'test@localhost';
  const from = process.env.SMTP_FROM || 'test@example.com';
  const marker = process.env.SMTP_MARKER || '';
  const timestamp = new Date().toUTCString();

  const defaultSubject = marker
    ? `Test email from deliverMail.ts [${marker}]`
    : 'Test email from deliverMail.ts';
  const subject = process.env.SMTP_SUBJECT || defaultSubject;

  const defaultBody = marker
    ? `SMTP marker: ${marker}\nThis is a test message sent at ${timestamp}`
    : `This is a test message sent at ${timestamp}`;
  const body = process.env.SMTP_BODY || defaultBody;

  return { host, port, to, from, subject, body };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const opts = buildOptions();
  console.log(
    `Sending test email to ${opts.to} via ${opts.host}:${opts.port}...`
  );
  await deliverMail(opts);
  console.log('Email sent successfully');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error('Failed to deliver mail:', error);
    process.exitCode = 1;
  });
}
