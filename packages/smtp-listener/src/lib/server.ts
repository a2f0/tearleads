import { SMTPServer, type SMTPServerSession } from 'smtp-server';
import type {
  EmailAddress,
  EmailEnvelope,
  SmtpListenerConfig
} from '../types/email.js';
import { createStoredEmail } from './parser.js';
import { createStorage, type EmailStorage } from './storage.js';

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

function extractUserIds(
  rcptTo: EmailAddress[],
  allowedDomains: Set<string> | null
): string[] {
  const userIds = new Set<string>();
  for (const recipient of rcptTo) {
    const address = recipient.address.trim().toLowerCase();
    const atIndex = address.lastIndexOf('@');
    if (atIndex <= 0 || atIndex === address.length - 1) {
      continue;
    }
    const localPart = address.slice(0, atIndex);
    const domain = address.slice(atIndex + 1);
    if (!localPart) {
      continue;
    }
    if (allowedDomains && !allowedDomains.has(domain)) {
      continue;
    }
    userIds.add(localPart);
  }
  return Array.from(userIds);
}

export async function createSmtpListener(
  config: SmtpListenerConfig
): Promise<SmtpListener> {
  const redisUrl = config.redisUrl ?? 'redis://localhost:6379';
  let storage: EmailStorage | null = null;
  const allowedDomains = normalizeDomains(config.recipientDomains);

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
          const userIds = extractUserIds(envelope.rcptTo, allowedDomains);

          if (storage) {
            await storage.store(email, userIds);
          }
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
      storage = await createStorage(redisUrl);
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
          if (storage) {
            storage
              .close()
              .then(resolve)
              .catch((err) => {
                console.error(
                  'Failed to close Redis storage on SMTP listener stop:',
                  err
                );
                resolve();
              });
          } else {
            resolve();
          }
        });
      });
    },

    getPort(): number {
      return actualPort;
    }
  };
}
