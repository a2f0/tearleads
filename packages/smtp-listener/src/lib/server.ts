import { SMTPServer, type SMTPServerSession } from 'smtp-server';
import type {
  EmailAddress,
  EmailEnvelope,
  SmtpListenerConfig
} from '../types/email.js';
import { createStoredEmail } from './parser.js';
import { resolveRecipientUserIds } from './recipientResolver.js';

export interface SmtpListener {
  start(): Promise<void>;
  stop(): Promise<void>;
  getPort(): number;
}

function toEmailAddress(
  addr: { address: string; args: unknown } | false
): EmailAddress | false {
  if (!addr) {
    return false;
  }
  return { address: addr.address };
}

function buildEnvelope(session: SMTPServerSession): EmailEnvelope {
  const mailFrom = toEmailAddress(session.envelope.mailFrom);
  const rcptTo = session.envelope.rcptTo.map((r) => ({ address: r.address }));
  return { mailFrom, rcptTo };
}

function normalizeDomains(domains: string[] | undefined): Set<string> | null {
  if (!domains || domains.length === 0) {
    return null;
  }
  const normalized = domains
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain.length > 0);
  if (normalized.length === 0) {
    return null;
  }
  return new Set(normalized);
}

export async function createSmtpListener(
  config: SmtpListenerConfig
): Promise<SmtpListener> {
  const allowedDomains = normalizeDomains(config.recipientDomains);
  const recipientAddressing = config.recipientAddressing ?? 'uuid-local-part';
  const inboundIngestor = config.inboundIngestor;

  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    size: config.maxMessageSize ?? 10 * 1024 * 1024,
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];

      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      stream.on('end', async () => {
        try {
          const rawData = Buffer.concat(chunks).toString('utf8');
          const envelope = buildEnvelope(session);
          const email = createStoredEmail(envelope, rawData);
          const userIds = resolveRecipientUserIds({
            rcptTo: envelope.rcptTo,
            allowedDomains,
            recipientAddressing
          });

          let disposition: string;
          if (userIds.length === 0) {
            disposition = 'dropped: no resolved recipients';
          } else if (inboundIngestor) {
            await inboundIngestor.ingest({ email, userIds });
            disposition = `delivered via vfs (${userIds.length} recipient(s))`;
          } else {
            disposition = 'dropped: no ingestor configured';
          }
          console.log(`Message ${email.id}: ${disposition}`);
          if (config.onEmail) {
            await config.onEmail(email);
          }
          callback();
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          callback(error);
        }
      });

      stream.on('error', (err: Error) => {
        callback(err);
      });
    }
  });

  let actualPort = config.port;

  return {
    async start(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.listen(config.port, config.host, () => {
          const address = server.server.address();
          if (address && typeof address === 'object') {
            actualPort = address.port;
          }
          resolve();
        });
        server.on('error', reject);
      });
    },

    async stop(): Promise<void> {
      return new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },

    getPort(): number {
      return actualPort;
    }
  };
}
