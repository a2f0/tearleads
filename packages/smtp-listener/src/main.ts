import { createSmtpListener } from './lib/server.js';

const port = Number(process.env['SMTP_PORT']) || 25;
const host = process.env['SMTP_HOST'] || '0.0.0.0';
const redisUrl = process.env['REDIS_URL'] || 'redis://localhost:6379';
const recipientDomains = (process.env['SMTP_RECIPIENT_DOMAINS'] ?? '')
  .split(',')
  .map((domain) => domain.trim())
  .filter((domain) => domain.length > 0);
const recipientAddressing =
  process.env['SMTP_RECIPIENT_ADDRESSING'] === 'legacy-local-part'
    ? 'legacy-local-part'
    : 'uuid-local-part';

async function main(): Promise<void> {
  console.log(`Starting SMTP listener on ${host}:${port}...`);

  const listener = await createSmtpListener({
    port,
    host,
    redisUrl,
    recipientDomains,
    recipientAddressing,
    onEmail: (email) => {
      console.log(
        `Received email ${email.id} from ${
          email.envelope.mailFrom ? email.envelope.mailFrom.address : 'unknown'
        } (${email.size} bytes)`
      );
    }
  });

  await listener.start();
  console.log(`SMTP listener running on ${host}:${listener.getPort()}`);

  const shutdown = async (): Promise<void> => {
    console.log('Shutting down SMTP listener...');
    await listener.stop();
    console.log('SMTP listener stopped');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  console.error('Failed to start SMTP listener:', err);
  process.exit(1);
});
