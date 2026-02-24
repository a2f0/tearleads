import { S3InboundBlobStore } from './lib/inboundBlobStore.js';
import { DefaultInboundMessageIngestor } from './lib/inboundIngest.js';
import { PostgresInboundRecipientKeyLookup } from './lib/inboundKeyLookup.js';
import { PostgresInboundVfsEmailRepository } from './lib/inboundVfsRepository.js';
import { createSmtpListener } from './lib/server.js';
import type { SmtpListenerConfig } from './types/email.js';

const port = Number(process.env['SMTP_PORT']) || 25;
const host = process.env['SMTP_HOST'] || '0.0.0.0';
const recipientDomains = (process.env['SMTP_RECIPIENT_DOMAINS'] ?? '')
  .split(',')
  .map((domain) => domain.trim())
  .filter((domain) => domain.length > 0);
const recipientAddressing: 'uuid-local-part' | 'legacy-local-part' =
  process.env['SMTP_RECIPIENT_ADDRESSING'] === 'legacy-local-part'
    ? 'legacy-local-part'
    : 'uuid-local-part';

async function main(): Promise<void> {
  console.log(`Starting SMTP listener on ${host}:${port}...`);
  const inboundIngestor = new DefaultInboundMessageIngestor(
    new PostgresInboundRecipientKeyLookup(),
    new S3InboundBlobStore(),
    new PostgresInboundVfsEmailRepository()
  );

  const listenerConfig: SmtpListenerConfig = {
    port,
    host,
    recipientDomains,
    recipientAddressing,
    inboundIngestor,
    onEmail: (email) => {
      console.log(
        `Received email ${email.id} from ${
          email.envelope.mailFrom ? email.envelope.mailFrom.address : 'unknown'
        } (${email.size} bytes)`
      );
    }
  };

  const listener = await createSmtpListener(listenerConfig);

  await listener.start();
  console.log(`SMTP listener running on ${host}:${listener.getPort()}`);
  if (recipientDomains.length > 0) {
    console.log(`Inbound email hostname(s): ${recipientDomains.join(', ')}`);
  } else {
    console.log('Inbound email hostname(s): none configured');
  }

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
